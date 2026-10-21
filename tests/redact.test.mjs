import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { clip, hasSecret, redact } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'redact.mjs')).href)

test('redact scrubs provider tokens, headers, key=value secrets and private keys', () => {
  const cases = [
    ['key sk-ant-api03-abcdefghijklmnopqrstuv', 'key [redacted]'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', '[redacted]'],
    ['AKIAABCDEFGHIJKLMNOP', '[redacted]'],
    ['Authorization: Bearer abcdef0123456789xyz', 'Authorization: Bearer [redacted]'],
    ['DB_PASSWORD=hunter2 next', 'DB_PASSWORD=[redacted] next'],
    ['api_key: "abc def"', 'api_key: [redacted]'],
    ['senha=segredo123', 'senha=[redacted]'],
    ['postgres://admin:pw@db:5432/app', 'postgres://[redacted]@db:5432/app'],
    ['mail ana@example.com now', 'mail [redacted] now'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', '[redacted]'],
  ]
  for (const [input, expected] of cases) assert.equal(redact(input), expected, input)
})

test('redact leaves ordinary text alone', () => {
  const text = 'npm test exit 1: expected 3 to equal 4 in src/users.js:12 (token count 40)'
  assert.equal(redact(text), text)
  assert.equal(hasSecret(text), false)
  assert.equal(hasSecret('token=abc123'), true)
})

test('clip redacts, joins whitespace and caps the length', () => {
  assert.equal(clip('a\n  b   c'), 'a b c')
  assert.equal(clip('x'.repeat(50), 10).length, 10)
  assert.equal(clip('password=abc', 100), 'password=[redacted]')
})

test('redact covers JSON keys, underscore and vendor prefixes, cookies, webhooks and CLI flags', () => {
  const cases = [
    ['{"password": "hunter2"}', '{"password": [redacted]}'],
    ['{"api_key":"abc"}', '{"api_key":[redacted]}'],
    // Built from parts so the fake keys never sit in the source as one token (secret scanners flag them).
    [['sk', 'live', '51HxAbCdEfGhIjKlMnOpQrSt'].join('_'), '[redacted]'],
    [['rk', 'test', '51HxAbCdEfGhIjKlMnOpQrSt'].join('_'), '[redacted]'],
    ['glpat-abcdefghijklmnop1234', '[redacted]'],
    ['npm_abcdefghijklmnopqrstuvwxyz0123456789', '[redacted]'],
    ['post to https://hooks.slack.com/services/T000/B000/XXXX now', 'post to [redacted] now'],
    ['Cookie: session=abc; other=1', 'Cookie: [redacted]'],
    ['mysql --password hunter2 db', 'mysql --password [redacted] db'],
    ['cli --token=abc123', 'cli --token=[redacted]'],
    ['Authorization: Bearer abc12345', 'Authorization: Bearer [redacted]'],
  ]
  for (const [input, expected] of cases) assert.equal(redact(input), expected, input)
})
