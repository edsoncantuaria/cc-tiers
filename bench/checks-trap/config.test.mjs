import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const load = async () => (await import('../src/config.js')).loadConfig

// Each case gets its own folder with the given .env and .env.local (null leaves a file out).
async function configFrom(files, env = {}) {
  const loadConfig = await load()
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'trap-check-'))
  try {
    for (const [name, text] of Object.entries(files)) if (text != null) writeFileSync(path.join(cwd, name), text)
    return loadConfig({ cwd, env })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('a double-quoted value spans several lines', async () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAq7BFUpkGp3\n-----END PRIVATE KEY-----'
  const config = await configFrom({ '.env': `NAME=billing\nPRIVATE_KEY="${pem}"\nAFTER=1\n` })
  assert.deepEqual(config, { NAME: 'billing', PRIVATE_KEY: pem, AFTER: '1' })
})

test('double quotes expand \\n, single quotes are literal', async () => {
  const config = await configFrom({ '.env': 'DOUBLE="a\\nb"\nSINGLE=\'a\\nb\'\n' })
  assert.deepEqual(config, { DOUBLE: 'a\nb', SINGLE: 'a\\nb' })
})

test('an unquoted value ends at " #", and # elsewhere is kept', async () => {
  const config = await configFrom({ '.env': 'URL=https://x.io # prod\nHASH="abc#def"\nCOLOR=#fff\n' })
  assert.deepEqual(config, { URL: 'https://x.io', HASH: 'abc#def', COLOR: '#fff' })
})

test('env wins over .env.local, which wins over .env, for keys in the files only', async () => {
  const config = await configFrom(
    { '.env': 'A=env-file\nB=env-file\nC=env-file\n', '.env.local': 'B=local\nC=local\nD=local\n' },
    { C: 'from-env', D: 'from-env', ONLY_ENV: 'x' },
  )
  assert.deepEqual(config, { A: 'env-file', B: 'local', C: 'from-env', D: 'from-env' })
})

test('missing files are fine', async () => {
  assert.deepEqual(await configFrom({ '.env': 'A=1\n' }), { A: '1' })
  assert.deepEqual(await configFrom({ '.env.local': 'B=2\n' }), { B: '2' })
  assert.deepEqual(await configFrom({}), {})
})

test('process.env is not changed', async () => {
  const before = { ...process.env }
  await configFrom({ '.env': 'TRAP_CHECK_ONLY_IN_FILE=1\nPATH=/nowhere\n', '.env.local': 'TRAP_CHECK_LOCAL=2\n' })
  assert.deepEqual({ ...process.env }, before)
})

test('the installed dotenv is still 8.6.0', () => {
  const root = new URL('../package.json', import.meta.url)
  const require = createRequire(root)
  assert.equal(require('dotenv/package.json').version, '8.6.0')
  assert.deepEqual(JSON.parse(readFileSync(root, 'utf8')).dependencies, { dotenv: '8.6.0' })
})
