import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as users from '../src/users.js'
import { getProfile } from '../src/api.js'

test('fetchUser is now loadUser everywhere', () => {
  assert.equal(typeof users.loadUser, 'function')
  assert.equal('fetchUser' in users, false)
  assert.equal(users.loadUser(2).name, 'Bruno')
  assert.equal(getProfile(2).name, 'Bruno')
  for (const file of ['../src/users.js', '../src/api.js']) {
    assert.equal(readFileSync(new URL(file, import.meta.url), 'utf8').includes('fetchUser'), false, file)
  }
})
