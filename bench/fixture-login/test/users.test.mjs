import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPassword, findUserByEmail, findUserById, publicUser } from '../src/users.js'

test('users are found by email, ignoring case and spaces', () => {
  assert.equal(findUserByEmail('bruno@shiftlite.dev').id, 'u_3b9d07')
  assert.equal(findUserByEmail('  Bruno@ShiftLite.dev ').id, 'u_3b9d07')
  assert.equal(findUserByEmail('nobody@shiftlite.dev'), undefined)
})

test('users are found by id', () => {
  assert.equal(findUserById('u_c61e5a').email, 'carla@shiftlite.dev')
  assert.equal(findUserById('u_000000'), undefined)
})

test('checkPassword accepts the right password only', () => {
  const user = findUserByEmail('bruno@shiftlite.dev')
  assert.equal(checkPassword(user, 'winter-shift-42'), true)
  assert.equal(checkPassword(user, 'winter-shift-43'), false)
  assert.equal(checkPassword(user, ''), false)
})

test('publicUser leaves the password hash out', () => {
  assert.deepEqual(publicUser(findUserById('u_c61e5a')), { id: 'u_c61e5a', name: 'Carla Mendes', email: 'carla@shiftlite.dev' })
})
