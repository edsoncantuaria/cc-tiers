#!/usr/bin/env node
/**
 * `/cc-tiers:insights` helper. Reads the telemetry events cc-tiers keeps in the
 * plugin data directory and prints what they show: outcomes, failure categories,
 * escalation reasons, estimated cost by risk, unverified gates and how each start
 * tier fared. A "Real use" section does the same for the session state files, as
 * aggregates only. It only describes: it never proposes or applies a routing change.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIERS } from './base.mjs'
import { OVERHEAD, costTotal, own } from './cc_tiers.mjs'
import { readState, sessionFiles, verifyCell } from './report.mjs'
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
  if (!journeys.has(task)) journeys.set(task, { start: '', risk: '', escalated: false, blocking: false, passed: false, stopped: false, finish: '', matches: new Set(), redone: 0, redoTier: '' })
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
    redone: { tasks: 0, byTier: {} },
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
      case 'task.redone':
        if (journey) Object.assign(journey, { redone: journey.redone + 1, redoTier: event.tier || 'unknown' })
        break
      case 'task.redo.undone':
        if (journey) journey.redone = Math.max(0, journey.redone - 1)
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
  for (const journey of journeys.values()) {
    if (journey.redone <= 0) continue
    summary.redone.tasks += 1
    bump(summary.redone.byTier, journey.redoTier)
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
  if (summary.redone.tasks) lines.splice(3, 0, `Sent back by the user: ${summary.redone.tasks} of ${summary.rework.total} tasks.`)
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
  const redoneRows = Object.entries(summary.redone.byTier)
    .sort((a, b) => tierRank(a[0]) - tierRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([tier, count]) => [tier, String(count)])
  lines.push(...table('Sent back by the user, by the tier the task finished on', ['finished on', 'tasks'], redoneRows))
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

const COMPLETIONS = ['verified', 'partial', 'failed', 'unverified']
const UNKNOWN_PROJECT = 'unknown project'

function tierOf(value) {
  return TIERS.includes(value) ? value : 'unknown'
}

function projectRow() {
  return { tasks: 0, finishedOn: {}, clean: 0, redone: 0, usd: 0, opusUsd: 0 }
}

/** The project folder Claude Code names after the working directory; used to group, never printed. */
function projectKey(state) {
  const file = state.cursor?.file
  if (typeof file !== 'string' || !file) return UNKNOWN_PROJECT
  return path.basename(path.dirname(file)) || UNKNOWN_PROJECT
}

