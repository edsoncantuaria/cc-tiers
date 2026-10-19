import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRecurring, reset } from '../src/index.js'
import { localToInstant } from '../src/time.js'

const NIGHTS = { title: 'Watch', zone: 'America/New_York', startTime: '09:00', endTime: '13:00', weekdays: ['mon'] }

test('a series may cover 92 days', async () => {
  reset()
  assert.equal((await createRecurring({ ...NIGHTS, from: '2026-01-01', to: '2026-04-02' })).length, 13)
  await assert.rejects(createRecurring({ ...NIGHTS, from: '2026-01-01', to: '2026-04-03' }), /at most 92 days/)
})

test('skip leaves dates out and is validated', async () => {
  reset()
  const base = { ...NIGHTS, weekdays: ['mon', 'wed', 'fri'], from: '2026-03-02', to: '2026-03-08' }
  const kept = await createRecurring({ ...base, skip: ['2026-03-04', '2026-05-01'] })
  assert.deepEqual(kept.map((shift) => new Date(shift.start).toISOString().slice(0, 10)), ['2026-03-02', '2026-03-06'])
  assert.equal((await createRecurring({ ...base, skip: [] })).length, 3)
  for (const bad of ['2026-02-30', '2026-3-4', 'soon']) {
    await assert.rejects(createRecurring({ ...base, skip: [bad] }), { status: 400 }, bad)
  }
})

test('wall times in a spring-forward gap move forward by the gap', () => {
  const cases = [
    ['2026-03-08', '02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
    ['2026-03-29', '01:30', 'Europe/Lisbon', '2026-03-29T01:30:00.000Z'],
    ['2026-10-04', '02:15', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z'],
    ['2026-09-06', '00:30', 'America/Santiago', '2026-09-06T04:30:00.000Z'],
  ]
  for (const [date, time, zone, expected] of cases) assert.equal(new Date(localToInstant(date, time, zone)).toISOString(), expected, `${zone} ${date} ${time}`)
})

test('repeated wall times mean the first occurrence', () => {
  const cases = [
    ['2026-11-01', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-10-25', '01:30', 'Europe/Lisbon', '2026-10-25T00:30:00.000Z'],
    ['2026-04-05', '01:45', 'Australia/Lord_Howe', '2026-04-04T14:45:00.000Z'],
    ['2026-04-04', '23:30', 'America/Santiago', '2026-04-05T02:30:00.000Z'],
  ]
  for (const [date, time, zone, expected] of cases) assert.equal(new Date(localToInstant(date, time, zone)).toISOString(), expected, `${zone} ${date} ${time}`)
})

test('ordinary times and recurring series follow the same rule', async () => {
  reset()
  assert.equal(new Date(localToInstant('2026-07-01', '09:00', 'America/New_York')).toISOString(), '2026-07-01T13:00:00.000Z')
  assert.equal(new Date(localToInstant('2026-07-01', '09:00', 'Asia/Kolkata')).toISOString(), '2026-07-01T03:30:00.000Z')
  const [early] = await createRecurring({ title: 'Early', zone: 'America/New_York', startTime: '02:30', endTime: '06:00', weekdays: ['sun'], from: '2026-03-08', to: '2026-03-08' })
  assert.equal(new Date(early.start).toISOString(), '2026-03-08T07:30:00.000Z')
  assert.equal(early.end - early.start, 2.5 * 3600 * 1000)
  const [late] = await createRecurring({ title: 'Late', zone: 'Europe/Lisbon', startTime: '22:00', endTime: '01:30', weekdays: ['sat'], from: '2026-10-24', to: '2026-10-24' })
  assert.equal(new Date(late.end).toISOString(), '2026-10-25T00:30:00.000Z')
})
