import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from '../src/server.js'

let server
let base

before(async () => {
  server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

test('GET /health answers ok', async () => {
  const res = await fetch(`${base}/health`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await res.json(), { status: 'ok' })
})

test('GET /users/:id returns the public profile', async () => {
  const res = await fetch(`${base}/users/u_8f2c41`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { id: 'u_8f2c41', name: 'Ana Ribeiro', email: 'ana@shiftlite.dev' })
})

test('GET /users/:id is 404 for an unknown id', async () => {
  const res = await fetch(`${base}/users/u_000000`)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'user not found' })
})

test('unknown routes are 404', async () => {
  const res = await fetch(`${base}/shifts`)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'not found' })
})
