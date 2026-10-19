import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as text from '../src/text.js'
import { validateEmail } from '../src/users.js'
import { getProfile } from '../src/api.js'

test('slugify is now toSlug', () => {
  assert.equal(typeof text.toSlug, 'function')
  assert.equal('slugify' in text, false)
  assert.equal(text.toSlug('João Silva'), 'joao-silva')
  assert.equal(getProfile(10).slug, 'joao')
  assert.equal(readFileSync(new URL('../src/api.js', import.meta.url), 'utf8').includes('slugify'), false)
})

test('validateEmail wants a dot in the domain', () => {
  assert.equal(validateEmail('ana@example.com'), true)
  assert.equal(validateEmail('ana@localhost'), false)
  assert.equal(validateEmail('ana@example.'), false)
  assert.equal(validateEmail('a b@example.com'), false)
})