/** Aggregates over real session state files. A task is one (session, slug) pair; the orchestration pseudo-task only adds cost. */
export function summarizeSessions(states, { minSample = 10 } = {}) {
  const summary = {
    sessions: 0,
    tasks: 0,
    done: 0,
    redone: 0,
    startedOn: {},
    finishedOn: {},
    clean: 0,
    afterFailure: 0,
    escalated: 0,
    escalatedDone: 0,
    reviewed: 0,
    verify: {},
    completion: {},
    usd: 0,
    opusUsd: 0,
    projects: [],
    sample: 'small',
    notes: [],
  }
  const seen = new Set()
  const projects = new Map()
  for (const state of states) {
    if (!state || typeof state !== 'object') continue
    summary.sessions += 1
    const key = projectKey(state)
    if (!projects.has(key)) projects.set(key, projectRow())
    const project = projects.get(key)
    const log = state.log && typeof state.log === 'object' && !Array.isArray(state.log) ? state.log : {}
    for (const slug of Object.keys(log)) {
      if (slug === OVERHEAD) continue
      if (typeof state.session_id === 'string') {
        const id = `${state.session_id}\0${slug}`
        if (seen.has(id)) continue
        seen.add(id)
      }
      const entry = own(log, slug)
      const task = entry && typeof entry === 'object' ? entry : {}
      const done = task.status === 'done'
      const failures = Number(task.failures) || 0
      summary.tasks += 1
      project.tasks += 1
      bump(summary.startedOn, tierOf(Array.isArray(task.tiers) ? task.tiers[0] : undefined))
      if (task.finished) {
        bump(summary.finishedOn, tierOf(task.finished))
        bump(project.finishedOn, tierOf(task.finished))
      }
      if (done) {
        summary.done += 1
        if (failures === 0) {
          summary.clean += 1
          project.clean += 1
        } else {
          summary.afterFailure += 1
        }
      }
      if (done && Number(task.redo) > 0) {
        summary.redone += 1
        project.redone += 1
      }
      if ((Number(task.escalations) || 0) > 0) {
        summary.escalated += 1
        if (done) summary.escalatedDone += 1
      }
      if (Array.isArray(task.reviews) && task.reviews.length) summary.reviewed += 1
      bump(summary.verify, verifyCell(task.verify, task.hookErrors))
      if (task.completion) bump(summary.completion, COMPLETIONS.includes(task.completion) ? task.completion : 'other')
    }
    const cost = state.cost && typeof state.cost === 'object' ? state.cost : {}
    for (const row of Object.values(cost)) {
      const usd = costTotal(row)
      const opusUsd = Number(row?.opusRate) || 0
      summary.usd += usd
      summary.opusUsd += opusUsd
      project.usd += usd
      project.opusUsd += opusUsd
    }
  }
  // The folder name only breaks ties between projects with the same task count.
  // A project with no task and no cost (a session that only started) is noise, not a row.
  const ordered = [...projects].filter(([, row]) => row.tasks || row.usd || row.opusUsd).sort((a, b) => b[1].tasks - a[1].tasks || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const known = ordered.filter(([key]) => key !== UNKNOWN_PROJECT).map(([, row]) => row)
  summary.projects = known.map((row, index) => ({ label: `project ${index + 1}`, ...row }))
  const unknown = ordered.find(([key]) => key === UNKNOWN_PROJECT)?.[1]
  if (unknown) summary.projects.push({ label: UNKNOWN_PROJECT, ...unknown })
  if (summary.tasks >= minSample) {
    summary.sample = 'enough'
  } else {
    summary.notes.push(`Fewer than ${minSample} tasks: the figures are descriptive only and must not change routing.`)
  }
  return summary
}

export function renderRealUse(summary) {
  if (!summary.sessions) return ''
  const finishedList = (row) => TIERS.map((tier) => String(row.finishedOn[tier] || 0))
  const lines = [
    '## Real use',
    '',
    `${summary.tasks} tasks in ${summary.sessions} sessions: ${summary.done} done, ${summary.tasks - summary.done} not done.`,
    `${summary.redone} of the ${summary.done} done tasks were sent back by the user.`,
    `Sample: ${summary.sample}.`,
  ]
  const tierNames = [...new Set([...TIERS, ...Object.keys(summary.startedOn), ...Object.keys(summary.finishedOn)])]
  lines.push(...table('Tiers', ['tier', 'started on', 'finished on'], tierNames.map((tier) => [tier, String(summary.startedOn[tier] || 0), String(summary.finishedOn[tier] || 0)])))
  lines.push(
    ...table('Outcomes', ['outcome', 'tasks'], [
      ['done with no failure', String(summary.clean)],
      ['done after at least one failure', String(summary.afterFailure)],
      ['escalated', String(summary.escalated)],
      ['escalated, then done', String(summary.escalatedDone)],
      ['reviewed', String(summary.reviewed)],
    ]),
  )
  lines.push(...table('Verify', ['verify', 'tasks'], counts(summary.verify)))
  lines.push(...table('Completion', ['completion', 'tasks'], counts(summary.completion)))
  lines.push('', `Estimated cost: ${dollars(summary.usd)}. The same tokens at Opus rates: ${dollars(summary.opusUsd)}.`)
  const projectRows = summary.projects.map((row) => [row.label, String(row.tasks), ...finishedList(row), String(row.clean), String(row.redone), dollars(row.usd), dollars(row.opusUsd)])
  lines.push(...table('Projects', ['project', 'tasks', ...TIERS.map((tier) => `finished on ${tier}`), 'done with no failure', 'sent back by the user', 'estimated USD', 'at Opus rates USD'], projectRows))
  lines.push(
    '',
    'Not measured: every re-ask. They count only when marked with /cc-tiers:redo or when your prompt names the task and complains about it, so the sent-back figures are a floor; nor what plain Opus would have spent. The Opus-rate column prices the same tokens, and plain Opus would not use exactly those.',
  )
  if (summary.notes.length) lines.push('', ...summary.notes.map((note) => `- ${note}`))
  return `${lines.join('\n')}\n`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const flag = args.indexOf('--sessions')
  const sessionsDir = flag >= 0 ? args[flag + 1] : ''
  const dataDir = args.find((arg, index) => !arg.startsWith('--') && !(flag >= 0 && index === flag + 1)) || process.env.CLAUDE_PLUGIN_DATA || ''
  const events = dataDir ? readEvents(telemetryPath(dataDir)) : []
  const states = sessionFiles(sessionsDir || dataDir, true).map(readState).filter(Boolean)
  const sections = [events.length ? renderInsights(summarize(events)) : '', renderRealUse(summarizeSessions(states))].filter(Boolean)
  process.stdout.write(sections.length ? sections.join('\n') : 'cc-tiers has no telemetry yet.\n')
}
