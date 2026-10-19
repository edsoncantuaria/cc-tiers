import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimShift, createShift, hoursForUser, splitByLocalDay } from '../src/index.js'
import { sumMinutes } from '../src/payroll.js'
import { seed } from './seed.mjs'

test('a night shift is split at local midnight', () => {
  const shift = { start: Date.parse('2026-03-02T22:00:00-05:00'), end: Date.parse('2026-03-03T06:00:00-05:00'), zone: 'America/New_York' }
  assert.deepEqual(splitByLocalDay(shift), [
    { date: '2026-03-02', minutes: 120 },
    { date: '2026-03-03', minutes: 360 },
  ])
})

test('the night the clocks spring forward is an hour shorter', () => {
  const shift = { start: Date.parse('2026-03-07T22:00:00-05:00'), end: Date.parse('2026-03-08T06:00:00-04:00'), zone: 'America/New_York' }
  const days = splitByLocalDay(shift)
  assert.deepEqual(days, [
    { date: '2026-03-07', minutes: 120 },
    { date: '2026-03-08', minutes: 300 },
  ])
  assert.equal(sumMinutes(days), 420)
})

test('hoursForUser groups by local date and honors the range', async () => {
  const { ana } = await seed()
  const night = await createShift({ title: 'Night', start: '2026-03-02T22:00:00-05:00', end: '2026-03-03T06:00:00-05:00', zone: 'America/New_York' })
  const day = await createShift({ title: 'Day', start: '2026-03-04T09:00:00-05:00', end: '2026-03-04T12:30:00-05:00', zone: 'America/New_York' })
  await claimShift(night.id, ana.id)
  await claimShift(day.id, ana.id)
  const all = await hoursForUser(ana.id)
  assert.deepEqual(all.days, [
    { date: '2026-03-02', hours: 2 },
    { date: '2026-03-03', hours: 6 },
    { date: '2026-03-04', hours: 3.5 },
  ])
  assert.equal(all.totalHours, 11.5)
  assert.equal((await hoursForUser(ana.id, { from: '2026-03-03', to: '2026-03-03' })).totalHours, 6)
  await assert.rejects(hoursForUser(ana.id, { from: '2026-03-05', to: '2026-03-01' }), /after/)
})
