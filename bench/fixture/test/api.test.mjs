import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProfile, inviteUser } from '../src/api.js'

test('getProfile adds a slug', () => {
  assert.equal(getProfile(1).slug, 'ana')
})

test('inviteUser rejects a bad email', () => {
  assert.equal(inviteUser('x').ok, false)
})
