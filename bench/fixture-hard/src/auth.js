import { createHmac, timingSafeEqual } from 'node:crypto'
import { now } from './clock.js'
import { getConfig } from './config.js'
import { AuthError, ForbiddenError } from './errors.js'

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function mac(body, secret) {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** A signed token: base64url(JSON payload) + '.' + HMAC-SHA256 of that text. */
export function signToken({ sub, role }, { ttlMs = getConfig().tokenTtlMs } = {}) {
  const issued = now()
  const body = encode({ sub, role, iat: issued, exp: issued + ttlMs })
  return `${body}.${mac(body, getConfig().secret)}`
}

export function verifyToken(token) {
  if (typeof token !== 'string') throw new AuthError('missing token')
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) throw new AuthError('malformed token')
  const expected = Buffer.from(mac(body, getConfig().secret))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AuthError('bad signature')
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    throw new AuthError('malformed token')
  }
  if (typeof payload.exp !== 'number' || now() >= payload.exp) throw new AuthError('token expired')
  return payload
}

export function requireRole(auth, roles) {
  if (!auth) throw new AuthError()
  if (!roles.includes(auth.role)) throw new ForbiddenError(`needs role ${roles.join(' or ')}`)
  return auth
}
