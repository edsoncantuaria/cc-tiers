import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Concurrency: the parallel-writer rules, the session, gate, memory and history locks, driven through real hook processes where it matters.
// Orders are set by the test (lock files it writes, a barrier file a command waits on, a live child it controls), never by sleeping.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = path.join(ROOT, 'hooks')
const tiers = await import(pathToFileURL(path.join(HOOKS, 'cc_tiers.mjs')).href)
const memory = await import(pathToFileURL(path.join(HOOKS, 'memory.mjs')).href)
const DEFAULTS = JSON.parse(readFileSync(path.join(ROOT, 'config', 'routing.default.json'), 'utf8'))

// Mirrors LOCK_STALE_MS and GATE_LOCK_STALE_MS in hooks/cc_tiers.mjs, which does not export them.
const LOCK_STALE_MS = 10000
const GATE_LOCK_STALE_MS = 660000
// A host name no machine has: its pids cannot be checked here, so such a holder counts as alive.
const OTHER_HOST = `elsewhere-${os.hostname()}`

async function inTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-conc-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid
const age = (file, ms) => utimesSync(file, new Date(Date.now() - ms), new Date(Date.now() - ms))

/** Resolves once condition() holds: the test waits on what the processes did, never for a guessed time. */
async function until(what, condition, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Starts node with args at once and resolves with its status and output when it exits. */
function spawnNode(args, { env, input = '' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(input)
  })
}

