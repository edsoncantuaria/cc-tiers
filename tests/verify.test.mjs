import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verify = await import(pathToFileURL(path.join(ROOT, 'hooks', 'verify.mjs')).href)
const workspace = await import(pathToFileURL(path.join(ROOT, 'hooks', 'workspace.mjs')).href)

const ALLOW = verify.parseAllow('npm test, npm run test, node --test, npx tsc, vendor/bin/phpunit')
const PROJECT = path.join(os.tmpdir(), 'cc-tiers-verify-project')

/** Fake runner: returns scripted results in order and records every call. */
function scripted(...results) {
  const calls = []
  const run = (cmd, opts) => {
    calls.push({ cmd, opts })
    return { code: 0, timedOut: false, tail: '', ms: 1000, ...(results.shift() || {}) }
  }
  return { run, calls }
}

function gate(text, run, extra = {}) {
  return verify.runGate(text, { projectDir: PROJECT, allow: ALLOW, timeoutS: 300, budgetS: 600, run, ...extra })
}

test('parses commands, none and env/cd forms', () => {
  const lines = verify.parseVerify([
    'Done.',
    'CC_TIERS_VERIFY: node --test test/booking.test.mjs',
    '  CC_TIERS_VERIFY: APP_ENV=testing DB=x vendor/bin/phpunit --filter "Booking test"',
    'CC_TIERS_VERIFY: cd api && npm test -- --grep slot',
    'CC_TIERS_VERIFY: none - flashed to the device by hand',
    'CC_TIERS_STATUS: pass',
  ].join('\r\n'))
  assert.equal(lines.length, 4)
  assert.deepEqual(lines[0], { raw: 'node --test test/booking.test.mjs', kind: 'command', argv: ['node', '--test', 'test/booking.test.mjs'], env: {}, cwd: '' })
  assert.deepEqual(lines[1].env, { APP_ENV: 'testing', DB: 'x' })
  assert.deepEqual(lines[1].argv, ['vendor/bin/phpunit', '--filter', 'Booking test'])
  assert.equal(lines[2].cwd, 'api')
  assert.deepEqual(lines[2].argv, ['npm', 'test', '--', '--grep', 'slot'])
  assert.deepEqual(lines[3], { raw: 'none - flashed to the device by hand', kind: 'none', reason: 'flashed to the device by hand' })
})

test('refuses metacharacters and dirs outside the project', () => {
  const bad = [
    'npm test; rm -rf x',
    'npm test $(id)',
    'npm test `id`',
    'npm test | tee out',
    'npm test > out',
    'npm test < in',
    'npm test & sleep 1',
    'npm test && rm -rf x',
    'cd api && npm test && rm -rf x',
    'cd api && cd .. && npm test',
    'npm test $HOME',
    'npm test (x)',
    'cd /etc && npm test',
    'npm test "unclosed',
    'PATH=/tmp/evil npm test',
    'LD_PRELOAD=/tmp/x.so npm test',
    'APP_ENV=testing',
    'none -',
    '',
  ]
  for (const raw of bad) {
    const [line] = verify.parseVerify(`CC_TIERS_VERIFY: ${raw}`)
    assert.equal(line.kind, 'invalid', raw)
    assert.ok(line.reason, raw)
  }
  const { run, calls } = scripted()
  for (const raw of ['cd ../.. && npm test', 'cd api/../../x && npm test', 'cd .. && npm test', 'cd /etc && npm test', 'npm test; rm -rf x', 'npm test $(id)']) {
    const result = gate(`CC_TIERS_VERIFY: ${raw}`, run)
    assert.equal(result.status, 'unverified', raw)
    assert.equal(result.unverified.length, 1, raw)
    assert.equal(result.failure, null, raw)
  }
  assert.equal(calls.length, 0, 'a refused command never reaches the runner')
  const inside = gate('CC_TIERS_VERIFY: cd api/./sub/.. && npm test', run)
  assert.equal(inside.status, 'pass')
  assert.equal(calls[0].cmd.cwd, 'api/./sub/..')
})

