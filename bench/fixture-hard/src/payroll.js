import { ValidationError } from './errors.js'
import { listShifts } from './shifts.js'
import { addDays, localDate, MINUTE, parseLocalDate, startOfLocalDay, weekStart } from './time.js'
import { requireUser } from './users.js'

/**
 * Minutes of a shift on each local calendar day, in the shift's own zone. A night
 * shift spans two days, and a DST day is 23 or 25 hours long, so the split is at
 * local midnight, never at a fixed 24 hours.
 */
export function splitByLocalDay(shift) {
  const out = []
  let cursor = shift.start
  while (cursor < shift.end) {
    const date = localDate(cursor, shift.zone)
    const next = Math.min(startOfLocalDay(addDays(date, 1), shift.zone), shift.end)
    out.push({ date, minutes: Math.round((next - cursor) / MINUTE) })
    cursor = next
  }
  return out
}

export function sumMinutes(entries) {
  return entries.reduce((total, entry) => total + entry.minutes, 0)
}

function inRange(date, from, to) {
  return (!from || date >= from) && (!to || date <= to)
}

/** Hours a user works per local day between from and to (inclusive, both optional). */
export async function hoursForUser(userId, { from, to } = {}) {
  await requireUser(userId)
  if (from) parseLocalDate(from, 'from')
  if (to) parseLocalDate(to, 'to')
  if (from && to && from > to) throw new ValidationError('from must not be after to')
  const days = new Map()
  for (const shift of await listShifts({ assignee: userId })) {
    for (const entry of splitByLocalDay(shift)) {
      if (inRange(entry.date, from, to)) days.set(entry.date, (days.get(entry.date) || 0) + entry.minutes)
    }
  }
  const entries = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => ({ date, minutes }))
  return {
    userId,
    days: entries.map((entry) => ({ date: entry.date, hours: entry.minutes / 60 })),
    totalHours: sumMinutes(entries) / 60,
  }
}

/** Minutes a user is booked in the Monday-to-Sunday week that contains `date`. */
export async function weekMinutes(userId, date) {
  const first = weekStart(date)
  const last = addDays(first, 6)
  const entries = (await listShifts({ assignee: userId })).flatMap(splitByLocalDay)
  return sumMinutes(entries.filter((entry) => inRange(entry.date, first, last)))
}
