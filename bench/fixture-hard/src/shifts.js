import { now } from './clock.js'
import { getConfig } from './config.js'
import { NotFoundError, ValidationError } from './errors.js'
import { emit } from './events.js'
import { nextId } from './ids.js'
import { db } from './store.js'
import { HOUR, isValidZone, parseInstant } from './time.js'
import { optionalString, requireInt, requireOneOf, requireString } from './validate.js'

export const STATUSES = ['open', 'full']

// Shifts read in the last cacheTtlMs, by id: { shift, at }. A burst of reads on one shift skips the store.
const cache = new Map()

function remember(shift) {
  cache.set(shift.id, { shift: structuredClone(shift), at: now() })
}

export function forgetCached(id) {
  if (id === undefined) cache.clear()
  else cache.delete(id)
}

export async function createShift({ title, start, end, zone, capacity = 1, location = '' } = {}) {
  const shift = {
    id: '',
    title: requireString(title, 'title', { max: 120 }),
    location: optionalString(location, 'location', { max: 120 }),
    zone: zone ?? getConfig().defaultZone,
    start: parseInstant(start, 'start'),
    end: parseInstant(end, 'end'),
    capacity: requireInt(capacity, 'capacity', { min: 1, max: 50 }),
    status: 'open',
    assignees: [],
    created: now(),
  }
  if (!isValidZone(shift.zone)) throw new ValidationError(`unknown time zone: ${shift.zone}`)
  if (shift.end <= shift.start) throw new ValidationError('end must be after start')
  const limit = getConfig().maxShiftHours
  if (shift.end - shift.start > limit * HOUR) throw new ValidationError(`a shift cannot be longer than ${limit} hours`)
  shift.id = nextId('shf')
  await db.put(`shift:${shift.id}`, shift)
  remember(shift)
  await emit('shift.created', { shiftId: shift.id })
  return structuredClone(shift)
}

export async function getShift(id) {
  const hit = cache.get(id)
  if (hit && now() - hit.at < getConfig().cacheTtlMs) return structuredClone(hit.shift)
  const shift = await db.get(`shift:${id}`)
  if (shift) remember(shift)
  return shift
}

export async function requireShift(id) {
  const shift = await getShift(id)
  if (!shift) throw new NotFoundError(`no such shift: ${id}`)
  return shift
}

/** Writes the whole record back and refreshes the cache. */
export async function saveShift(shift) {
  await db.put(`shift:${shift.id}`, shift)
  remember(shift)
  return structuredClone(shift)
}

export async function listShifts({ status, assignee } = {}) {
  if (status !== undefined) requireOneOf(status, 'status', STATUSES)
  let shifts = await db.list('shift:')
  if (status) shifts = shifts.filter((shift) => shift.status === status)
  if (assignee) shifts = shifts.filter((shift) => shift.assignees.includes(assignee))
  return shifts.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id, 'en', { numeric: true }))
}

export async function updateShift(id, patch = {}) {
  const shift = await requireShift(id)
  if ('title' in patch) shift.title = requireString(patch.title, 'title', { max: 120 })
  if ('location' in patch) shift.location = optionalString(patch.location, 'location', { max: 120 })
  if ('capacity' in patch) {
    shift.capacity = requireInt(patch.capacity, 'capacity', { min: Math.max(1, shift.assignees.length), max: 50 })
    shift.status = shift.assignees.length >= shift.capacity ? 'full' : 'open'
  }
  const saved = await saveShift(shift)
  await emit('shift.updated', { shiftId: id })
  return saved
}
