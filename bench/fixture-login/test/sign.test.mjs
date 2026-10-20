import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { signToken, verifyToken } from '../src/crypto/sign.js'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })

test('a signed token verifies and carries the payload', () => {
  const token = signToken({ sub: 'u_1', role: 'manager' }, privatePem)
  assert.equal(token.split('.').length, 3)
  const claims = verifyToken(token, publicPem)
  assert.equal(claims.sub, 'u_1')
  assert.equal(claims.role, 'manager')
  assert.equal(typeof claims.iat, 'number')
  assert.equal(claims.exp, undefined)
})

test('expiresInSeconds sets exp from iat', () => {
  const claims = verifyToken(signToken({ sub: 'u_1' }, privatePem, { expiresInSeconds: 600 }), publicPem)
  assert.equal(claims.exp - claims.iat, 600)
})

test('a tampered token is rejected', () => {
  const [header, , signature] = signToken({ sub: 'u_1' }, privatePem).split('.')
  const forged = Buffer.from(JSON.stringify({ sub: 'u_2' })).toString('base64url')
  assert.throws(() => verifyToken(`${header}.${forged}.${signature}`, publicPem), /invalid signature/)
})

test('a token signed with another key is rejected', () => {
  const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
  assert.throws(() => verifyToken(signToken({ sub: 'u_1' }, other), publicPem), /invalid signature/)
})

test('an expired token is rejected', () => {
  const stale = signToken({ sub: 'u_1' }, privatePem, { expiresInSeconds: -1 })
  assert.throws(() => verifyToken(stale, publicPem), /expired/)
})
