import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createShift, getShift, listShifts, reset, updateShift } from '../src/index.js'

beforeEach(() => reset())

test('createShift stores instants and the zone', async () => {
  const shift = await createShift({ title: 'Front desk', start: '2026-03-02T09:00:00-05:00', end: '2026-03-02T17:00:00-05:00', zone: 'America/New_York', capacity: 2 })
  assert.equal(shift.id, 'shf_1')
  assert.equal(shift.start, Date.parse('2026-03-02T14:00:00Z'))
  assert.equal(shift.status, 'open')
  assert.deepEqual(shift.assignees, [])
  assert.deepEqual(await getShift('shf_1'), shift)
  assert.equal(await getShift('shf_9'), null)
})

test('createShift validates times, zone, length, and capacity', async () => {
  const base = { title: 'X', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z' }
  await assert.rejects(createShift({ ...base, end: '2026-03-02T08:00:00Z' }), /after start/)
  await assert.rejects(createShift({ ...base, start: '2026-03-02T09:00:00' }), /offset/)
  await assert.rejects(createShift({ ...base, end: '2026-03-03T09:00:00Z' }), /16 hours/)
  await assert.rejects(createShift({ ...base, zone: 'Nowhere' }), /time zone/)
  await assert.rejects(createShift({ ...base, capacity: 0 }), /capacity/)
})

test('listShifts sorts by start and filters by status', async () => {
  await createShift({ title: 'Late', start: '2026-03-03T09:00:00Z', end: '2026-03-03T10:00:00Z' })
  await createShift({ title: 'Early', start: '2026-03-02T09:00:00Z', end: '2026-03-02T10:00:00Z' })
  assert.deepEqual((await listShifts()).map((shift) => shift.title), ['Early', 'Late'])
  assert.equal((await listShifts({ status: 'full' })).length, 0)
  await assert.rejects(listShifts({ status: 'nope' }), /status/)
})

test('updateShift keeps capacity above the current crew', async () => {
  await createShift({ title: 'X', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z', capacity: 3 })
  const updated = await updateShift('shf_1', { title: 'Y', capacity: 1 })
  assert.equal(updated.title, 'Y')
  assert.equal(updated.capacity, 1)
  assert.equal((await getShift('shf_1')).title, 'Y')
  await assert.rejects(updateShift('shf_2', { title: 'Z' }), { status: 404 })
})
