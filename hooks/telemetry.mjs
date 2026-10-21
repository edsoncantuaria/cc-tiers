/**
 * Local event log of what cc-tiers decided: one JSON line per event in
 * events.jsonl, enumerated fields only (never prompts), scrubbed with redact.mjs.
 * It rotates once to events.1.jsonl and never throws, so a telemetry failure
 * cannot break a hook.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { clip } from './redact.mjs'

export const TELEMETRY_LEVELS = ['on', 'reduced', 'off']

export const EVENT_TYPES = [
  'task.received',
  'risk.assessed',
  'model.selected',
  'research.done',
  'criteria.defined',
  'implementation.done',
  'verify.done',
  'failure.diagnosed',
  'escalated',
  'review.done',
  'task.passed',
  'task.stopped',
  'budget.warning',
  'state.recovered',
]

export const REDUCED_TYPES = ['escalated', 'failure.diagnosed', 'task.passed', 'task.stopped', 'budget.warning']

const TEXT_KEYS = ['ts', 'type', 'session', 'task', 'tier', 'role', 'risk', 'because', 'category', 'outcome', 'status', 'confidence', 'effort']
const NUMBER_KEYS = ['attempt', 'costUsd', 'tokens', 'durationMs', 'calls']
const FLAG_KEYS = ['confirmed', 'costEstimated']
const GATE_KEYS = ['verified', 'failed', 'unverified', 'flaky']
const REVIEW_KEYS = ['blocking', 'discarded', 'notes']
const MAX_FACTORS = 8

/** `/config` stores telemetry as on/reduced/off. Project files may say true or false. */
export function parseTelemetry(value, fallback = 'on') {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  const text = String(value).trim().toLowerCase()
  if (TELEMETRY_LEVELS.includes(text)) return text
  if (['true', 'yes', '1'].includes(text)) return 'on'
  if (['false', 'no', '0'].includes(text)) return 'off'
  return fallback
}

export function telemetryPath(dataDir) {
  return path.join(dataDir, 'events.jsonl')
}

function rotatedPath(file) {
  return path.join(path.dirname(file), 'events.1.jsonl')
}

function countsOf(source, keys) {
  const out = {}
  if (!source || typeof source !== 'object') return out
  for (const key of keys) if (Number.isFinite(source[key])) out[key] = source[key]
  return out
}

/** The event reduced to the whitelisted keys, strings clipped and redacted; null for an unknown type. */
export function sanitizeEvent(event) {
  if (!event || typeof event !== 'object' || !EVENT_TYPES.includes(event.type)) return null
  const out = {}
  for (const key of TEXT_KEYS) {
    if (typeof event[key] === 'string' && event[key]) out[key] = clip(event[key], 80)
  }
  for (const key of NUMBER_KEYS) if (Number.isFinite(event[key])) out[key] = event[key]
  for (const key of FLAG_KEYS) if (typeof event[key] === 'boolean') out[key] = event[key]
  if (typeof event.reason === 'string' && event.reason) out.reason = clip(event.reason, 200)
  if (Array.isArray(event.factors)) {
    out.factors = event.factors.filter((item) => typeof item === 'string').slice(0, MAX_FACTORS).map((item) => clip(item, 80))
  }
  if (event.gate && typeof event.gate === 'object') out.gate = countsOf(event.gate, GATE_KEYS)
  if (event.review && typeof event.review === 'object') out.review = countsOf(event.review, REVIEW_KEYS)
  // A cost here is always derived from token counts, never a billed amount.
  if ('costUsd' in out && typeof out.costEstimated !== 'boolean') out.costEstimated = true
  return out
}

/** Appends one sanitized event; true when it wrote. Never throws. */
export function recordEvent(file, event, { level = 'on', now = Date.now(), maxBytes = 1000000 } = {}) {
  try {
    if (level === 'off') return false
    const clean = sanitizeEvent(event)
    if (!clean) return false
    if (level === 'reduced' && !REDUCED_TYPES.includes(clean.type)) return false
    if (!clean.ts) clean.ts = new Date(now).toISOString()
    mkdirSync(path.dirname(file), { recursive: true })
    try {
      if (statSync(file).size > maxBytes) renameSync(file, rotatedPath(file))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    appendFileSync(file, `${JSON.stringify(clean)}\n`)
    return true
  } catch {
    return false
  }
}

function readLines(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed)
    } catch {
      // A torn or hand-edited line is skipped, the rest still counts.
    }
  }
  return events
}

/** Events of events.1.jsonl then the file; malformed lines are skipped. */
export function readEvents(file) {
  return [...readLines(rotatedPath(file)), ...readLines(file)]
}
