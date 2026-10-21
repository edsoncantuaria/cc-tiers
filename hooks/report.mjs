#!/usr/bin/env node
/**
 * `/cc-tiers:report` helper. Reads the session state cc-tiers keeps in the plugin
 * data directory and prints one Markdown table: each task, the tiers that ran it,
 * attempts, escalations, effort, review, how it ended, and its estimated cost
 * next to the same tokens at Opus rates. `--all` adds every kept session.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OVERHEAD, TIERS, costSummary, costTotal, dollars, formatSpend, own } from './cc_tiers.mjs'

function readState(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

export function sessionFiles(dataDir, all) {
  if (!dataDir || !existsSync(dataDir)) return []
  if (!all) return existsSync(path.join(dataDir, 'latest.json')) ? [path.join(dataDir, 'latest.json')] : []
  return readdirSync(dataDir)
    .filter((name) => name.startsWith('session-') && name.endsWith('.json'))
    .map((name) => path.join(dataDir, name))
}

function verifyCell(verify) {
  if (!verify) return '—'
  if (verify.flaky?.length) return 'flaky'
  if (verify.unverified?.length) return 'not validated'
  return verify.verified?.length ? 'ok' : '—'
}

/** Measured agent time, as Claude Code reports it; '—' when no run reported it. */
function minutes(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value < 60000 ? `${Math.round(value / 1000)} s` : `${(value / 60000).toFixed(1)} min`
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|') || '—'
}

export function renderReport(states) {
  const log = {}
  const cost = {}
  const spend = {}
  for (const state of states) {
    for (const [task, entry] of Object.entries(state.log || {})) log[task] = entry
    for (const [task, row] of Object.entries(state.cost || {})) {
      const current = own(cost, task) || { haiku: 0, sonnet: 0, opus: 0, opusRate: 0 }
      for (const key of [...TIERS, 'opusRate']) current[key] += Number(row?.[key]) || 0
      cost[task] = current
    }
    for (const [task, row] of Object.entries(state.spend || {})) {
      const current = own(spend, task) || { haiku: 0, sonnet: 0, opus: 0 }
      for (const tier of TIERS) current[tier] += Number(row?.[tier]) || 0
      spend[task] = current
    }
  }
  const tasks = [...new Set([...Object.keys(log), ...Object.keys(cost)])].filter((task) => task !== OVERHEAD)
  if (!tasks.length && !cost[OVERHEAD]) return 'cc-tiers has not recorded a task in this session yet.\n'

  const lines = [
    '| Task | Tiers | Attempts | Escalated | Effort | Review | Verify | Status | Cost | At Opus rates | Risk | Completion | Confidence | Time |',
    '| --- | --- | --: | --: | --- | --- | --- | --- | --: | --: | --- | --- | --- | --: |',
  ]
  for (const task of tasks) {
    const entry = own(log, task) || {}
    const row = own(cost, task)
    const effort = Object.entries(entry.effort || {})
      .map(([tier, level]) => `${tier} ${level}`)
      .join(', ')
    const reviews = [...new Set(entry.reviews || [])].join(', ')
    const status = entry.status === 'done' && entry.finished ? `done on ${entry.finished}` : entry.status
    lines.push(
      `| ${cell(task)} | ${cell((entry.tiers || []).join(' → '))} | ${entry.attempts ?? 0} | ${entry.escalations ?? 0} | ${cell(effort)} | ${cell(reviews)} | ${verifyCell(entry.verify)} | ${cell(status)} | ${row ? dollars(costTotal(row)) : '—'} | ${row ? dollars(row.opusRate) : '—'} | ${cell(entry.risk)} | ${cell(entry.completion)} | ${cell(entry.confidence)} | ${minutes(entry.durationMs)} |`,
    )
  }
  if (cost[OVERHEAD]) {
    lines.push(`| ${OVERHEAD} | — | — | — | — | — | — | — | ${dollars(costTotal(cost[OVERHEAD]))} | ${dollars(cost[OVERHEAD].opusRate)} | — | — | — | — |`)
  }
  const summary = costSummary(cost)
  lines.push('')
  lines.push(
    `Total: about ${dollars(summary.total)} at Anthropic API list prices. The same tokens at Opus rates: about ${dollars(summary.opus)} ` +
      `(${Math.round(summary.saved * 100)}% less). Subscription plans are not billed this way; read it as a comparison. ` +
      'Opus-only work would not use exactly the same tokens, so the comparison is an estimate. Time is measured; cost is estimated.',
  )
  const fresh = formatSpend(spend)
  if (fresh.length) lines.push('', 'cc-cost fresh tokens (input + cache write + output):', ...fresh.map((line) => `- ${line}`))
  return `${lines.join('\n')}\n`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const dataDir = args.find((arg) => !arg.startsWith('--')) || process.env.CLAUDE_PLUGIN_DATA || ''
  const states = sessionFiles(dataDir, all).map(readState).filter(Boolean)
  process.stdout.write(states.length ? renderReport(states) : 'cc-tiers has no session data yet.\n')
}
