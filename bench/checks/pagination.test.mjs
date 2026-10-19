import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listUsers } from '../src/users.js'

test('listUsers pages with an opaque cursor', () => {
  const first = listUsers({ limit: 10 })
  assert.equal(first.items.length, 10)
  assert.equal(first.items[0].name, 'Ana')
  assert.equal(typeof first.nextCursor, 'string')
  const second = listUsers({ limit: 10, cursor: first.nextCursor })
  assert.equal(second.items[0].name, 'Kai')
  const third = listUsers({ limit: 10, cursor: second.nextCursor })
  assert.equal(third.items.length, 3)
  assert.equal(third.nextCursor, null)
  assert.equal(listUsers().items.length, 10)
  assert.throws(() => listUsers({ cursor: 'not-a-cursor' }), TypeError)
  const all = new Set([...first.items, ...second.items, ...third.items].map((user) => user.id))
  assert.equal(all.size, 23)
})
