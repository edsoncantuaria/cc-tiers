/**
 * Per-task budget: parse the limits, compare them with the session usage and word the warning.
 * Calls and elapsed time are measured; usd is an estimate, and the message says so.
 */

import { dollars } from './base.mjs'

const DEFAULT_WARN_PERCENT = 80
const MIN_WARN_PERCENT = 50
const MAX_WARN_PERCENT = 99
/** Same shape as CC_TIERS_RESEARCH: none - <reason>. */
export const BUDGET_OVERRIDE_RE = /^override\s*-\s*\S/i
const LIMIT_NAMES = ['usd', 'calls', 'minutes']

/** A finite number above 0 from a number or numeric string; anything else is 0. */
function positive(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function warnFraction(percent) {
  const number = positive(percent)
  if (!number) return DEFAULT_WARN_PERCENT / 100
  return Math.min(MAX_WARN_PERCENT, Math.max(MIN_WARN_PERCENT, number)) / 100
}

/** Reads the task_budget_* and budget_warn_at config keys; 0 means the limit is off. */
export function parseTaskBudget(config) {
  const source = config || {}
  return {
    usd: positive(source.task_budget_usd),
    calls: positive(source.task_budget_calls),
    minutes: positive(source.task_budget_minutes),
    warnAt: warnFraction(source.budget_warn_at),
  }
}

/** warnAt as a percent without float noise: 0.55 * 100 is 55.00000000000001. */
function warnPercent(warnAt) {
  return Math.round(warnAt * 1e6) / 1e4
}

/** Compares the usage with the limits; `near` holds the limits close to but not yet at their value. */
export function budgetStatus(usage, limits, options) {
  const { usd, calls, startedMs } = usage || {}
  const { now = Date.now(), critical = false } = options || {}
  const active = {
    usd: positive(limits?.usd),
    calls: positive(limits?.calls),
    minutes: positive(limits?.minutes),
  }
  const warnAt = limits?.warnAt >= 0.5 && limits.warnAt <= 0.99 ? limits.warnAt : DEFAULT_WARN_PERCENT / 100
  const percent = warnPercent(warnAt)
  const started = positive(startedMs)
  const measured = {
    calls: positive(calls),
    elapsedMinutes: started ? Math.max(0, (positive(now) - started) / 60000) : 0,
  }
  const estimated = { usd: positive(usd) }
  const values = { usd: estimated.usd, calls: measured.calls, minutes: measured.elapsedMinutes }
  const names = LIMIT_NAMES.filter((name) => active[name])
  const over = names.filter((name) => values[name] >= active[name])
  const near = names.filter((name) => !over.includes(name) && values[name] * 100 >= percent * active[name])
  let state = 'ok'
  if (!names.length) state = 'off'
  else if (over.length) state = 'over'
  else if (near.length) state = 'near'
  return { state, over, near, measured, estimated, limits: active, critical: Boolean(critical) }
}

function minutesText(value) {
  return String(Math.round(value * 10) / 10)
}

function describe(name, status) {
  const limit = status.limits[name]
  if (name === 'usd') return `usd about ${dollars(status.estimated.usd)} (estimated) / about ${dollars(limit)}`
  if (name === 'calls') return `calls ${status.measured.calls}/${limit}`
  return `minutes ${minutesText(status.measured.elapsedMinutes)}/${minutesText(limit)}`
}

/** One line for near, a longer notice for over; '' when there is nothing to say. */
export function budgetMessage(task, status) {
  if (status?.state === 'near') {
    return `cc-tiers: ${task} is close to its budget (${status.near.map((name) => describe(name, status)).join(', ')}).`
  }
  if (status?.state !== 'over') return ''
  let message =
    `cc-tiers: ${task} reached its budget (${status.over.map((name) => describe(name, status)).join(', ')}). ` +
    'cc-tiers refuses new writer calls for it; review and verification calls still run. ' +
    'After the user agrees, the orchestrator adds the line "CC_TIERS_BUDGET: override - <reason>" to the prompt.'
  if (status.critical) {
    message +=
      ' This task is critical, so stopping it leaves it unverified: get the user\'s decision instead of silently skipping checks.'
  }
  return message
}
