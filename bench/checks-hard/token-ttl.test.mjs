import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.js'
import { reset, setClock, signToken, verifyToken } from '../src/index.js'

test('tokens live 30 minutes by default', () => {
  assert.equal(DEFAULTS.tokenTtlMs, 30 * 60 * 1000)
  reset()
  let clock = 0
  setClock(() => clock)
  const token = signToken({ sub: 'usr_1', role: 'worker' })
  clock = 30 * 60 * 1000 - 1
  assert.equal(verifyToken(token).sub, 'usr_1')
  clock = 30 * 60 * 1000
  assert.throws(() => verifyToken(token), /expired/)
  clock = 0
  const short = signToken({ sub: 'usr_1', role: 'worker' }, { ttlMs: 1000 })
  clock = 1000
  assert.throws(() => verifyToken(short), /expired/)
})