/** A project and a data dir under dir, and the environment of a hook run against them. */
function layout(dir, options = {}) {
  const project = path.join(dir, 'project')
  const data = path.join(dir, 'data')
  mkdirSync(path.join(project, '.claude'), { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE_PLUGIN_OPTION_') && !key.startsWith('CC_TIERS_')))
  Object.assign(env, { CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: project, CC_TIERS_CC_COST: '0', HOME: path.join(dir, 'home'), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' })
  Object.assign(env, options)
  return { project, data, env }
}

const hook = (script, payload, env) => spawnNode([path.join(HOOKS, script)], { env, input: JSON.stringify(payload) })
const sessionFile = (data, session) => tiers.sessionPath(data, session)
const loadSession = (data, session) => tiers.loadState(sessionFile(data, session), session)

const SPEC = 'CC_TIERS_SPEC_BEGIN\nCriteria:\n- The list is paginated (request)\nCC_TIERS_SPEC_END'
const writerPrompt = (task, files) =>
  `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_RESEARCH: none - local change\n${SPEC}\n${files ? `CC_TIERS_FILES: ${files}\n` : ''}Add pagination to the list`

/** One implementer delegation as the PreToolUse hook gets it. */
function delegation(task, files, { session = 's', isolation } = {}) {
  const tool_input = { subagent_type: 'cc-tiers:implementer', prompt: writerPrompt(task, files), ...(isolation ? { isolation } : {}) }
  return { session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input }
}

/** Whether the PreToolUse hook let the delegation through, and what it said when it did not. */
function verdict(result) {
  assert.equal(result.status, 0, result.stderr)
  const out = result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : {}
  return { allowed: out.permissionDecision !== 'deny', reason: out.permissionDecisionReason || '' }
}

const launch = async (env, task, files, options) => verdict(await hook('before_agent.mjs', delegation(task, files, options), env))
const running = (data, session = 's') => Object.keys(loadSession(data, session).active).sort()

// Parallel writers

test('writers: overlapping CC_TIERS_FILES are refused, disjoint files and a worktree writer run, all as real hook runs of one session', async () => {
  await inTempDir(async (dir) => {
    const { data, env } = layout(dir)
    assert.equal((await launch(env, 'a', 'src/users.js')).allowed, true)
    const clash = await launch(env, 'b', 'src/users.js')
    assert.equal(clash.allowed, false)
    assert.match(clash.reason, /b may edit the same files as a running writer: a \(src\/users\.js\)/)
    assert.match(clash.reason, /isolation: "worktree"/)
    assert.equal((await launch(env, 'c', 'src/users.js', { isolation: 'worktree' })).allowed, true, 'a worktree writer never conflicts on files')
    assert.equal((await launch(env, 'd', 'web/app.css')).allowed, true, 'disjoint files run together')
    assert.deepEqual(running(data), ['a', 'c', 'd'], 'the refused writer is not registered')
    assert.equal(loadSession(data, 's').active.c.isolated, true)
  })
})

test('writers: a writer in its own worktree does not hold back a plain writer on the same files', async () => {
  await inTempDir(async (dir) => {
    const { data, env } = layout(dir)
    assert.equal((await launch(env, 'tree', 'lib/x.js', { isolation: 'worktree' })).allowed, true)
    assert.equal((await launch(env, 'plain', 'lib/x.js')).allowed, true)
    assert.match((await launch(env, 'again', 'lib/x.js')).reason, /again may edit the same files as a running writer: plain \(lib\/x\.js\)/)
    assert.deepEqual(running(data), ['plain', 'tree'])
  })
})

test('writers: hooks started at once on the same session serialize, so exactly one of two overlapping writers runs', async () => {
  await inTempDir(async (dir) => {
    const { data, env } = layout(dir)
    const results = await Promise.all([launch(env, 'first', 'src/users.js'), launch(env, 'second', 'src/users.js')])
    const allowed = results.filter((item) => item.allowed)
    const refused = results.filter((item) => !item.allowed)
    assert.equal(allowed.length, 1, 'one writer got the files')
    assert.equal(refused.length, 1)
    assert.match(refused[0].reason, /may edit the same files as a running writer/)
    const winner = running(data)
    assert.equal(winner.length, 1, 'the state holds the one that ran, and not the refused one')
    assert.match(refused[0].reason, new RegExp(`running writer: ${winner[0]} \\(`))
  })
})

test('writers: hooks started at once on disjoint files all run, and none of their saves is lost', async () => {
  await inTempDir(async (dir) => {
    const { data, env } = layout(dir)
    const tasks = ['w1', 'w2', 'w3', 'w4']
    const results = await Promise.all(tasks.map((task) => launch(env, task, `src/${task}.js`)))
    assert.deepEqual(results.map((item) => item.allowed), [true, true, true, true])
    assert.deepEqual(running(data), tasks, 'every hook read the others\' save under the lock and added its own')
    assert.deepEqual(Object.keys(loadSession(data, 's').log).sort(), tasks)
    assert.deepEqual(readdirSync(data).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')), [], 'no lock or temp file is left')
  })
})

test('writers: a session lock left by a crashed hook is taken over by the next real hook, which saves its state', async () => {
  await inTempDir(async (dir) => {
    const { data, env } = layout(dir)
    mkdirSync(data, { recursive: true })
    const lock = `${sessionFile(data, 's')}.lock`
    writeFileSync(lock, `${deadPid()}@${os.hostname()}`)
    assert.equal((await launch(env, 'a', 'src/users.js')).allowed, true)
    assert.deepEqual(running(data), ['a'], 'saved')
    assert.equal(existsSync(lock), false, 'the lock it took is released')
  })
})

// Gates

/** Runs prepareReport the way the Stop and PostToolUse hooks do and prints the gate. It tells the test the gate sits in its wait for the lock. */
const GATE_RUNNER = [
  "import { existsSync, writeFileSync } from 'node:fs'",
  "import { pathToFileURL } from 'node:url'",
  "const [, , module, waiting, budget, text] = process.argv",
  "const tiers = await import(pathToFileURL(module).href)",
  '// takeLock sleeps only while another process holds the lock.',
  'const sleep = Atomics.wait',
  'Atomics.wait = (...args) => {',
  "  if (!existsSync(waiting)) writeFileSync(waiting, '')",
  '  return sleep(...args)',
  '}',
  "const ctx = tiers.openContext({ session_id: 's' }, process.env)",
  "const event = { kind: 'report', role: 'implementer', prompt: '', text }",
  'console.log(JSON.stringify(tiers.prepareReport(ctx, event, {}, { budgetS: Number(budget) }).gate))',
  '',
].join('\n')

/** A command that logs its start, waits for the barrier file the test writes, and logs its end. */
const PROBE = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const [log, barrier, id] = process.argv.slice(2)',
  'appendFileSync(log, `start ${id}\\n`)',
  'while (!existsSync(barrier)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)',
  'appendFileSync(log, `end ${id}\\n`)',
  '',
].join('\n')

/** A project with the probe command, the runner, and the files the test steers the gates with. */
function gateRig(dir) {
  const rig = layout(dir, { CLAUDE_PLUGIN_OPTION_VERIFY: 'on', CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node probe.mjs' })
  const files = { log: path.join(dir, 'probe.log'), barrier: path.join(dir, 'barrier'), runner: path.join(dir, 'gate.mjs') }
  writeFileSync(path.join(rig.project, 'probe.mjs'), PROBE)
  writeFileSync(files.runner, GATE_RUNNER)
  const lines = () => (existsSync(files.log) ? readFileSync(files.log, 'utf8').split('\n').filter(Boolean) : [])
  const report = (id) =>
    ['CC_TIERS_TASK: paging', 'CC_TIERS_TIER: sonnet', 'CC_TIERS_ROLE: implementer', `CC_TIERS_VERIFY: node probe.mjs ${files.log} ${files.barrier} ${id}`, 'CC_TIERS_STATUS: pass', 'CC_TIERS_REASON: done'].join('\n')
  /** The gate of one report, started now; the child tells it is waiting for the lock through `<dir>/<id>.waiting`. */
  const gate = (id, budgetS = 60) => ({
    waiting: path.join(dir, `${id}.waiting`),
    done: spawnNode([files.runner, path.join(HOOKS, 'cc_tiers.mjs'), path.join(dir, `${id}.waiting`), String(budgetS), report(id)], { env: rig.env }).then((result) => {
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    }),
  })
  return { ...rig, ...files, lines, gate, release: () => writeFileSync(files.barrier, '') }
}

test('gates: two gates of one project started at once run one command after the other, and both keep their result', async () => {
  await inTempDir(async (dir) => {
    const rig = gateRig(dir)
    const first = rig.gate('g1')
    await until('the first gate to start its command', () => rig.lines().includes('start g1'))
    const second = rig.gate('g2')
    await until('the second gate to wait for the project lock', () => existsSync(second.waiting))
    assert.deepEqual(rig.lines(), ['start g1'], 'the second command has not started while the first holds the lock')
    rig.release()
    const [one, two] = await Promise.all([first.done, second.done])
    assert.equal(one.status, 'pass')
    assert.equal(two.status, 'pass')
    assert.deepEqual(rig.lines(), ['start g1', 'end g1', 'start g2', 'end g2'])
    assert.deepEqual(readdirSync(rig.data).filter((name) => name.endsWith('.lock')), [], 'the lock is released')
  })
})

test('gates: a gate that cannot get the project lock within its budget leaves its command not validated, and the gate that holds it keeps its result', async () => {
  await inTempDir(async (dir) => {
    const rig = gateRig(dir)
    const first = rig.gate('g1')
    await until('the first gate to start its command', () => rig.lines().includes('start g1'))
    const second = await rig.gate('g2', 0.4).done
    assert.equal(second.status, 'unverified')
    assert.deepEqual(second.verified, [])
    assert.equal(second.failure, null, 'a busy project is not a failed command')
    assert.match(second.unverified[0].reason, /^another cc-tiers gate was running: node probe\.mjs /)
    assert.deepEqual(rig.lines(), ['start g1'], 'the second command never ran')
    rig.release()
    const one = await first.done
    assert.equal(one.status, 'pass')
    assert.deepEqual(rig.lines(), ['start g1', 'end g1'])
  })
})

test('gates: a lock left by a crashed gate is taken over by the next real gate, which releases it', async () => {
  await inTempDir(async (dir) => {
    const rig = gateRig(dir)
    tiers.gateLock(rig.data, rig.project)(0)
    const lock = path.join(rig.data, readdirSync(rig.data).find((name) => /^gate-\w+\.lock$/.test(name)))
    writeFileSync(lock, `${deadPid()}@${os.hostname()}`)
    rig.release()
    const result = await rig.gate('g1').done
    assert.equal(result.status, 'pass', 'it did not wait for the dead holder')
    assert.deepEqual(rig.lines(), ['start g1', 'end g1'])
    assert.equal(existsSync(lock), false)
  })
})

test('gates: a gate of another host is left alone until the longest gate could have run; its holder is taken over past that', async () => {
  await inTempDir((dir) => {
    const lock = tiers.gateLock(dir, '/work/a')
    lock(0)
    const file = path.join(dir, readdirSync(dir)[0])
    writeFileSync(file, `${deadPid()}@${OTHER_HOST}`)
    age(file, 60000)
    assert.equal(lock(0.15), null, 'a pid of another host cannot be shown dead')
    age(file, GATE_LOCK_STALE_MS + 5000)
    assert.equal(typeof lock(0), 'function', 'no gate outlives its hook timeout')
  })
})

// Session lock

const routing = tiers.mergeRouting(DEFAULTS, null, {})

/** A session context whose state file already holds `kept`, with a short wait for the lock. */
function sessionRig(dir) {
  const data = path.join(dir, 'data')
  mkdirSync(data, { recursive: true })
  const file = tiers.sessionPath(data, 'sess-1')
  tiers.saveState(file, { ...tiers.emptyState('sess-1'), tasks: { kept: { tier: 'sonnet', failures: ['one'] } } })
  const ctx = { routing, projectDir: '', dataDir: data, file, sessionId: 'sess-1', env: {}, lockWaitMs: 150 }
  const tasks = () => Object.keys(JSON.parse(readFileSync(file, 'utf8')).tasks).sort()
  /** Whether fn ran holding the lock, from what withSession saved. */
  const touch = () => {
    let seen
    tiers.withSession(ctx, {}, (state) => {
      state.tasks.touched = { tier: 'sonnet', failures: [] }
      seen = Object.keys(state.tasks).sort()
    })
    return seen
  }
  return { ctx, data, file, lock: `${file}.lock`, tasks, touch }
}

test('session lock: a holder that died on this host is taken over and the hook saves', async () => {
  await inTempDir((dir) => {
    const rig = sessionRig(dir)
    writeFileSync(rig.lock, `${deadPid()}@${os.hostname()}`)
    assert.deepEqual(rig.touch(), ['kept', 'touched'])
    assert.deepEqual(rig.tasks(), ['kept', 'touched'], 'the state was saved')
    assert.equal(existsSync(rig.lock), false)
  })
})

test('session lock: a live holder on another host is left alone, the hook answers and saves nothing, and the state stays loadable', async () => {
  await inTempDir((dir) => {
    const rig = sessionRig(dir)
    writeFileSync(rig.lock, `${deadPid()}@${OTHER_HOST}`)
    age(rig.lock, 60000)
    const before = statSync(rig.lock).mtimeMs
    assert.deepEqual(rig.touch(), ['kept', 'touched'], 'the hook still answers from what it read')
    assert.deepEqual(rig.tasks(), ['kept'], 'but it did not save over the holder')
    assert.equal(readFileSync(rig.lock, 'utf8').endsWith(`@${OTHER_HOST}`), true, 'the holder\'s lock is intact')
    assert.equal(statSync(rig.lock).mtimeMs, before)
    assert.match(readFileSync(path.join(rig.data, 'hook-errors.jsonl'), 'utf8'), /"hook":"lock".*not saved/)
    assert.equal(tiers.loadState(rig.file, 'sess-1').tasks.kept.tier, 'sonnet')
  })
})

test('session lock: a holder with no pid is kept for 10 s, then taken over', async () => {
  await inTempDir((dir) => {
    const rig = sessionRig(dir)
    writeFileSync(rig.lock, '')
    assert.equal(tiers.withLock(rig.file, (held) => held, 150), false, 'a fresh lock with no pid may be a hook still running')
    age(rig.lock, LOCK_STALE_MS - 3000)
    assert.equal(tiers.withLock(rig.file, (held) => held, 150), false, 'still inside the 10 s')
    age(rig.lock, LOCK_STALE_MS + 3000)
    assert.deepEqual(rig.touch(), ['kept', 'touched'])
    assert.deepEqual(rig.tasks(), ['kept', 'touched'])
  })
})

test('session lock: a live process of this host keeps the lock until it exits, then the next hook takes it', async () => {
  await inTempDir(async (dir) => {
    const rig = sessionRig(dir)
    const holder = spawn(process.execPath, ['-e', "process.stdout.write('ready\\n'); process.stdin.resume()"], { stdio: ['pipe', 'pipe', 'ignore'] })
    try {
      await new Promise((resolve, reject) => {
        holder.once('error', reject)
        holder.stdout.once('data', resolve)
      })
      writeFileSync(rig.lock, `${holder.pid}@${os.hostname()}`)
      assert.equal(tiers.withLock(rig.file, (held) => held, 150), false, 'the holder is alive')
      assert.deepEqual(rig.tasks(), ['kept'])
      const exited = new Promise((resolve) => holder.once('exit', resolve))
      holder.stdin.end()
      await exited
      assert.deepEqual(rig.touch(), ['kept', 'touched'], 'the holder is gone')
    } finally {
      holder.kill()
    }
  })
})

// Memory and history

const IMPLEMENTER_FAIL = 'npm test exit 1: AssertionError expected 2 to equal 3'

/** A failure report of `role` as the PostToolUse hook gets it. */
function failure(task, role, tier, { session, id, reason }) {
  const prompt = `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\nAdd pagination to GET /${task}`
  const text = `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: ${reason}`
  return {
    session_id: session,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
    tool_response: { status: 'completed', content: [{ type: 'text', text }] },
  }
}

const memoryRecords = (project) => memory.loadMemory(memory.memoryPath(project)).records
const historyKinds = (project) => tiers.loadHistory(tiers.historyPath(project)).entries.map((entry) => entry.kind).sort()
const attempts = (data, session, task) => loadSession(data, session).log[task]?.attempts

test('memory and history: reports counted while both files are busy still save the session and break nothing; the next ones write', async () => {
  await inTempDir(async (dir) => {
    const { project, data, env } = layout(dir, { CLAUDE_PLUGIN_OPTION_LEARN: 'on', CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '3' })
    const memoryFile = memory.memoryPath(project)
    const historyFile = tiers.historyPath(project)
    const busy = (file) => writeFileSync(`${file}.lock`, `${deadPid()}@${OTHER_HOST}`)
    const run = (id) =>
      Promise.all([
        hook('after_agent.mjs', failure('lists', 'implementer', 'sonnet', { session: 'sA', id, reason: IMPLEMENTER_FAIL }), env),
        hook('after_agent.mjs', failure('orders', 'worker', 'haiku', { session: 'sB', id, reason: 'not a trivial task' }), env),
      ])

    busy(memoryFile)
    busy(historyFile)
    const [lists, orders] = await run('u1')
    for (const result of [lists, orders]) assert.equal(result.status, 0, result.stderr)
    assert.match(lists.stdout, /cc-tiers counted a failure for lists/, 'the hook still told the orchestrator')
    assert.doesNotMatch(orders.stdout, /recorded a Haiku failure/, 'nothing written, nothing said')
    assert.equal(attempts(data, 'sA', 'lists'), 1, 'the session state was saved')
    assert.equal(attempts(data, 'sB', 'orders'), 1)
    assert.equal(existsSync(memoryFile), false, 'no memory written over the holder')
    assert.equal(existsSync(historyFile), false)
    for (const file of [memoryFile, historyFile]) assert.match(readFileSync(`${file}.lock`, 'utf8'), new RegExp(`@${OTHER_HOST}$`), 'the holder\'s lock is intact')

    for (const file of [memoryFile, historyFile]) rmSync(`${file}.lock`)
    const [again, history] = await run('u2')
    for (const result of [again, history]) assert.equal(result.status, 0, result.stderr)
    assert.match(history.stdout, /recorded a Haiku failure for orders/)
    assert.equal(attempts(data, 'sA', 'lists'), 2, 'counts from before and after the busy lock are all there')
    assert.equal(attempts(data, 'sB', 'orders'), 2)
    assert.ok(memoryRecords(project).some((record) => record.task === 'lists'), 'memory loads and holds the record')
    assert.deepEqual(historyKinds(project), ['orders'])
    assert.deepEqual(readdirSync(path.join(project, '.claude')).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')), [], 'no lock or temp file is left')
  })
})

test('memory: records added by hooks and commands at the same time are all kept', async () => {
  await inTempDir(async (dir) => {
    const { project, env } = layout(dir)
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    const adds = words.map((word) => spawnNode([path.join(HOOKS, 'memory_cli.mjs'), project, 'add', 'convention', `the ${word} module keeps its own state`], { env }))
    const results = await Promise.all(adds)
    for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr)
    const contents = memoryRecords(project).map((record) => record.content)
    for (const word of words) assert.ok(contents.some((content) => content.includes(word)), `${word} is kept`)
    assert.equal(contents.length, words.length)
    assert.deepEqual(readdirSync(path.join(project, '.claude')).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')), [], 'no lock or temp file is left')
  })
})

test('history: Haiku failures counted by hooks at the same time are all kept', async () => {
  await inTempDir(async (dir) => {
    const { project, env } = layout(dir, { CLAUDE_PLUGIN_OPTION_LEARN: 'on' })
    const tasks = ['lists', 'orders', 'invoices', 'carts']
    const results = await Promise.all(tasks.map((task) => hook('after_agent.mjs', failure(task, 'worker', 'haiku', { session: `s-${task}`, id: `u-${task}`, reason: 'not a trivial task' }), env)))
    for (const result of results) assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(historyKinds(project), [...tasks].sort(), 'no hook overwrote another\'s entry')
  })
})
