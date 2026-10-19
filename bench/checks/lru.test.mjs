import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLruCache } from '../src/cache.js'

test('LRU eviction with recency on get', () => {
  const cache = createLruCache({ max: 2, ttlMs: 1000, now: () => 0 })
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.get('a'), 1)
  cache.set('c', 3)
  assert.equal(cache.has('b'), false)
  assert.equal(cache.has('a'), true)
  assert.equal(cache.size, 2)
  assert.equal(cache.delete('a'), true)
  assert.equal(cache.delete('a'), false)
  assert.equal(cache.size, 1)
})

test('entries expire after ttlMs using the injected clock', () => {
  let clock = 0
  const cache = createLruCache({ max: 5, ttlMs: 100, now: () => clock })
  cache.set('k', 'v')
  clock = 99
  assert.equal(cache.get('k'), 'v')
  clock = 100
  assert.equal(cache.get('k'), undefined)
  assert.equal(cache.has('k'), false)
  assert.equal(cache.size, 0)
})

test('set on an existing key updates the value and the expiry', () => {
  let clock = 0
  const cache = createLruCache({ max: 2, ttlMs: 100, now: () => clock })
  cache.set('a', 1)
  clock = 80
  cache.set('a', 2)
  clock = 150
  assert.equal(cache.get('a'), 2)
  assert.throws(() => createLruCache({ max: 0, ttlMs: 1 }), RangeError)
})
