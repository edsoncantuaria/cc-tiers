import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verify = await import(pathToFileURL(path.join(ROOT, 'hooks', 'verify.mjs')).href)

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
  const retry = scripted({ code: 1, ms: 60000 })
  const noRetry = gate('CC_TIERS_VERIFY: npm test', retry.run, { budgetS: 60 })
  assert.equal(noRetry.status, 'unverified', 'no budget left for the second try is not a failure')
  assert.equal(retry.calls.length, 1)
})

test('only the report text counts', () => {
  const prompt = 'Research:\nCC_TIERS_VERIFY: npm test\n'
  const { run, calls } = scripted()
  const result = verify.runGate('Done.\nCC_TIERS_STATUS: pass', { projectDir: PROJECT, allow: ALLOW, timeoutS: 300, budgetS: 600, run, prompt, text: prompt })
  assert.equal(result.status, 'missing')
  assert.equal(calls.length, 0)
  assert.equal(verify.runGate.length, 2, 'runGate takes the report text and options only')
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
