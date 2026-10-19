import { ValidationError } from './errors.js'

export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE

const formatters = new Map()

function formatter(zone) {
  let value = formatters.get(zone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, value)
  }
  return value
}

export function isValidZone(zone) {
  if (typeof zone !== 'string' || !zone) return false
  try {
    formatter(zone)
    return true
  } catch {
    return false
  }
}

/** Wall-clock fields of an instant in a zone: { year, month, day, hour, minute, second }. */
export function zoneParts(instant, zone) {
  const parts = {}
  for (const { type, value } of formatter(zone).formatToParts(new Date(instant))) {
    if (type !== 'literal') parts[type] = Number(value)
  }
  return parts
}

/** Minutes the zone is ahead of UTC at that instant: -240 for New York in summer, 540 for Tokyo. */
export function zoneOffset(instant, zone) {
  const p = zoneParts(instant, zone)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((wall - Math.floor(instant / 1000) * 1000) / MINUTE)
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/** An ISO time with an explicit offset or Z. A bare local time is refused: it would mean the server's zone. */
export function parseInstant(value, field = 'time') {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) {
    throw new ValidationError(`${field} must be an ISO time with an offset, like 2026-03-01T09:00:00-05:00`)
  }
  parseLocalDate(value.slice(0, 10), field)
  return Date.parse(value)
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' to { year, month, day }. Refuses dates that do not exist, which Date.parse would roll over. */
export function parseLocalDate(value, field = 'date') {
  const match = typeof value === 'string' && LOCAL_DATE.exec(value)
  if (!match) throw new ValidationError(`${field} must be YYYY-MM-DD`)
  const [year, month, day] = match.slice(1).map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ValidationError(`${field} is not a real date: ${value}`)
  }
  return { year, month, day }
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

export function formatDate({ year, month, day }) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** The calendar date of an instant in a zone. */
export function localDate(instant, zone) {
  return formatDate(zoneParts(instant, zone))
}

/** 'YYYY-MM-DD HH:mm' in the zone. */
export function formatLocal(instant, zone) {
  const p = zoneParts(instant, zone)
  return `${formatDate(p)} ${pad(p.hour)}:${pad(p.minute)}`
}

export function addDays(date, days) {
  const { year, month, day } = parseLocalDate(date)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return formatDate({ year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() })
}

/**
 * The instant a local date begins in a zone. A day is not always 24 hours, so
 * the offset is read at the first guess and corrected once.
 */
export function startOfLocalDay(date, zone) {
  const { year, month, day } = parseLocalDate(date)
  const wall = Date.UTC(year, month - 1, day)
  const guess = wall - zoneOffset(wall, zone) * MINUTE
  return wall - zoneOffset(guess, zone) * MINUTE
}

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * The instant a wall-clock time happens on a local date in a zone. A time that
 * does not exist (inside the spring-forward gap) lands just after the gap.
 */
export function localToInstant(date, time, zone) {
  const { year, month, day } = parseLocalDate(date)
  const match = typeof time === 'string' && WALL_TIME.exec(time)
  if (!match) throw new ValidationError(`time must be HH:mm, got ${time}`)
  const wall = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]))
  const guess = wall - zoneOffset(wall, zone) * MINUTE
  return wall - zoneOffset(guess, zone) * MINUTE
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function weekdayOf(date) {
  const { year, month, day } = parseLocalDate(date)
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

/** The Monday on or before a local date. */
export function weekStart(date) {
  const { year, month, day } = parseLocalDate(date)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}

export function minutesBetween(start, end) {
  return Math.round((end - start) / MINUTE)
}
