import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)

// Mirror LOCK_WAIT_MS and LOCK_STALE_MS in hooks/cc_tiers.mjs, which does not export them.
const LOCK_WAIT_MS = 3000
const LOCK_STALE_MS = 10000

async function inTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Freeze Date.now so the temp name writeAtomic picks (`<file>.<pid>.<now>.tmp`) is known. */
function atTime(now, fn) {
  const real = Date.now
  Date.now = () => now
  try {
    return fn()
  } finally {
    Date.now = real
  }
}

const tempName = (file, now) => `${file}.${process.pid}.${now}.tmp`

test('withLock takes over a stale lock and holds its own while fn runs', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'session-sess-1.json')
    const lock = `${file}.lock`
    writeFileSync(lock, '')
    const crashed = new Date(Date.now() - LOCK_STALE_MS - 5000)
    utimesSync(lock, crashed, crashed)
    const started = Date.now()
    let lockAge
    const result = tiers.withLock(file, () => {
      lockAge = Date.now() - statSync(lock).mtimeMs
      return 'ran'
    })
    assert.equal(result, 'ran')
    assert.ok(lockAge < LOCK_STALE_MS, `fn ran under the crashed hook's lock (${lockAge} ms old)`)
    assert.ok(Date.now() - started < LOCK_WAIT_MS / 2, 'a stale lock is taken over, not waited out')
    assert.equal(existsSync(lock), false, 'the lock taken over is released')
  })
})

test('withLock runs fn after the wait limit when a live lock is never released', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'session-sess-1.json')
    const lock = `${file}.lock`
    writeFileSync(lock, '')
    const heldSince = statSync(lock).mtimeMs
    const started = Date.now()
    const result = tiers.withLock(file, () => 'ran')
    const waited = Date.now() - started
    assert.equal(result, 'ran')
    assert.ok(waited >= LOCK_WAIT_MS - 50, `fn ran after only ${waited} ms`)
    assert.ok(waited < LOCK_STALE_MS / 2, `fn waited ${waited} ms, as if for the lock to go stale`)
    assert.equal(existsSync(lock), true, "another hook's lock is not removed")
    assert.equal(statSync(lock).mtimeMs, heldSince)
  })
})

test('writeAtomic replaces the target whole and leaves no .tmp', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'nested', 'state.json')
    tiers.writeAtomic(file, 'first body\n'.repeat(10))
    const body = `${JSON.stringify({ rows: Array.from({ length: 2000 }, (_, index) => index) })}\n`
    tiers.writeAtomic(file, body)
    assert.equal(readFileSync(file, 'utf8'), body)
    assert.deepEqual(readdirSync(path.dirname(file)), ['state.json'])
  })
})

test('writeAtomic that fails before the rename leaves the old file whole', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'state.json')
    tiers.writeAtomic(file, 'old body\n')
    // A directory in place of the temp file makes the temp write fail, as if the writer died mid-write.
    const now = 1700000000000
    mkdirSync(tempName(file, now))
    atTime(now, () => assert.throws(() => tiers.writeAtomic(file, 'new body\n')))
    assert.equal(readFileSync(file, 'utf8'), 'old body\n')
  })
})

test('loadState returns an empty state for a truncated or invalid session file', async () => {
  await inTempDir((dir) => {
    const file = tiers.sessionPath(dir, 'sess-1')
    const broken = {
      truncated: '{"session_id":"sess-1","tasks":{"users":{"failures":[',
      empty: '',
      'not json': 'not json at all',
      null: 'null',
      'no tasks': '{"session_id":"sess-1","seen":[]}',
    }
    for (const [name, text] of Object.entries(broken)) {
      writeFileSync(file, text)
      assert.deepEqual(tiers.loadState(file, 'sess-1'), tiers.emptyState('sess-1'), name)
    }
    const next = { ...tiers.emptyState('sess-1'), pending: ['after the crash'] }
    writeFileSync(file, broken.truncated)
    tiers.saveState(file, next)
    assert.deepEqual(tiers.loadState(file, 'sess-1'), next, 'the next save replaces the broken file whole')
  })
})

test('a leftover .tmp from a crashed writer does not break the next saveState or loadState', async () => {
  await inTempDir((dir) => {
    const file = tiers.sessionPath(dir, 'sess-1')
    const before = { ...tiers.emptyState('sess-1'), pending: ['before the crash'] }
    tiers.saveState(file, before)
    const now = 1700000000000
    const half = '{"session_id":"sess-1","tasks":{"ghost":'
    const leftovers = [
      tempName(file, now),
      tempName(path.join(dir, 'latest.json'), now),
      `${file}.99999.1600000000000.tmp`,
    ]
    for (const leftover of leftovers) writeFileSync(leftover, half)
    assert.deepEqual(tiers.loadState(file, 'sess-1'), before, 'the target is read, never a leftover temp')
    const after = { ...before, pending: ['after the crash'] }
    atTime(now, () => tiers.saveState(file, after))
    assert.deepEqual(tiers.loadState(file, 'sess-1'), after)
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8')), after)
  })
})