test('allow list matches whole words', () => {
  const allow = verify.parseAllow(' npm test ,node --test,, docker  exec ')
  assert.deepEqual(allow, [['npm', 'test'], ['node', '--test'], ['docker', 'exec']])
  const defaults = verify.parseAllow('npm test, npm run test, node --test')
  assert.equal(verify.isAllowed(['npm', 'test', '--', 'x'], defaults), true)
  assert.equal(verify.isAllowed(['npm', 'test'], defaults), true)
  assert.equal(verify.isAllowed(['npm', 'testx'], defaults), false)
  assert.equal(verify.isAllowed(['npm'], defaults), false)
  assert.equal(verify.isAllowed(['docker', 'exec', 'x'], defaults), false)
  assert.equal(verify.isAllowed([], defaults), false)
})

test('pass without lines is missing', () => {
  const { run, calls } = scripted()
  const result = gate('All done.\nCC_TIERS_STATUS: pass', run)
  assert.equal(result.status, 'missing')
  assert.equal(calls.length, 0)
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking reported pass without CC_TIERS_VERIFY')
})

test('fails twice → fail with tail', () => {
  const { run, calls } = scripted({ code: 1, tail: 'first' }, { code: 1, tail: 'not ok 3 slot' })
  const result = gate('CC_TIERS_VERIFY: npm test\nCC_TIERS_VERIFY: npx tsc --noEmit', run)
  assert.equal(result.status, 'fail')
  assert.deepEqual(result.failure, { raw: 'npm test', code: 1, timedOut: false, tail: 'not ok 3 slot', seconds: 300 })
  assert.equal(calls.length, 2, 'stops after the failure')
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking failed: npm test (exit 1)')
})

test('a declared pre-existing failure is kept apart and the other commands still run', () => {
  const lines = 'CC_TIERS_VERIFY: npm test\nCC_TIERS_VERIFY: node --test tests/a.test.mjs'
  const { run, calls } = scripted({ code: 1, tail: 'main fails too' }, { code: 1, tail: 'main fails too' }, { code: 0 })
  const result = gate(lines, run, { preexisting: 'npm test' })
  assert.equal(result.status, 'fail')
  assert.equal(result.failure, null, 'nothing but the declared command failed')
  assert.deepEqual(result.preexisting, { raw: 'npm test', code: 1, timedOut: false, tail: 'main fails too', seconds: 300 })
  assert.deepEqual(result.verified, ['node --test tests/a.test.mjs'], 'the later command ran and passed')
  assert.deepEqual(calls.map((call) => call.cmd.raw), ['npm test', 'npm test', 'node --test tests/a.test.mjs'])
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking verified: node --test tests/a.test.mjs\ncc-tiers gate: booking failed: npm test (exit 1)')

  const other = scripted({ code: 1 }, { code: 1 }, { code: 1 }, { code: 1 })
  const both = gate(lines, other.run, { preexisting: 'npm test' })
  assert.equal(both.failure.raw, 'node --test tests/a.test.mjs', 'another failing command still counts')
  assert.equal(both.preexisting.raw, 'npm test')
  assert.equal(verify.gateFailure(both).raw, 'node --test tests/a.test.mjs')

  const first = scripted({ code: 1 }, { code: 1 })
  const reversed = gate('CC_TIERS_VERIFY: node --test tests/a.test.mjs\nCC_TIERS_VERIFY: npm test', first.run, { preexisting: 'npm test' })
  assert.equal(reversed.failure.raw, 'node --test tests/a.test.mjs')
  assert.equal(reversed.preexisting, undefined, 'the declared command listed after a failing one never ran')
  assert.equal(first.calls.length, 2)
})

