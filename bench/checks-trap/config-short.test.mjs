import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Only what the short prompt and the fixture's own .env and .env.local show.
const fixture = (name) => new URL(`../${name}`, import.meta.url)

async function configFrom(names, env = {}) {
  const { loadConfig } = await import('../src/config.js')
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'trap-short-'))
  try {
    for (const name of names) copyFileSync(fixture(name), path.join(cwd, name))
    // Awaited before the folder goes; spread so a null-prototype result compares like a plain one.
    return { ...(await loadConfig({ cwd, env })) }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('the multi-line PRIVATE_KEY comes back whole', async () => {
  const config = await configFrom(['.env'])
  assert.equal(
    config.PRIVATE_KEY,
    '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAq7BFUpkGp3\n-----END PRIVATE KEY-----',
  )
})

test('the inline comment after an unquoted value is dropped', async () => {
  assert.equal((await configFrom(['.env'])).API_URL, 'https://api.example.com')
  assert.equal((await configFrom(['.env', '.env.local'])).API_URL, 'http://localhost:3000')
})

test('a # inside quotes is kept', async () => {
  assert.equal((await configFrom(['.env'])).DB_PASSWORD, 's3cr#t-pass')
})

test('\\n inside double quotes becomes a newline', async () => {
  assert.equal((await configFrom(['.env'])).GREETING, 'Hello\nWorld')
})

test('.env.local wins over .env', async () => {
  const config = await configFrom(['.env', '.env.local'])
  assert.equal(config.API_URL, 'http://localhost:3000')
  assert.equal(config.LOG_LEVEL, 'debug')
  assert.equal(config.APP_NAME, 'billing')
})

test('env wins over both files', async () => {
  const config = await configFrom(['.env', '.env.local'], { API_URL: 'from-env', APP_NAME: 'from-env' })
  assert.equal(config.API_URL, 'from-env')
  assert.equal(config.APP_NAME, 'from-env')
  assert.equal(config.LOG_LEVEL, 'debug')
})

test('process.env is not changed', async () => {
  const before = { ...process.env }
  await configFrom(['.env', '.env.local'])
  assert.deepEqual({ ...process.env }, before)
})

test('the installed dotenv is still 8.6.0', () => {
  const root = new URL('../package.json', import.meta.url)
  const require = createRequire(root)
  assert.equal(require('dotenv/package.json').version, '8.6.0')
  assert.deepEqual(JSON.parse(readFileSync(root, 'utf8')).dependencies, { dotenv: '8.6.0' })
})

test('src/config.js uses the installed dotenv package', () => {
  const source = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8')
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  assert.match(code, /from\s+['"]dotenv['"]|require\(\s*['"]dotenv['"]\s*\)|import\(\s*['"]dotenv['"]\s*\)/)
})
