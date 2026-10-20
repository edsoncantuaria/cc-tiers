import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

const HEADER = { alg: 'EdDSA', typ: 'JWT' }

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

export function signToken(payload, privateKey, { expiresInSeconds } = {}) {
  const iat = Math.floor(Date.now() / 1000)
  const claims = { ...payload, iat }
  if (expiresInSeconds) claims.exp = iat + expiresInSeconds
  const data = `${encode(HEADER)}.${encode(claims)}`
  const signature = sign(null, Buffer.from(data), createPrivateKey(privateKey))
  return `${data}.${signature.toString('base64url')}`
}

export function verifyToken(token, publicKey) {
  const parts = String(token).split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const [header, body, signature] = parts
  if (decode(header).alg !== HEADER.alg) throw new Error('unsupported algorithm')
  const valid = verify(null, Buffer.from(`${header}.${body}`), createPublicKey(publicKey), Buffer.from(signature, 'base64url'))
  if (!valid) throw new Error('invalid signature')
  const claims = decode(body)
  if (claims.exp !== undefined && claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('token expired')
  return claims
}
