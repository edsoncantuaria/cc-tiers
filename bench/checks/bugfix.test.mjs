import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunk } from '../src/text.js'
import { directoryPages } from '../src/api.js'

test('chunk keeps the last partial chunk', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])
  assert.deepEqual(chunk([], 3), [])
  assert.throws(() => chunk([1], 0), RangeError)
  assert.equal(directoryPages(5).length, 5)
  assert.deepEqual(directoryPages(5)[4], ['Ugo', 'Vera', 'Wagner'])
})
