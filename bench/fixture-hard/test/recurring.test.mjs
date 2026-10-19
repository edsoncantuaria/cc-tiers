import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRecurring, handle } from '../src/index.js'
import { seed, tokenFor } from './seed.mjs'

const NIGHTS = { title: 'Night watch', zone: 'America/New_York', startTime: '22:00', endTime: '06:00' }

test('a weekly series keeps its wall-clock times across the DST change', async () => {
  await seed()
  const shifts = await createRecurring({ ...NIGHTS, from: '2026-03-02', to: '2026-03-15', weekdays: ['sat'] })
  assert.equal(shifts.length, 2)
  assert.deepEqual(shifts.map((shift) => new Date(shift.start).toISOString()), ['2026-03-08T03:00:00.000Z', '2026-03-15T02:00:00.000Z'])
  assert.equal(shifts[0].end - shifts[0].start, 7 * 3600 * 1000)
  assert.equal(shifts[1].end - shifts[1].start, 8 * 3600 * 1000)
})

test('day shifts on chosen weekdays', async () => {
  await seed()
  const shifts = await createRecurring({ title: 'Desk', zone: 'Europe/Lisbon', startTime: '09:00', endTime: '13:00', from: '2026-03-02', to: '2026-03-08', weekdays: ['mon', 'wed', 'fri'] })
  assert.deepEqual(shifts.map((shift) => shift.id), ['shf_1', 'shf_2', 'shf_3'])
  assert.equal(new Date(shifts[2].start).toISOString(), '2026-03-06T09:00:00.000Z')
})

test('a series is validated before anything is created', async () => {
  await seed()
  await assert.rejects(createRecurring({ ...NIGHTS, from: '2026-03-10', to: '2026-03-01', weekdays: ['mon'] }), /after/)
  await assert.rejects(createRecurring({ ...NIGHTS, from: '2026-01-01', to: '2026-06-01', weekdays: ['mon'] }), /at most/)
  await assert.rejects(createRecurring({ ...NIGHTS, from: '2026-03-01', to: '2026-03-02', weekdays: ['monday'] }), /weekdays/)
  await assert.rejects(createRecurring({ ...NIGHTS, startTime: '25:00', from: '2026-03-01', to: '2026-03-02', weekdays: ['mon'] }), /HH:mm/)
})

test('managers create a series over HTTP', async () => {
  const { manager, ana } = await seed()
  const body = { ...NIGHTS, from: '2026-03-02', to: '2026-03-08', weekdays: ['tue', 'thu'] }
  assert.equal((await handle({ method: 'POST', path: '/shifts/recurring', headers: await tokenFor(ana.id), body })).status, 403)
  const response = await handle({ method: 'POST', path: '/shifts/recurring', headers: await tokenFor(manager.id), body })
  assert.equal(response.status, 201)
  assert.equal(response.body.length, 2)
})
