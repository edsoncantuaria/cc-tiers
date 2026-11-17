import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)

// Mirror LOCK_WAIT_MS and LOCK_STALE_MS in hooks/cc_tiers.mjs, which does not export them.
const LOCK_WAIT_MS = 5000
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

test('withLock without the lock tells fn so after the wait, and leaves the holder\'s lock alone', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'session-sess-1.json')
    const lock = `${file}.lock`
    writeFileSync(lock, String(process.pid))
    const heldSince = statSync(lock).mtimeMs
    const started = Date.now()
    const held = tiers.withLock(file, (taken) => taken, 300)
    assert.equal(held, false)
    assert.ok(Date.now() - started >= 250, 'it waited for the lock')
    assert.equal(readFileSync(lock, 'utf8'), String(process.pid), "another hook's lock is not removed")
    assert.equal(statSync(lock).mtimeMs, heldSince)
  })
})

test('a live holder keeps its lock past the old 10 s rule; a dead one, or one older than 700 s, is taken at once', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'session-sess-1.json')
    const lock = `${file}.lock`
    const aged = (seconds) => new Date(Date.now() - seconds * 1000)
    writeFileSync(lock, String(process.pid))
    utimesSync(lock, aged(30), aged(30))
    assert.equal(tiers.withLock(file, (taken) => taken, 200), false, 'a live hook working for 30 s keeps its lock')

    const dead = spawnSync(process.execPath, ['-e', '']).pid
    writeFileSync(lock, String(dead))
    const started = Date.now()
    assert.equal(tiers.withLock(file, (taken) => taken, 5000), true, 'a crashed hook\'s lock is taken')
    assert.ok(Date.now() - started < 1000, 'without waiting')

    writeFileSync(lock, String(process.pid))
    utimesSync(lock, aged(701), aged(701))
    assert.equal(tiers.withLock(file, (taken) => taken, 200), true, 'no hook runs longer than 660 s')
  })
})

test('the lock names its holder, so a crash can be told from a slow hook', async () => {
  await inTempDir((dir) => {
    const file = path.join(dir, 'session-sess-1.json')
    const seen = tiers.withLock(file, () => readFileSync(`${file}.lock`, 'utf8'))
    assert.equal(seen, String(process.pid))
  })
})

test('withSession without the lock answers from the state it read, saves nothing and records a hook error', async () => {
  await inTempDir((dir) => {
    const routing = tiers.mergeRouting(JSON.parse(readFileSync(path.join(ROOT, 'config/routing.default.json'), 'utf8')), null, {})
    const data = path.join(dir, 'data')
    mkdirSync(data, { recursive: true })
    const file = path.join(data, 'session-sess-1.json')
    const before = { ...tiers.emptyState('sess-1'), tasks: { kept: { tier: 'sonnet', failures: ['one'] } } }
    writeFileSync(file, JSON.stringify(before))
    writeFileSync(`${file}.lock`, String(process.pid))
    const ctx = { routing, projectDir: '', dataDir: data, file, sessionId: 'sess-1', env: {}, lockWaitMs: 200 }
    const answer = tiers.withSession(ctx, {}, (state) => {
      state.tasks.lost = { tier: 'sonnet', failures: [] }
      return Object.keys(state.tasks).sort().join(',')
    })
    assert.equal(answer, 'kept,lost', 'the hook still answers from what it read')
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).tasks), ['kept'], 'nothing is saved without the lock')
    const errors = readFileSync(path.join(data, 'hook-errors.jsonl'), 'utf8')
    assert.match(errors, /"hook":"lock"/)
    assert.match(errors, /not saved/)
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

test('a report counted while another hook holds the memory file writes no memory record, and the next one does', async () => {
  await inTempDir((dir) => {
    const routing = tiers.mergeRouting(JSON.parse(readFileSync(path.join(ROOT, 'config/routing.default.json'), 'utf8')), null, { verify: 'off' })
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, '.claude'), { recursive: true })
    const memoryFile = path.join(project, '.claude', 'cc-tiers-memory.json')
    const ctx = { routing, projectDir: project, dataDir: '' }
    const fail = (id) => ({ kind: 'report', id, role: 'implementer', prompt: 'CC_TIERS_TASK: t\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x', text: 'CC_TIERS_TASK: t\nCC_TIERS_ROLE: implementer\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: npm test exit 1: AssertionError expected 2 to equal 3' })
    writeFileSync(`${memoryFile}.lock`, String(process.pid))
    tiers.processReport(ctx, tiers.emptyState('s'), fail('w1'))
    assert.equal(existsSync(memoryFile), false, 'no write without the lock')
    writeFileSync(`${memoryFile}.lock`, '')
    utimesSync(`${memoryFile}.lock`, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    tiers.processReport(ctx, tiers.emptyState('s'), fail('w2'))
    assert.equal(existsSync(memoryFile), true, 'written once the lock is free')
  })
})

test('a Haiku failure or a Sonnet escalation counted while another hook holds the history file writes no history, and the next one does', async () => {
  await inTempDir((dir) => {
    const routing = tiers.mergeRouting(JSON.parse(readFileSync(path.join(ROOT, 'config/routing.default.json'), 'utf8')), null, { verify: 'off', learn: 'on', memory: 'off', max_attempts: '2' })
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, '.claude'), { recursive: true })
    const history = path.join(project, '.claude', 'cc-tiers-history.json')
    const ctx = { routing, projectDir: project, dataDir: '' }
    const fail = (id, role, tier) => ({
      kind: 'report',
      id,
      role,
      prompt: `CC_TIERS_TASK: t-${role}\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\nAdd pagination to GET /users`,
      text: `CC_TIERS_TASK: t-${role}\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: not a trivial task`,
    })
    const hold = () => writeFileSync(`${history}.lock`, String(process.pid))
    const free = () => writeFileSync(`${history}.lock`, String(spawnSync(process.execPath, ['-e', '']).pid))
    const kinds = () => (existsSync(history) ? JSON.parse(readFileSync(history, 'utf8')).entries.map((entry) => `${entry.tier || 'haiku'}:${entry.kind}`) : [])

    hold()
    tiers.processReport(ctx, tiers.emptyState('s'), fail('h1', 'worker', 'haiku'))
    assert.deepEqual(kinds(), [], 'a Haiku failure writes no history without the lock')
    free()
    tiers.processReport(ctx, tiers.emptyState('s'), fail('h2', 'worker', 'haiku'))
    assert.equal(kinds().length, 1, 'and writes it once the lock is free')

    const sonnet = (state) => {
      tiers.processReport(ctx, state, fail('s1', 'implementer', 'sonnet'))
      return tiers.processReport(ctx, state, fail('s2', 'implementer', 'sonnet'))
    }
    hold()
    const before = kinds().length
    assert.match(sonnet(tiers.emptyState('s')), /escalated past Sonnet/)
    assert.equal(kinds().length, before, 'a Sonnet escalation writes no history without the lock')
    free()
    sonnet(tiers.emptyState('s'))
    assert.equal(kinds().length, before + 1, 'and writes it once the lock is free')
  })
})
