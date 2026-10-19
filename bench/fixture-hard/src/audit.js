import { now } from './clock.js'
import { on } from './events.js'

const TYPES = [
  'user.created',
  'user.deactivated',
  'shift.created',
  'shift.updated',
  'shift.claimed',
  'shift.released',
  'shift.swapped',
  'attachment.saved',
]

const entries = []

/** Records every domain event in memory, oldest first. Returns a function that stops recording. */
export function startAudit() {
  const stops = TYPES.map((type) => on(type, (payload) => void entries.push({ at: now(), type, ...payload })))
  return () => stops.forEach((stop) => stop())
}

export function auditLog({ type } = {}) {
  return entries.filter((entry) => !type || entry.type === type).map((entry) => ({ ...entry }))
}

export function resetAudit() {
  entries.length = 0
}
