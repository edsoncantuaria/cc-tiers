import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, formatLocal, localDate, parseInstant, parseLocalDate, startOfLocalDay, weekStart, zoneOffset } from '../src/time.js'

test('localDate reads the calendar in the given zone', () => {
  const instant = Date.parse('2026-03-01T03:30:00Z')
  assert.equal(localDate(instant, 'UTC'), '2026-03-01')
  assert.equal(localDate(instant, 'America/New_York'), '2026-02-28')
  assert.equal(localDate(instant, 'Asia/Tokyo'), '2026-03-01')
})

test('zoneOffset follows daylight saving time', () => {
  assert.equal(zoneOffset(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York'), -300)
  assert.equal(zoneOffset(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York'), -240)
  assert.equal(zoneOffset(Date.parse('2026-07-15T12:00:00Z'), 'Asia/Kolkata'), 330)
})

test('startOfLocalDay handles the short and the long day', () => {
  assert.equal(startOfLocalDay('2026-03-08', 'America/New_York'), Date.parse('2026-03-08T05:00:00Z'))
  assert.equal(startOfLocalDay('2026-03-09', 'America/New_York'), Date.parse('2026-03-09T04:00:00Z'))
  assert.equal(startOfLocalDay('2026-11-01', 'America/New_York'), Date.parse('2026-11-01T04:00:00Z'))
  assert.equal(startOfLocalDay('2026-11-02', 'America/New_York'), Date.parse('2026-11-02T05:00:00Z'))
})

test('parseLocalDate refuses dates that do not exist', () => {
  assert.deepEqual(parseLocalDate('2028-02-29'), { year: 2028, month: 2, day: 29 })
  assert.throws(() => parseLocalDate('2026-02-29'), /not a real date/)
  assert.throws(() => parseLocalDate('2026-2-1'), /YYYY-MM-DD/)
})

test('parseInstant wants an explicit offset', () => {
  assert.equal(parseInstant('2026-03-01T09:00:00-05:00'), Date.parse('2026-03-01T14:00:00Z'))
  assert.throws(() => parseInstant('2026-03-01T09:00:00'), /offset/)
  assert.throws(() => parseInstant('2026-02-30T09:00:00Z'), /not a real date/)
})

test('calendar helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(weekStart('2026-03-08'), '2026-03-02')
  assert.equal(weekStart('2026-03-02'), '2026-03-02')
  assert.equal(formatLocal(Date.parse('2026-03-01T14:00:00Z'), 'America/New_York'), '2026-03-01 09:00')
})
