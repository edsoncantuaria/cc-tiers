#!/usr/bin/env node
/**
 * `/cc-tiers:insights` helper. Reads the telemetry events cc-tiers keeps in the
 * plugin data directory and prints what they show: outcomes, failure categories,
 * escalation reasons, estimated cost by risk, unverified gates and how each start
 * tier fared. It only describes: it never proposes or applies a routing change.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIERS } from './base.mjs'
import { readEvents, telemetryPath } from './telemetry.mjs'

function bump(map, key) {
  const next = (Object.hasOwn(map, key) ? map[key] : 0) + 1
  Object.defineProperty(map, key, { value: next, enumerable: true, writable: true, configurable: true })
}

function slot(map, key, fresh = () => ({ tasks: 0, usd: 0 })) {
  if (!Object.hasOwn(map, key)) Object.defineProperty(map, key, { value: fresh(), enumerable: true, writable: true, configurable: true })
  return map[key]
}

function startRow() {
  return { tasks: 0, passed: 0, escalated: 0, finishedOn: {}, stopped: 0, afterBlocking: 0 }
}

function matchRow() {
  return { searches: 0, tasks: 0, passed: 0 }
}

/** What happened to one task, folded from its events in order. */
function journeyOf(journeys, task) {
  if (!journeys.has(task)) journeys.set(task, { start: '', risk: '', escalated: false, blocking: false, passed: false, stopped: false, finish: '', matches: new Set() })
  return journeys.get(task)
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
    hindsight: { byStart: {}, overRouted: 0 },
    failureResearch: {},
    sample: 'small',
    notes: [],
  }
  const tasks = new Set()
  const reworked = new Set()
  const journeys = new Map()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    summary.events += 1
    if (event.task) tasks.add(event.task)
    const journey = event.task ? journeyOf(journeys, event.task) : null
    switch (event.type) {
      case 'model.selected':
        // The first selection is what routing chose; a retry or an escalation selects again.
        if (journey && !journey.start && event.tier) Object.assign(journey, { start: event.tier, risk: event.risk || '' })
        break
      case 'review.done':
        if (journey && event.review?.blocking > 0) journey.blocking = true
        break
      case 'failure.diagnosed':
        bump(summary.byCategory, event.category || 'unknown')
        if (event.task) reworked.add(event.task)
        break
      case 'research.failure': {
        const match = event.outcome || 'unknown'
        slot(summary.failureResearch, match, matchRow).searches += 1
        if (journey) journey.matches.add(match)
        break
      }
      case 'escalated':
        summary.escalations += 1
        bump(summary.escalationReasons, event.because || event.category || 'unknown')
        if (journey) journey.escalated = true
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
        // The last outcome wins; the tier on it is where the task finished.
        if (journey) Object.assign(journey, { passed: event.type === 'task.passed', stopped: event.type === 'task.stopped', finish: event.tier || 'unknown' })
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
  for (const journey of journeys.values()) {
    for (const match of journey.matches) {
      const row = slot(summary.failureResearch, match, matchRow)
      row.tasks += 1
      if (journey.passed && !journey.escalated) row.passed += 1
    }
  }
  for (const [task, journey] of journeys) {
    if (!journey.start) continue
    const row = slot(summary.hindsight.byStart, journey.start, startRow)
    row.tasks += 1
    if (journey.passed && !journey.escalated) row.passed += 1
    if (journey.escalated) {
      row.escalated += 1
      bump(row.finishedOn, journey.finish || 'open')
    }
    if (journey.stopped) row.stopped += 1
    if (journey.passed && journey.blocking) row.afterBlocking += 1
    const calm = journey.passed && !journey.escalated && !journey.blocking && !reworked.has(task)
    if (calm && journey.start === 'opus' && ['low', 'medium'].includes(journey.risk)) summary.hindsight.overRouted += 1
  }
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

function tierRank(tier) {
  const index = TIERS.indexOf(tier)
  return index < 0 ? TIERS.length : index
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
  const startRows = Object.entries(summary.hindsight.byStart)
    .sort((a, b) => tierRank(a[0]) - tierRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([tier, row]) => [
      tier,
      String(row.tasks),
      String(row.passed),
      String(row.escalated),
      counts(row.finishedOn).map(([finish, count]) => `${finish} ${count}`).join(', ') || '-',
      String(row.stopped),
      String(row.afterBlocking),
    ])
  lines.push(...table('Routing in hindsight', ['started on', 'tasks', 'passed there', 'escalated', 'escalated, finished on', 'stopped', 'passed after blocking review'], startRows))
  const matchRows = Object.entries(summary.failureResearch)
    .sort((a, b) => b[1].searches - a[1].searches || a[0].localeCompare(b[0]))
    .map(([match, row]) => [match, String(row.searches), String(row.tasks), String(row.passed)])
  lines.push(...table('Failure research by match', ['match', 'searches', 'tasks', 'passed later without escalating'], matchRows))
  if (summary.hindsight.overRouted > 0) {
    lines.push('', `Possibly over-routed: ${summary.hindsight.overRouted} task(s) started on opus at low or medium risk and passed with no escalation, failure or blocking finding. A hint to look at, not a verdict.`)
  }
  if (summary.notes.length) lines.push('', ...summary.notes.map((note) => `- ${note}`))
  return `${lines.join('\n')}\n`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dataDir = process.argv[2] || process.env.CLAUDE_PLUGIN_DATA || ''
  const events = dataDir ? readEvents(telemetryPath(dataDir)) : []
  process.stdout.write(events.length ? renderInsights(summarize(events)) : 'cc-tiers has no telemetry yet.\n')
}
