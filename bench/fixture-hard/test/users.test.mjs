import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createUser, deactivateUser, getUser, listUsers, reset } from '../src/index.js'

beforeEach(() => reset())

test('createUser assigns sequential ids and normalizes the email', async () => {
  const ana = await createUser({ name: ' Ana ', email: 'Ana@Shiftboard.test' })
  const bruno = await createUser({ name: 'Bruno', email: 'bruno@shiftboard.test', role: 'manager', zone: 'Europe/Lisbon' })
  assert.equal(ana.id, 'usr_1')
  assert.equal(ana.name, 'Ana')
  assert.equal(ana.email, 'ana@shiftboard.test')
  assert.equal(ana.zone, 'UTC')
  assert.equal(bruno.id, 'usr_2')
  assert.equal((await listUsers({ role: 'manager' })).length, 1)
})

test('createUser rejects bad input and duplicate emails', async () => {
  await createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  await assert.rejects(createUser({ name: 'Ana 2', email: 'ANA@shiftboard.test' }), { status: 409 })
  await assert.rejects(createUser({ name: 'X', email: 'x@localhost' }), { status: 400 })
  await assert.rejects(createUser({ name: 'X', email: 'x@shiftboard.test', zone: 'Mars/Base' }), /time zone/)
  await assert.rejects(createUser({ name: 'X', email: 'y@shiftboard.test', role: 'admin' }), /role/)
})

test('deactivated users stay readable but cannot be required', async () => {
  const ana = await createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  await deactivateUser(ana.id)
  assert.equal((await getUser(ana.id)).active, false)
  await assert.rejects(deactivateUser(ana.id), { status: 404 })
})
