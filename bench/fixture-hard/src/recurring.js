import { ValidationError } from './errors.js'
import { createShift } from './shifts.js'
import { addDays, isValidZone, localToInstant, parseLocalDate, weekdayOf, WEEKDAYS } from './time.js'

const MAX_DAYS = 62

/**
 * Creates one shift per matching local date between from and to (inclusive).
 * Times are wall-clock times in the zone, so a 22:00 start stays 22:00 across a
 * DST change; an end at or before the start means the next morning.
 */
export async function createRecurring({ title, location, zone, capacity, from, to, weekdays, startTime, endTime } = {}) {
  parseLocalDate(from, 'from')
  parseLocalDate(to, 'to')
  if (from > to) throw new ValidationError('from must not be after to')
  if (addDays(from, MAX_DAYS) <= to) throw new ValidationError(`a series covers at most ${MAX_DAYS} days`)
  if (!isValidZone(zone)) throw new ValidationError(`unknown time zone: ${zone}`)
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => !WEEKDAYS.includes(day))) {
    throw new ValidationError(`weekdays must be a list of ${WEEKDAYS.join(', ')}`)
  }
  const created = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!weekdays.includes(weekdayOf(date))) continue
    const start = localToInstant(date, startTime, zone)
    const end = localToInstant(endTime <= startTime ? addDays(date, 1) : date, endTime, zone)
    created.push(
      await createShift({
        title,
        location,
        zone,
        capacity,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
    )
  }
  return created
}
