import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as app from '../src/index.js'

const NOW = Date.parse('2026-03-05T12:00:00Z')

async function seed() {
  app.reset()
  app.setClock(() => NOW)
  const manager = await app.createUser({ name: 'Marta', email: 'marta@shiftboard.test', role: 'manager' })
  const ana = await app.createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  const bruno = await app.createUser({ name: 'Bruno', email: 'bruno@shiftboard.test' })
  const make = (start, end, capacity = 1) => app.createShift({ title: start, start, end, capacity })
  const shifts = {
    past: await make('2026-03-02T09:00:00Z', '2026-03-02T17:00:00Z'),
    running: await make('2026-03-05T06:00:00Z', '2026-03-05T12:00:00Z'),
    startsNow: await make('2026-03-05T12:00:00Z', '2026-03-05T18:00:00Z'),
    tomorrow: await make('2026-03-06T09:00:00Z', '2026-03-06T17:00:00Z'),
    shared: await make('2026-03-09T09:00:00Z', '2026-03-09T17:00:00Z', 2),
  }
  for (const shift of Object.values(shifts)) await app.claimShift(shift.id, ana.id)
  await app.claimShift(shifts.shared.id, bruno.id)
  const token = async (userId) => ({ authorization: `Bearer ${(await app.handle({ method: 'POST', path: '/tokens', body: { userId } })).body.token}` })
  return { manager, ana, bruno, shifts, token }
}

test('the event is now user.offboarded', async () => {
  const { ana } = await seed()
  const seen = []
  app.on('user.offboarded', (payload) => void seen.push(payload))
  app.on('user.deactivated', () => assert.fail('old event still emitted'))
  await app.deactivateUser(ana.id)
  assert.deepEqual(seen, [{ userId: ana.id }])
  assert.equal(app.auditLog({ type: 'user.offboarded' }).length, 1)
  for (const name of readdirSync(new URL('../src/', import.meta.url))) {
    assert.equal(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8').includes('user.deactivated'), false, name)
  }
})

test('offboarding releases only the shifts that have not started', async () => {
  const { ana, bruno, shifts } = await seed()
  const released = []
  app.on('shift.released', (payload) => void released.push(payload))
  const user = await app.deactivateUser(ana.id)
  assert.equal(user.id, ana.id)
  assert.equal(user.active, false)
  const crew = async (shift) => (await app.getShift(shift.id)).assignees
  assert.deepEqual(await crew(shifts.past), [ana.id])
  assert.deepEqual(await crew(shifts.running), [ana.id])
  assert.deepEqual(await crew(shifts.startsNow), [ana.id])
  assert.deepEqual(await crew(shifts.tomorrow), [])
  assert.deepEqual(await crew(shifts.shared), [bruno.id])
  assert.equal((await app.getShift(shifts.tomorrow.id)).status, 'open')
  assert.equal((await app.getShift(shifts.shared.id)).status, 'open')
  assert.deepEqual(released.sort((a, b) => a.shiftId.localeCompare(b.shiftId)), [
    { shiftId: shifts.tomorrow.id, userId: ana.id },
    { shiftId: shifts.shared.id, userId: ana.id },
  ].sort((a, b) => a.shiftId.localeCompare(b.shiftId)))
})

test('tokens of offboarded or unknown users stop working at once', async () => {
  const { manager, ana, bruno, token } = await seed()
  const worker = await token(ana.id)
  const other = await token(bruno.id)
  const boss = await token(manager.id)
  assert.equal((await app.handle({ path: '/shifts', headers: worker })).status, 200)
  await app.deactivateUser(ana.id)
  assert.equal((await app.handle({ path: '/shifts', headers: worker })).status, 401)
  assert.equal((await app.handle({ path: `/payroll/${ana.id}`, headers: worker })).status, 401)
  assert.equal((await app.handle({ method: 'POST', path: '/shifts/shf_4/claim', headers: worker })).status, 401)
  assert.equal((await app.handle({ path: '/shifts', headers: other })).status, 200)
  assert.equal((await app.handle({ method: 'POST', path: '/tokens', body: { userId: ana.id } })).status, 404)
  await app.deactivateUser(manager.id)
  const create = { title: 'X', start: '2026-03-10T09:00:00Z', end: '2026-03-10T17:00:00Z' }
  assert.equal((await app.handle({ method: 'POST', path: '/shifts', headers: boss, body: create })).status, 401)
  const ghost = { authorization: `Bearer ${app.signToken({ sub: 'usr_99', role: 'manager' })}` }
  assert.equal((await app.handle({ path: '/users', headers: ghost })).status, 401)
  assert.equal((await app.handle({ path: '/shifts', headers: ghost })).status, 401)
})