test('without a declaration or when the declared command passes, nothing is kept apart', () => {
  const lines = 'CC_TIERS_VERIFY: npm test\nCC_TIERS_VERIFY: node --test tests/a.test.mjs'
  const plain = scripted({ code: 1 }, { code: 1 }, { code: 0 })
  const undeclared = gate(lines, plain.run)
  assert.equal(undeclared.failure.raw, 'npm test')
  assert.equal(undeclared.preexisting, undefined)
  assert.equal(plain.calls.length, 2, 'the first failure stops the gate as before')
  const other = scripted({ code: 1 }, { code: 1 })
  assert.equal(gate(lines, other.run, { preexisting: 'node --test tests/a.test.mjs' }).failure.raw, 'npm test', 'a declaration for another command opens nothing')
  const passing = gate(lines, scripted().run, { preexisting: 'npm test' })
  assert.equal(passing.status, 'pass')
  assert.equal(passing.preexisting, undefined)
  assert.equal(verify.gateFailure(passing), null)
})

test('fails then passes → flaky and pass', () => {
  const { run, calls } = scripted({ code: 1 }, { code: 0 }, { code: 0 })
  const result = gate('CC_TIERS_VERIFY: npm test\nCC_TIERS_VERIFY: npx tsc --noEmit', run)
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.flaky, ['npm test'])
  assert.deepEqual(result.verified, ['npm test', 'npx tsc --noEmit'])
  assert.equal(calls.length, 3)
  assert.equal(verify.gateMessage('booking', result), [
    'cc-tiers gate: booking verified: npm test; npx tsc --noEmit',
    'cc-tiers gate: booking flaky: npm test',
  ].join('\n'))
})

test('out of list → unverified, not fail', () => {
  const { run, calls } = scripted()
  const result = gate('CC_TIERS_VERIFY: docker exec app php artisan test\nCC_TIERS_VERIFY: none - checked the screen by hand', run)
  assert.equal(result.status, 'unverified')
  assert.equal(result.failure, null)
  assert.equal(calls.length, 0)
  assert.deepEqual(result.unverified, [
    { raw: 'docker exec app php artisan test', reason: 'outside verify_allow: docker exec app php artisan test (add its prefix in /config)' },
    { raw: 'none - checked the screen by hand', reason: 'checked the screen by hand' },
  ])
  assert.equal(verify.gateMessage('booking', result), [
    'cc-tiers gate: booking not validated: outside verify_allow: docker exec app php artisan test (add its prefix in /config)',
    'cc-tiers gate: booking not validated: checked the screen by hand',
  ].join('\n'))
  const mixed = gate('CC_TIERS_VERIFY: docker exec app x\nCC_TIERS_VERIFY: npm test', scripted().run)
  assert.equal(mixed.status, 'pass')
})

test('timeout → fail', () => {
  const { run, calls } = scripted({ code: null, timedOut: true, tail: 'hung', ms: 300000 })
  const result = gate('CC_TIERS_VERIFY: npm test', run)
  assert.equal(result.status, 'fail')
  assert.equal(result.failure.timedOut, true)
  assert.equal(calls.length, 1, 'a timeout is not retried')
  assert.equal(calls[0].opts.timeoutS, 300)
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking timed out: npm test after 300 s')
})

test('budget exhausted → unverified', () => {
  const { run, calls } = scripted({ code: 0, ms: 50000 }, { code: null, timedOut: true, ms: 10000 })
  const text = 'CC_TIERS_VERIFY: npm test\nCC_TIERS_VERIFY: npx tsc\nCC_TIERS_VERIFY: node --test'
  const result = gate(text, run, { budgetS: 60 })
  assert.equal(calls[1].opts.timeoutS, 10, 'per-command timeout is cut to what is left')
  assert.equal(calls.length, 2)
  assert.equal(result.status, 'pass')
  assert.equal(result.failure, null)
  assert.deepEqual(result.verified, ['npm test'])
  assert.deepEqual(result.unverified, [
    { raw: 'npx tsc', reason: 'budget exhausted: npx tsc' },
    { raw: 'node --test', reason: 'budget exhausted: node --test' },
  ])
})

