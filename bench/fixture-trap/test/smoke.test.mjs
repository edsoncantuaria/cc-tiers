import assert from 'node:assert/strict'
import { test } from 'node:test'
import dotenv from 'dotenv'

test('the installed dotenv parses a simple line', () => {
  assert.deepEqual(dotenv.parse('APP_NAME=billing'), { APP_NAME: 'billing' })
})
