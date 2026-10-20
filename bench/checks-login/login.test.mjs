import assert from 'node:assert/strict'
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

// Same bytes as PRIVATE_KEY in bench/fixture-login/.env; npm test in cc-tiers checks it.
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIL9YJ6OrWI/T1grvW2X3ASizq50lALQ9UIzlpbf0JXb5\n-----END PRIVATE KEY-----"
const USER = { id: 'u_8f2c41', email: 'ana@shiftlite.dev', password: 'correct-horse-battery' }
const PUBLIC_KEY = createPublicKey(createPrivateKey(PRIVATE_KEY))
const ROOT = process.cwd()

// The app has to load its key from .env on its own, as `npm start` does.
for (const name of ['PRIVATE_KEY', 'TOKEN_ISSUER', 'PORT']) delete process.env[name]

let started = null
function start() {
  started ??= (async () => {
    const { createServer } = await import(pathToFileURL(path.join(ROOT, 'src', 'server.js')).href)
    const server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, base: `http://127.0.0.1:${server.address().port}` }
  })()
  return started
}

after(async () => {
  if (!started) return
  const { server } = await started.catch(() => ({}))
  server?.closeAllConnections?.()
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
})

async function login(body) {
  const { base } = await start()
  return fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
const mentions = (value, wanted) =>
  value === wanted || (value !== null && typeof value === 'object' && Object.values(value).some((inner) => mentions(inner, wanted)))

function sourceFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.[cm]?[jt]s$/.test(name) ? [full] : []
  })
}

// Comments go; string literals stay only where an import needs them.
const withoutComments = (source) =>
  source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (match) => (match[0] === '/' ? ' ' : match))
const withoutStrings = (code) => code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""')

test('reuse: tokens are signed with the existing helper and no JWT library is added', () => {
  const helper = path.join(ROOT, 'src', 'crypto', 'sign.js')
  const crypto = /^(?:node:)?crypto$/
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    if (file === helper) continue
    const code = withoutComments(readFileSync(file, 'utf8'))
    const where = path.relative(ROOT, file)
    for (const [, names, from] of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!crypto.test(from)) continue
      const imported = names.split(',').map((name) => name.trim().split(/\s+as\s+/)[0])
      for (const banned of ['sign', 'createSign']) assert.ok(!imported.includes(banned), `${where} imports ${banned} from node:crypto; use src/crypto/sign.js`)
    }
    for (const [, names, from] of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!crypto.test(from)) continue
      const imported = names.split(',').map((name) => name.trim().split(/\s*:\s*/)[0])
      for (const banned of ['sign', 'createSign']) assert.ok(!imported.includes(banned), `${where} requires ${banned} from node:crypto; use src/crypto/sign.js`)
    }
    const aliases = ['crypto']
    for (const [, name, from] of code.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)[^'"]*?from\s*['"]([^'"]+)['"]/g)) if (crypto.test(from)) aliases.push(name)
    for (const [, name, from] of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) if (crypto.test(from)) aliases.push(name)
    const calls = withoutStrings(code)
    assert.doesNotMatch(calls, /\bcreateSign\s*\(/, `${where} signs on its own; use src/crypto/sign.js`)
    for (const alias of aliases) assert.doesNotMatch(calls, new RegExp(`\\b${alias}\\s*\\.\\s*sign\\s*\\(`), `${where} calls ${alias}.sign; use src/crypto/sign.js`)
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  for (const banned of ['jsonwebtoken', 'jose', 'jwt-simple', 'fast-jwt', 'paseto']) assert.ok(!deps.includes(banned), `package.json adds ${banned}`)
})

test('a valid email and password get a signed one-hour token for that user', async () => {
  const res = await login({ email: USER.email, password: USER.password })
  assert.equal(res.status, 200, `POST /login with valid credentials answered ${res.status}: ${await res.clone().text()}`)
  const { token } = await res.json()
  assert.equal(typeof token, 'string')
  const parts = token.split('.')
  assert.equal(parts.length, 3, 'the token is not a compact JWS')
  const [header, body, signature] = parts
  assert.ok(['EdDSA', 'Ed25519'].includes(decode(header).alg), `unexpected alg ${decode(header).alg}`)
  assert.ok(verify(null, Buffer.from(`${header}.${body}`), PUBLIC_KEY, Buffer.from(signature, 'base64url')), 'the token is not signed with the private key in .env')
  const claims = decode(body)
  assert.ok(mentions(claims, USER.id) || mentions(claims, USER.email), `the token does not identify ${USER.id} or ${USER.email}: ${JSON.stringify(claims)}`)
  assert.equal(typeof claims.exp, 'number', 'the token has no exp')
  if (typeof claims.iat === 'number') {
    assert.ok(Math.abs(claims.exp - claims.iat - 3600) <= 5, `exp - iat is ${claims.exp - claims.iat}, not one hour`)
  } else {
    assert.ok(Math.abs(claims.exp - (Date.now() / 1000 + 3600)) <= 60, 'exp is not one hour from now')
  }
})

test('a wrong password or an unknown email gets 401', async () => {
  const wrong = await login({ email: USER.email, password: 'correct-horse-battery!' })
  assert.equal(wrong.status, 401, 'wrong password')
  const unknown = await login({ email: 'nobody@shiftlite.dev', password: USER.password })
  assert.equal(unknown.status, 401, 'unknown email')
})

test('a malformed JSON body gets a 4xx and the server keeps running', async () => {
  const res = await login('{"email": "ana@shiftlite.dev", "password":')
  assert.ok(res.status >= 400 && res.status < 500, `malformed body answered ${res.status}`)
  const { base } = await start()
  assert.equal((await fetch(`${base}/health`)).status, 200)
})
