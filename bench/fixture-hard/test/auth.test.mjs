import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { configure, reset, setClock, signToken, verifyToken } from '../src/index.js'

beforeEach(() => reset())

test('a token round-trips until it expires', () => {
  let clock = 1_000
  setClock(() => clock)
  const token = signToken({ sub: 'usr_1', role: 'worker' }, { ttlMs: 500 })
  assert.equal(verifyToken(token).sub, 'usr_1')
  clock = 1_499
  assert.equal(verifyToken(token).role, 'worker')
  clock = 1_500
  assert.throws(() => verifyToken(token), /expired/)
})

test('a tampered or foreign token is refused', () => {
  const token = signToken({ sub: 'usr_1', role: 'worker' })
  const [body, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ sub: 'usr_1', role: 'manager', exp: Date.now() + 1e6 })).toString('base64url')
  assert.throws(() => verifyToken(`${forged}.${signature}`), /signature/)
  assert.throws(() => verifyToken(`${body}.${signature}.x`), /malformed/)
  configure({ secret: 'another' })
  assert.throws(() => verifyToken(token), { status: 401 })
})