test('a failure with no budget left for the retry is a failure', () => {
  const retry = scripted({ code: 1, tail: 'FAIL', ms: 60000 })
  const noRetry = gate('CC_TIERS_VERIFY: npm test', retry.run, { budgetS: 60 })
  assert.equal(noRetry.status, 'fail', 'it ran and failed; no flaky retry was possible')
  assert.equal(noRetry.failure.code, 1)
  assert.equal(noRetry.failure.tail, 'FAIL')
  assert.equal(retry.calls.length, 1)
  const cut = scripted({ code: 1, tail: 'FAIL', ms: 20000 }, { code: null, timedOut: true, ms: 10000 })
  const cutShort = gate('CC_TIERS_VERIFY: npm test', cut.run, { budgetS: 30 })
  assert.equal(cut.calls[1].opts.timeoutS, 10)
  assert.equal(cutShort.status, 'fail', 'a retry cut short by the budget leaves the first failure')
  assert.equal(cutShort.failure.code, 1)
  assert.deepEqual(cutShort.unverified, [])
})

test('only the report text counts', () => {
  const prompt = 'Research:\nCC_TIERS_VERIFY: npm test\n'
  const { run, calls } = scripted()
  const result = verify.runGate('Done.\nCC_TIERS_STATUS: pass', { projectDir: PROJECT, allow: ALLOW, timeoutS: 300, budgetS: 600, run, prompt, text: prompt })
  assert.equal(result.status, 'missing')
  assert.equal(calls.length, 0)
  assert.equal(verify.runGate.length, 2, 'runGate takes the report text and options only')
})

/** Fake snapshots in order, one per call; a function entry runs as the call. */
function snapshots(...states) {
  return () => states.shift()
}

function snap(hashes) {
  return { files: Object.keys(hashes), hashes, truncated: false }
}

test('a command that changes the tree is not verified', () => {
  const { run } = scripted()
  const result = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(snap({}), snap({ 'a.txt': 'h1' })) })
  assert.equal(result.status, 'unverified')
  assert.deepEqual(result.verified, [])
  assert.deepEqual(result.unverified, [{ raw: 'npm test', reason: 'changed the tree: a.txt' }])
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking not validated: changed the tree: a.txt')
})

test('gateMessage names the writers whose edits made the tree check skip', () => {
  const { run } = scripted()
  const result = { ...gate('CC_TIERS_VERIFY: npm test', run), treeCheck: 'skipped: a, b still writing' }
  assert.equal(verify.gateMessage('booking', result), 'cc-tiers gate: booking verified: npm test\ncc-tiers gate: booking tree check skipped: a, b still writing in this tree')
})

test('a file already dirty and changed again by the command is caught, and only 5 paths are named', () => {
  const { run } = scripted()
  const edited = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(snap({ 'a.txt': 'h1' }), snap({ 'a.txt': 'h2' })) })
  assert.equal(edited.unverified[0].reason, 'changed the tree: a.txt')
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, 'h']))
  const wide = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(snap({}), snap(many)) })
  assert.equal(wide.unverified[0].reason, 'changed the tree: f0, f1, f2, f3, f4')
})

test('a command that leaves the tree as it was is verified', () => {
  const { run } = scripted()
  const tree = snap({ 'a.txt': 'h1' })
  const result = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(tree, snap({ 'a.txt': 'h1' })) })
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.verified, ['npm test'])
  assert.deepEqual(result.unverified, [])
})

test('a failing command stays a failure even when it changed the tree', () => {
  const { run } = scripted({ code: 1 }, { code: 1 })
  const result = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(snap({}), snap({ 'a.txt': 'h1' })) })
  assert.equal(result.status, 'fail')
  assert.deepEqual(result.unverified, [])
})

