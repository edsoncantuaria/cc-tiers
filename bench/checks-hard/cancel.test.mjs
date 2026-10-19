import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as app from '../src/index.js'

async function seed() {
  app.reset()
  const manager = await app.createUser({ name: 'Marta', email: 'marta@shiftboard.test', role: 'manager' })
  const ana = await app.createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  const bruno = await app.createUser({ name: 'Bruno', email: 'bruno@shiftboard.test' })
  const shift = await app.createShift({ title: 'Desk', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z', capacity: 3 })
  const token = async (userId) => `Bearer ${(await app.handle({ method: 'POST', path: '/tokens', body: { userId } })).body.token}`
  return { manager, ana, bruno, shift, token }
}

test('cancelShift marks the shift and tells who was on it', async () => {
  const { ana, bruno, shift } = await seed()
  assert.equal(typeof app.cancelShift, 'function')
  await app.claimShift(shift.id, ana.id)
  const events = []
  app.on('shift.cancelled', (payload) => void events.push(payload))
  await app.cancelShift(shift.id, { reason: 'storm' })
  assert.equal((await app.getShift(shift.id)).status, 'cancelled')
  assert.deepEqual(events, [{ shiftId: shift.id, reason: 'storm', assignees: [ana.id] }])
  await assert.rejects(app.claimShift(shift.id, bruno.id), { status: 409 })
  assert.deepEqual((await app.listShifts({ status: 'cancelled' })).map((item) => item.id), [shift.id])
  assert.deepEqual(await app.listShifts({ status: 'open' }), [])
  await assert.rejects(app.cancelShift('shf_99', { reason: 'x' }), { status: 404 })
})

test('POST /shifts/:id/cancel is for managers', async () => {
  const { manager, ana, shift, token } = await seed()
  const path = `/shifts/${shift.id}/cancel`
  assert.equal((await app.handle({ method: 'POST', path, headers: { authorization: await token(ana.id) }, body: { reason: 'x' } })).status, 403)
  const boss = { authorization: await token(manager.id) }
  const response = await app.handle({ method: 'POST', path, headers: boss, body: { reason: 'flood' } })
  assert.ok(response.status >= 200 && response.status < 300, `status ${response.status}`)
  assert.equal((await app.getShift(shift.id)).status, 'cancelled')
  assert.equal((await app.handle({ path: '/shifts?status=cancelled', headers: boss })).body.length, 1)
  assert.equal((await app.handle({ method: 'POST', path: '/shifts/shf_99/cancel', headers: boss, body: { reason: 'x' } })).status, 404)
})
