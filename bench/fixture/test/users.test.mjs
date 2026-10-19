import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchUser, listUsers, validateEmail } from '../src/users.js'

test('fetchUser finds a user by id', () => {
  assert.equal(fetchUser(1).name, 'Ana')
  assert.equal(fetchUser(999), null)
})

test('listUsers returns every user', () => {
  assert.equal(listUsers().length, 23)
})

test('validateEmail accepts a plain address', () => {
  assert.equal(validateEmail('ana@example.com'), true)
  assert.equal(validateEmail('nope'), false)
})