test('the snapshot spans both runs of a flaky retry', () => {
  const { run, calls } = scripted({ code: 1 }, { code: 0 })
  const result = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: snapshots(snap({}), snap({ 'made.txt': 'h1' })) })
  assert.equal(calls.length, 2)
  assert.deepEqual(result.flaky, [])
  assert.equal(result.unverified[0].reason, 'changed the tree: made.txt')
})

test('no snapshot (outside git) or a cached pass behaves as before', () => {
  const { run } = scripted()
  const outside = gate('CC_TIERS_VERIFY: npm test', run, { snapshot: () => null })
  assert.equal(outside.status, 'pass')
  const taken = []
  const reused = gate('CC_TIERS_VERIFY: npm test', run, { cached: () => true, snapshot: () => taken.push(1) })
  assert.deepEqual(reused.cached, ['npm test'])
  assert.deepEqual(taken, [], 'a cached pass takes no snapshot')
})

test('a real command that writes a file into a git repo is not verified', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-verify-git-'))
  try {
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' })
    git('init', '-q')
    await writeFile(path.join(dir, 'clean.mjs'), 'process.exit(0)\n')
    await writeFile(path.join(dir, 'writes.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('made.txt', 'x')\n")
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    // Plain node: a child node --test inside this test run would skip running its files.
    const snapshot = () => workspace.workspaceSnapshot(dir)
    const options = { projectDir: dir, allow: verify.parseAllow('node'), timeoutS: 60, budgetS: 120, snapshot }
    const clean = verify.runGate('CC_TIERS_VERIFY: node clean.mjs', options)
    assert.equal(clean.status, 'pass')
    const writes = verify.runGate('CC_TIERS_VERIFY: node writes.mjs', options)
    assert.equal(writes.status, 'unverified')
    assert.equal(writes.unverified[0].reason, 'changed the tree: made.txt')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCommand runs a real node command', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-verify-'))
  try {
    await mkdir(path.join(dir, 'sub'))
    const exit = verify.runCommand({ argv: [process.execPath, '-e', 'console.log(process.cwd()); console.error(process.env.CC_X); process.exit(3)'], env: { CC_X: 'from-env' }, cwd: 'sub' }, { projectDir: dir, timeoutS: 30 })
    assert.equal(exit.code, 3)
    assert.equal(exit.timedOut, false)
    assert.match(exit.tail, /sub/)
    assert.match(exit.tail, /from-env/)
    assert.ok(exit.ms >= 0)
    const many = verify.runCommand({ argv: [process.execPath, '-e', 'for (let i = 1; i <= 100; i++) console.log("line " + i)'] }, { projectDir: dir, timeoutS: 30 })
    assert.equal(many.code, 0)
    assert.equal(many.tail.split('\n').length, 40)
    assert.match(many.tail, /^line 61\n/)
    const hung = verify.runCommand({ argv: [process.execPath, '-e', 'setTimeout(() => {}, 5000)'] }, { projectDir: dir, timeoutS: 1 })
    assert.equal(hung.timedOut, true)
    assert.equal(hung.code, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const INLINE = [
  'node --test --import=data:text/javascript,import%7BwriteFileSync%20as%20w%7Dfrom%22node:fs%22%3Bw%28%22PWNED1%22,%22x%22%29',
  'NODE_OPTIONS=--import=data:text/javascript,import%7BwriteFileSync%20as%20w%7Dfrom%22node:fs%22%3Bw%28%22PWNED2%22,%22x%22%29 node --test',
]

test('refuses inline code through flags, data URLs and env', () => {
  const bad = [
    ...INLINE,
    'node --test --import data:text/javascript,x',
    'node --test --import ./x.mjs',
    'node --test x "JavaScript:alert"',
    'node --test --require=./x.cjs',
    'node --test -r ./x.cjs',
    'node --test --loader ./x.mjs',
    'node --test --experimental-loader=./x.mjs',
    'node -e 1',
    'node --eval=1',
    'node -p 1',
    'node -pe 1',
    'node --print 1',
    'npm test --script-shell=/tmp/sh',
    'npm test --script-sh=/tmp/sh',
    'npm test --node-options=--require=x',
    'npm test --userconfig /tmp/rc',
    'npm test --globalconfig=/tmp/rc',
    'npm test -- --import=./x.mjs',
    'pytest -p evil',
    'node_options=--require=x node --test',
    'NODE_PATH=/tmp node --test',
    'npm_config_script_shell=/tmp/sh npm test',
    'NPM_CONFIG_NODE_OPTIONS=x npm test',
    'PYTHONPATH=/tmp pytest',
    'PYTHONSTARTUP=/tmp/x pytest',
    'PYTHONHOME=/tmp pytest',
    'BASH_ENV=/tmp/x npm test',
    'ENV=/tmp/x npm test',
    'PERL5OPT=-Mx npm test',
    'PERL5LIB=/tmp npm test',
    'RUBYOPT=-rx npm test',
    'JAVA_TOOL_OPTIONS=-x npm test',
    '_JAVA_OPTIONS=-x npm test',
    'PHPRC=/tmp vendor/bin/phpunit',
    'PHP_INI_SCAN_DIR=/tmp vendor/bin/phpunit',
    'PATHEXT=.X npm test',
  ]
  for (const raw of bad) {
    const [line] = verify.parseVerify(`CC_TIERS_VERIFY: ${raw}`)
    assert.equal(line.kind, 'invalid', raw)
  }
  for (const raw of ['npm test -- --grep slot', 'node --test --test-name-pattern=slot', 'APP_ENV=testing vendor/bin/phpunit', 'pytest -k slot', 'npm test -- --reporter=dot']) {
    assert.equal(verify.parseVerify(`CC_TIERS_VERIFY: ${raw}`)[0].kind, 'command', raw)
  }
})

test('inline code on an allowed prefix never runs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-verify-'))
  try {
    const allow = verify.parseAllow('node --test, npm test')
    for (const raw of INLINE) {
      const result = verify.runGate(`CC_TIERS_VERIFY: ${raw}`, { projectDir: dir, allow, timeoutS: 20, budgetS: 30 })
      assert.equal(result.status, 'unverified', raw)
      assert.equal(result.failure, null, raw)
    }
    assert.equal(existsSync(path.join(dir, 'PWNED1')), false)
    assert.equal(existsSync(path.join(dir, 'PWNED2')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('on win32 also refuses cmd.exe expansion characters', () => {
  for (const raw of ['npm test %PATH%', 'npm test !x!', 'npm test a^b', 'cd a%b && npm test']) {
    assert.equal(verify.parseVerify(`CC_TIERS_VERIFY: ${raw}`, { platform: 'win32' })[0].kind, 'invalid', raw)
    assert.equal(verify.parseVerify(`CC_TIERS_VERIFY: ${raw}`, { platform: 'linux' })[0].kind, 'command', raw)
  }
})

test('a cd through a symlink out of the project is refused', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-verify-'))
  try {
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, 'api'), { recursive: true })
    mkdirSync(path.join(dir, 'outside'))
    symlinkSync(path.join(dir, 'outside'), path.join(project, 'link'))
    const { run, calls } = scripted()
    const out = verify.runGate('CC_TIERS_VERIFY: cd link && npm test', { projectDir: project, allow: ALLOW, timeoutS: 300, budgetS: 600, run })
    assert.equal(out.status, 'unverified')
    assert.equal(calls.length, 0)
    const inside = verify.runGate('CC_TIERS_VERIFY: cd api && npm test', { projectDir: project, allow: ALLOW, timeoutS: 300, budgetS: 600, run })
    assert.equal(inside.status, 'pass')
    const missing = verify.runGate('CC_TIERS_VERIFY: cd gone && npm test', { projectDir: project, allow: ALLOW, timeoutS: 300, budgetS: 600, run })
    assert.equal(missing.status, 'pass', 'a dir that does not exist is judged by its path')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('runCommand kills a child that ignores SIGTERM', () => {
  // The child exits by itself after 8 s, so without SIGKILL this returns late instead of hanging the suite.
  const result = verify.runCommand({ argv: [process.execPath, '-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 8000)"] }, { projectDir: os.tmpdir(), timeoutS: 1 })
  assert.equal(result.timedOut, true)
  assert.equal(result.code, null)
  assert.ok(result.ms < 5000, `returned after ${result.ms} ms`)
})

const FIELDS = { category: 'state', severity: 'blocking', evidence: 'trace', expected: 'stays open', observed: 'closed', where: 'src/a.js:1' }

function block(fields) {
  const body = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return ['CC_TIERS_FINDING_BEGIN', ...body, 'CC_TIERS_FINDING_END'].join('\n')
}

function judge(fields, run, extra = {}) {
  const findings = verify.parseFindings(block(fields))
  return verify.judgeFindings(findings, { specText: '', allow: ALLOW, projectDir: PROJECT, timeoutS: 300, budgetS: 600, run, ...extra })
}

test('parses a full finding of each evidence kind', () => {
  const text = [
    'Review done.',
    block({ ...FIELDS, evidence: 'command', command: 'node --test t/a.test.mjs' }),
    block(FIELDS).replace('category: state', 'CATEGORY:   security  '),
    block({ category: 'correctness', severity: 'blocking', evidence: 'coverage', criterion: 'Slot Libre', where: 'test/a.test.mjs' }),
    'CC_TIERS_STATUS: fail',
  ].join('\n')
  const found = verify.parseFindings(text)
  assert.equal(found.length, 3)
  assert.ok(found.every((f) => f.valid), JSON.stringify(found))
  assert.equal(found[0].command, 'node --test t/a.test.mjs')
  assert.equal(found[1].category, 'security')
  assert.equal(found[2].criterion, 'Slot Libre')
})

test('incomplete or unknown values are invalid', () => {
  const cases = [
    { ...FIELDS, category: 'style' },
    { ...FIELDS, severity: 'major' },
    { ...FIELDS, evidence: 'hunch' },
    { ...FIELDS, observed: '' },
    { ...FIELDS, where: '' },
    { ...FIELDS, evidence: 'command' },
    { ...FIELDS, evidence: 'coverage', where: 'x' },
  ]
  for (const fields of cases) {
    const [found] = verify.parseFindings(block(fields))
    assert.equal(found.valid, false, JSON.stringify(fields))
    assert.ok(found.problem)
  }
  const unclosed = verify.parseFindings(`CC_TIERS_FINDING_BEGIN\ncategory: state\nseverity: blocking`)
  assert.equal(unclosed.length, 1)
  assert.equal(unclosed[0].valid, false)
  assert.equal(verify.parseFindings('no blocks here').length, 0)
})

test('command evidence that passes is discarded', () => {
  const { run, calls } = scripted({ code: 0 })
  const out = judge({ ...FIELDS, evidence: 'command', command: 'node --test t/a.test.mjs' }, run)
  assert.equal(calls.length, 1)
  assert.equal(out.discarded.length, 1)
  assert.equal(out.blocking.length, 0)
})

test('command evidence that fails blocks, once', () => {
  const { run, calls } = scripted({ code: 1 })
  const out = judge({ ...FIELDS, evidence: 'command', command: 'node --test t/a.test.mjs' }, run)
  assert.equal(calls.length, 1)
  assert.equal(out.blocking.length, 1)
  assert.equal(out.discarded.length, 0)
})

test('out-of-list command evidence counts as trace', () => {
  const { run, calls } = scripted()
  for (const command of ['rm -rf x', 'npm test; id', 'cd .. && npm test']) {
    const out = judge({ ...FIELDS, evidence: 'command', command }, run)
    assert.equal(out.blocking.length, 1, command)
  }
  assert.equal(calls.length, 0)
  const out = judge({ ...FIELDS, evidence: 'command', command: 'node --test x' }, run, { budgetS: 0 })
  assert.equal(out.blocking.length, 1)
  assert.equal(calls.length, 0)
})

test('coverage needs the criterion in the spec block', () => {
  const fields = { category: 'correctness', severity: 'blocking', evidence: 'coverage', criterion: 'O slot  livre não duplica', where: 'test/a' }
  const spec = '- O SLOT LIVRE nao duplica\n- outro'
  assert.equal(judge(fields, undefined, { specText: spec }).blocking.length, 1)
  assert.equal(judge(fields, undefined, { specText: '- outra coisa' }).invalid.length, 1)
  const empty = judge(fields, undefined, { specText: '' })
  assert.equal(empty.blocking.length, 0)
  assert.equal(empty.invalid.length, 1)
})

test('coverage matches a whole spec line, not a fragment', () => {
  const coverage = (criterion) => ({ category: 'correctness', severity: 'blocking', evidence: 'coverage', criterion, where: 'test/a' })
  const spec = [
    'Criteria:',
    '- O turno reaberto fica aberto (request)',
    '* Slot ocupado recusa a reserva (repo: src/slot.js:12)',
    '• Datas em UTC (docs: https://x/y)',
    '1. Limite de 3 reservas (decided: igual ao legado (v1))',
    '- Cancelar devolve o crédito (user)',
  ].join('\n')
  for (const criterion of ['a', 'turno', 'O turno reaberto', 'fica aberto (request)']) {
    assert.equal(judge(coverage(criterion), undefined, { specText: spec }).blocking.length, 0, criterion)
  }
  for (const criterion of [
    'O turno reaberto fica aberto',
    '- o TURNO reaberto  fica aberto (request)',
    'Slot ocupado recusa a reserva',
    'Datas em UTC',
    'Limite de 3 reservas',
    '2. Cancelar devolve o credito',
  ]) {
    assert.equal(judge(coverage(criterion), undefined, { specText: spec }).blocking.length, 1, criterion)
  }
})

test('notes never block', () => {
  const { run, calls } = scripted()
  const out = judge({ ...FIELDS, severity: 'note', evidence: 'command', command: 'node --test x' }, run)
  assert.equal(out.notes.length, 1)
  assert.equal(out.blocking.length + out.discarded.length, 0)
  assert.equal(calls.length, 0)
})

test('review message and writer note', () => {
  const { run } = scripted({ code: 0 })
  const text = [
    block({ ...FIELDS, evidence: 'command', command: 'node --test x' }),
    block({ ...FIELDS, severity: 'note', where: 'src/n.js:2' }),
    block({ ...FIELDS, observed: '' }),
  ].join('\n')
  const out = verify.judgeFindings(verify.parseFindings(text), { specText: '', allow: ALLOW, projectDir: PROJECT, timeoutS: 300, budgetS: 600, run })
  const message = verify.reviewMessage('T1', out, { failed: true })
  assert.match(message, /cc-tiers review: T1 discarded 1 finding\(s\): the evidence command passed/)
  assert.match(message, /cc-tiers review: T1 rejected without evidence; 3 finding\(s\) became notes/)
  assert.match(message, /Notes:\n.*state @ src\/n\.js:2/)
  assert.doesNotMatch(verify.reviewMessage('T1', out), /rejected without evidence/)
  assert.match(verify.reviewMessage('T1', { blocking: [], discarded: [], notes: [], invalid: [] }, { failed: true }), /rejected without evidence; 0 finding/)
  const real = judge(FIELDS)
  assert.equal(verify.findingsNote(real), 'state @ src/a.js:1: stays open / closed')
})
