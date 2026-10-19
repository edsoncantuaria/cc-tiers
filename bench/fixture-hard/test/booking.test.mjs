import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditLog, claimShift, getShift, releaseShift, swapShift, updateShift } from '../src/index.js'
import { nyShift, seed } from './seed.mjs'

test('claimShift adds the worker and fills the shift', async () => {
  const { ana, bruno } = await seed()
  const shift = await nyShift('2026-03-02', '09:00', '17:00', { capacity: 2 })
  await claimShift(shift.id, ana.id)
  const full = await claimShift(shift.id, bruno.id)
  assert.deepEqual(full.assignees, [ana.id, bruno.id])
  assert.equal(full.status, 'full')
  assert.equal(auditLog({ type: 'shift.claimed' }).length, 2)
})

test('claimShift enforces capacity, duplicates, and unknown ids', async () => {
  const { manager, ana, bruno } = await seed()
  const shift = await nyShift('2026-03-02')
  await claimShift(shift.id, ana.id)
  await assert.rejects(claimShift(shift.id, ana.id), { status: 409 })
  await assert.rejects(claimShift(shift.id, bruno.id), /capacity/i)
  await assert.rejects(claimShift('shf_99', manager.id), { status: 404 })
  await assert.rejects(claimShift(shift.id, 'usr_99'), { status: 404 })
})

test('claimShift refuses overlapping shifts and too many weekly hours', async () => {
  const { ana } = await seed()
  const morning = await nyShift('2026-03-02', '08:00', '12:00')
  const overlap = await nyShift('2026-03-02', '11:00', '15:00')
  await claimShift(morning.id, ana.id)
  await assert.rejects(claimShift(overlap.id, ana.id), /overlaps/)
  for (const day of ['2026-03-03', '2026-03-04', '2026-03-05']) await claimShift((await nyShift(day, '06:00', '18:00')).id, ana.id)
  const friday = await nyShift('2026-03-06', '09:00', '13:00')
  await assert.rejects(claimShift(friday.id, ana.id), /40 hours/)
  const nextMonday = await nyShift('2026-03-09', '09:00', '13:00')
  assert.equal((await claimShift(nextMonday.id, ana.id)).assignees[0], ana.id)
})

test('releaseShift and swapShift', async () => {
  const { ana, bruno } = await seed()
  const shift = await nyShift('2026-03-02')
  await claimShift(shift.id, ana.id)
  const swapped = await swapShift(shift.id, ana.id, bruno.id)
  assert.deepEqual(swapped.assignees, [bruno.id])
  const released = await releaseShift(shift.id, bruno.id)
  assert.deepEqual(released.assignees, [])
  assert.equal(released.status, 'open')
  await assert.rejects(releaseShift(shift.id, bruno.id), { status: 404 })
})

test('updateShift does not drop the crew', async () => {
  const { ana } = await seed()
  const shift = await nyShift('2026-03-02', '09:00', '17:00', { capacity: 3 })
  await claimShift(shift.id, ana.id)
  await updateShift(shift.id, { title: 'Renamed' })
  assert.deepEqual((await getShift(shift.id)).assignees, [ana.id])
})
