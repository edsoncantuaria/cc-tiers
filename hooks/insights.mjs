#!/usr/bin/env node
/**
 * `/cc-tiers:insights` helper. Reads the telemetry events cc-tiers keeps in the
 * plugin data directory and prints what they show: outcomes, failure categories,
 * escalation reasons, estimated cost by risk and unverified gates. It only
 * describes: it never proposes or applies a routing change.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEvents, telemetryPath } from './telemetry.mjs'

function bump(map, key) {
  const next = (Object.hasOwn(map, key) ? map[key] : 0) + 1
  Object.defineProperty(map, key, { value: next, enumerable: true, writable: true, configurable: true })
}

function slot(map, key) {
  if (!Object.hasOwn(map, key)) Object.defineProperty(map, key, { value: { tasks: 0, usd: 0 }, enumerable: true, writable: true, configurable: true })
  return map[key]
}

export function summarize(events, { minSample = 10 } = {}) {
  const summary = {
    events: 0,
    tasks: 0,
    passed: 0,
    stopped: 0,
    escalations: 0,
    byCategory: {},
    escalationReasons: {},
    costByRisk: {},
    unverified: {},
    rework: { tasks: 0, total: 0 },
    confidence: {},
    sample: 'small',
    notes: [],
  }
  const tasks = new Set()
  const reworked = new Set()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    summary.events += 1
    if (event.task) tasks.add(event.task)
    switch (event.type) {
      case 'failure.diagnosed':
        bump(summary.byCategory, event.category || 'unknown')
        if (event.task) reworked.add(event.task)
        break
      case 'escalated':
        summary.escalations += 1
        bump(summary.escalationReasons, event.because || event.category || 'unknown')
        break
      case 'verify.done':
        if (event.gate?.unverified > 0) bump(summary.unverified, event.reason || 'unspecified')
        break
      case 'task.passed':
      case 'task.stopped':
        if (event.type === 'task.passed') {
          summary.passed += 1
          bump(summary.confidence, event.confidence || 'unknown')
        } else {
          summary.stopped += 1
        }
        if (Number.isFinite(event.costUsd)) {
          const row = slot(summary.costByRisk, event.risk || 'unknown')
          row.tasks += 1
          row.usd += event.costUsd
        }
        break
    }
  }
  summary.tasks = tasks.size
  summary.rework = { tasks: reworked.size, total: tasks.size }
  if (tasks.size >= minSample) {
    summary.sample = 'enough'
  } else {
    summary.notes.push(`Fewer than ${minSample} tasks: the figures are descriptive only and must not change routing.`)
  }
  return summary
}

function table(title, head, rows) {
  if (!rows.length) return []
  return ['', `### ${title}`, '', `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)]
}

function counts(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => [key, String(count)])
}

function dollars(value) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

export function renderInsights(summary) {
  const lines = [
    '## cc-tiers insights',
    '',
    `${summary.tasks} tasks, ${summary.events} events: ${summary.passed} passed, ${summary.stopped} stopped, ${summary.escalations} escalations.`,
    `Rework: ${summary.rework.tasks} of ${summary.rework.total} tasks had a diagnosed failure.`,
    `Sample: ${summary.sample}.`,
  ]
  lines.push(...table('Failures by category', ['category', 'count'], counts(summary.byCategory)))
  lines.push(...table('Escalation reasons', ['reason', 'count'], counts(summary.escalationReasons)))
  const costRows = Object.entries(summary.costByRisk)
    .sort((a, b) => b[1].usd - a[1].usd || a[0].localeCompare(b[0]))
    .map(([risk, row]) => [risk, String(row.tasks), dollars(row.usd), dollars(row.usd / row.tasks)])
  lines.push(...table('Cost by risk (estimated)', ['risk', 'tasks', 'estimated USD', 'estimated USD per task'], costRows))
  lines.push(...table('Unverified gates', ['reason', 'count'], counts(summary.unverified)))
  lines.push(...table('Confidence on passed tasks', ['confidence', 'count'], counts(summary.confidence)))
  if (summary.notes.length) lines.push('', ...summary.notes.map((note) => `- ${note}`))
  return `${lines.join('\n')}\n`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dataDir = process.argv[2] || process.env.CLAUDE_PLUGIN_DATA || ''
  const events = dataDir ? readEvents(telemetryPath(dataDir)) : []
  process.stdout.write(events.length ? renderInsights(summarize(events)) : 'cc-tiers has no telemetry yet.\n')
}
