import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { getProfile } from '../src/api.js'

test('the error message is spelled right', () => {
  assert.throws(() => getProfile('x'), /Received invalid id/)
  assert.equal(readFileSync(new URL('../src/api.js', import.meta.url), 'utf8').includes('Recieved'), false)
})
