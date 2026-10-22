import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const telemetry = await import(pathToFileURL(path.join(ROOT, 'hooks', 'telemetry.mjs')).href)
const insights = await import(pathToFileURL(path.join(ROOT, 'hooks', 'insights.mjs')).href)
const { REDUCED_TYPES, parseTelemetry, readEvents, recordEvent, sanitizeEvent, telemetryPath } = telemetry
const { renderInsights, summarize } = insights
const SCRIPT = path.join(ROOT, 'hooks', 'insights.mjs')

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-tiers-telemetry-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('parseTelemetry accepts levels and booleans, anything else is the fallback', () => {
  assert.equal(parseTelemetry('reduced'), 'reduced')
  assert.equal(parseTelemetry(' OFF '), 'off')
  for (const value of [true, 'true', 'yes', '1']) assert.equal(parseTelemetry(value), 'on')
  for (const value of [false, 'false', 'no', '0']) assert.equal(parseTelemetry(value), 'off')
  assert.equal(parseTelemetry('maybe'), 'on')
  assert.equal(parseTelemetry(undefined, 'reduced'), 'reduced')
  assert.equal(parseTelemetry('', 'off'), 'off')
})

test('sanitizeEvent keeps only whitelisted keys and shapes', () => {
  const clean = sanitizeEvent({
    type: 'verify.done',
    task: 'fix-login',
    prompt: 'the whole prompt text',
    attempt: 2,
    tokens: Infinity,
    durationMs: 1200,
    confirmed: true,
    factors: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    gate: { verified: 2, unverified: 1, failed: 'x', extra: 5 },
    review: { blocking: 1, notes: NaN, other: 3 },
    reason: 'x'.repeat(300),
    risk: 'y'.repeat(120),
  })
  assert.equal(clean.prompt, undefined)
  assert.equal(clean.tokens, undefined)
  assert.equal(clean.attempt, 2)
  assert.equal(clean.confirmed, true)
  assert.equal(clean.factors.length, 8)
  assert.deepEqual(clean.gate, { verified: 2, unverified: 1 })
  assert.deepEqual(clean.review, { blocking: 1 })
  assert.equal(clean.reason.length, 200)
  assert.equal(clean.risk.length, 80)
})

test('sanitizeEvent rejects unknown types and marks costs as estimated', () => {
  assert.equal(sanitizeEvent({ type: 'nope' }), null)
  assert.equal(sanitizeEvent(null), null)
  assert.equal(sanitizeEvent({ type: 'task.passed', costUsd: 0.5 }).costEstimated, true)
  assert.equal(sanitizeEvent({ type: 'task.passed', costUsd: 0.5, costEstimated: false }).costEstimated, false)
  assert.equal('costEstimated' in sanitizeEvent({ type: 'task.passed' }), false)
})

test('recordEvent stores a secret in a reason redacted', (t) => {
  const file = telemetryPath(tempDir(t))
  assert.equal(recordEvent(file, { type: 'failure.diagnosed', reason: 'login failed password=abc' }), true)
  const line = readFileSync(file, 'utf8')
  assert.ok(!line.includes('abc'))
  assert.match(line, /password=\[redacted\]/)
})

test('recordEvent honours levels and sets ts', (t) => {
  const file = telemetryPath(tempDir(t))
  const now = Date.UTC(2026, 9, 21)
  assert.equal(recordEvent(file, { type: 'task.passed' }, { level: 'off' }), false)
  assert.equal(existsSync(file), false)
  assert.equal(recordEvent(file, { type: 'model.selected' }, { level: 'reduced' }), false)
  assert.equal(recordEvent(file, { type: 'nope' }), false)
  for (const type of REDUCED_TYPES) assert.equal(recordEvent(file, { type }, { level: 'reduced', now }), true, type)
  assert.equal(recordEvent(file, { type: 'model.selected', ts: '2026-01-01T00:00:00.000Z' }), true)
  const events = readEvents(file)
  assert.equal(events.length, REDUCED_TYPES.length + 1)
  assert.equal(events[0].ts, '2026-10-21T00:00:00.000Z')
  assert.equal(events.at(-1).ts, '2026-01-01T00:00:00.000Z')
})

test('recordEvent never throws and creates the data dir', (t) => {
  const dir = tempDir(t)
  const blocker = path.join(dir, 'file')
  writeFileSync(blocker, 'x')
  assert.equal(recordEvent(path.join(blocker, 'sub', 'events.jsonl'), { type: 'task.passed' }), false)
  assert.equal(recordEvent(telemetryPath(path.join(dir, 'new', 'deep')), { type: 'task.passed' }), true)
})

test('recordEvent rotates to events.1.jsonl once and readEvents reads both', (t) => {
  const dir = tempDir(t)
  const file = telemetryPath(dir)
  const options = { maxBytes: 100 }
  let n = 0
  while (!existsSync(path.join(dir, 'events.1.jsonl'))) recordEvent(file, { type: 'task.passed', task: `t${n++}` }, options)
  const rotated = readFileSync(path.join(dir, 'events.1.jsonl'), 'utf8').trim().split('\n').length
  const current = readFileSync(file, 'utf8').trim().split('\n').length
  assert.equal(current, 1)
  assert.equal(readEvents(file).length, rotated + current)
  assert.equal(readEvents(file)[0].task, 't0')
  // A second rotation replaces the older rotated file.
  while (readFileSync(path.join(dir, 'events.1.jsonl'), 'utf8').includes('"t0"')) recordEvent(file, { type: 'task.passed', task: `t${n++}` }, options)
  assert.ok(!readEvents(file).some((event) => event.task === 't0'))
})

test('readEvents skips malformed lines and returns [] for a missing file', (t) => {
  const dir = tempDir(t)
  const file = telemetryPath(dir)
  assert.deepEqual(readEvents(file), [])
  assert.deepEqual(readEvents(path.join(dir, 'missing', 'events.jsonl')), [])
  writeFileSync(file, '{"type":"task.passed"}\nnot json\n\n[1]\n{"type":"escalated"\n{"type":"task.stopped"}\n')
  assert.deepEqual(readEvents(file).map((event) => event.type), ['task.passed', 'task.stopped'])
})

function manyTasks(count) {
  const events = []
  for (let i = 0; i < count; i++) {
    events.push({ type: 'task.passed', task: `t${i}`, risk: i % 2 ? 'high' : 'low', costUsd: 0.1, confidence: 'high' })
  }
  return events
}

test('summarize counts outcomes, categories, escalations, cost, unverified and rework', () => {
  const summary = summarize([
    { type: 'failure.diagnosed', task: 'a', category: 'test' },
    { type: 'failure.diagnosed', task: 'a', category: 'test' },
    { type: 'failure.diagnosed', task: 'b', category: 'type' },
    { type: 'escalated', task: 'a', because: 'risk' },
    { type: 'escalated', task: 'b', category: 'type' },
    { type: 'verify.done', task: 'a', gate: { unverified: 1 }, reason: 'no test command' },
    { type: 'verify.done', task: 'a', gate: { unverified: 0 }, reason: 'ignored' },
    { type: 'task.passed', task: 'a', risk: 'high', costUsd: 0.2, confidence: 'medium' },
    { type: 'task.stopped', task: 'b', risk: 'high', costUsd: 0.3 },
    { type: 'task.passed', task: 'c', __proto__: undefined },
  ])
  assert.equal(summary.events, 10)
  assert.equal(summary.tasks, 3)
  assert.equal(summary.passed, 2)
  assert.equal(summary.stopped, 1)
  assert.equal(summary.escalations, 2)
  assert.deepEqual(summary.byCategory, { test: 2, type: 1 })
  assert.deepEqual(summary.escalationReasons, { risk: 1, type: 1 })
  assert.deepEqual(summary.unverified, { 'no test command': 1 })
  assert.equal(summary.costByRisk.high.tasks, 2)
  assert.ok(Math.abs(summary.costByRisk.high.usd - 0.5) < 1e-9)
  assert.deepEqual(summary.rework, { tasks: 2, total: 3 })
  assert.deepEqual(summary.confidence, { medium: 1, unknown: 1 })
})

test('summarize of nothing works and a small sample carries the routing note', () => {
  const empty = summarize([])
  assert.equal(empty.events, 0)
  assert.equal(empty.sample, 'small')
  const small = summarize(manyTasks(9))
  assert.equal(small.sample, 'small')
  assert.match(small.notes.join(' '), /descriptive only and must not change routing/)
  const enough = summarize(manyTasks(10))
  assert.equal(enough.sample, 'enough')
  assert.deepEqual(enough.notes, [])
  assert.equal(summarize(manyTasks(3), { minSample: 3 }).sample, 'enough')
})

test('summarize survives a category named __proto__', () => {
  const summary = summarize([{ type: 'failure.diagnosed', task: 'a', category: '__proto__' }])
  assert.equal(Object.keys(summary.byCategory).length, 1)
})

test('renderInsights sorts by count and marks cost as estimated', () => {
  const text = renderInsights(summarize([
    { type: 'failure.diagnosed', task: 'a', category: 'rare' },
    { type: 'failure.diagnosed', task: 'a', category: 'common' },
    { type: 'failure.diagnosed', task: 'b', category: 'common' },
    { type: 'task.passed', task: 'a', risk: 'high', costUsd: 0.25 },
  ]))
  assert.ok(text.indexOf('common') < text.indexOf('rare'))
  assert.match(text, /Cost by risk \(estimated\)/)
  assert.match(text, /estimated USD/)
  assert.match(text, /descriptive only/)
  assert.ok(!text.includes('Escalation reasons'))
})

function started(task, tier, risk = 'medium') {
  return { type: 'model.selected', task, tier, role: 'implementer', effort: 'medium', risk }
}

test('summarize groups tasks by the tier they started on and what happened next', () => {
  const summary = summarize([
    started('a', 'sonnet'),
    { type: 'task.passed', task: 'a', tier: 'sonnet' },
    started('b', 'sonnet', 'high'),
    { type: 'failure.diagnosed', task: 'b', category: 'test' },
    { type: 'escalated', task: 'b', because: 'test' },
    started('b', 'opus', 'high'),
    { type: 'task.passed', task: 'b', tier: 'opus' },
    started('c', 'sonnet'),
    { type: 'review.done', task: 'c', outcome: 'fail', review: { blocking: 2, discarded: 0, notes: 0 } },
    { type: 'task.passed', task: 'c', tier: 'sonnet' },
    started('d', 'haiku', 'low'),
    { type: 'escalated', task: 'd', because: 'attempts' },
    { type: 'task.stopped', task: 'd', tier: 'sonnet' },
    started('e', 'haiku', 'low'),
    { type: 'escalated', task: 'e', because: 'attempts' },
    { type: 'task.passed', task: 'no-start', tier: 'sonnet' },
    { type: 'model.selected', tier: 'opus' },
  ])
  assert.deepEqual(summary.hindsight.byStart, {
    haiku: { tasks: 2, passed: 0, escalated: 2, finishedOn: { sonnet: 1, open: 1 }, stopped: 1, afterBlocking: 0 },
    sonnet: { tasks: 3, passed: 2, escalated: 1, finishedOn: { opus: 1 }, stopped: 0, afterBlocking: 1 },
  })
  assert.equal(summary.tasks, 6)
  assert.equal(summary.hindsight.overRouted, 0)
})

test('summarize flags only calm low or medium risk passes that started on opus as possibly over-routed', () => {
  const summary = summarize([
    started('calm-low', 'opus', 'low'),
    { type: 'task.passed', task: 'calm-low', tier: 'opus' },
    started('calm-medium', 'opus', 'medium'),
    { type: 'task.passed', task: 'calm-medium', tier: 'opus' },
    started('high', 'opus', 'high'),
    { type: 'task.passed', task: 'high', tier: 'opus' },
    started('blocked', 'opus', 'low'),
    { type: 'review.done', task: 'blocked', review: { blocking: 1 } },
    { type: 'task.passed', task: 'blocked', tier: 'opus' },
    started('clean-review', 'opus', 'low'),
    { type: 'review.done', task: 'clean-review', review: { blocking: 0, discarded: 1 } },
    { type: 'task.passed', task: 'clean-review', tier: 'opus' },
    started('diagnosed', 'opus', 'low'),
    { type: 'failure.diagnosed', task: 'diagnosed', category: 'test' },
    { type: 'task.passed', task: 'diagnosed', tier: 'opus' },
    started('stopped', 'opus', 'low'),
    { type: 'task.stopped', task: 'stopped', tier: 'opus' },
    started('sonnet', 'sonnet', 'low'),
    { type: 'task.passed', task: 'sonnet', tier: 'sonnet' },
    started('open', 'opus', 'low'),
  ])
  assert.equal(summary.hindsight.overRouted, 3)
  assert.equal(summary.hindsight.byStart.opus.tasks, 8)
  assert.equal(summary.hindsight.byStart.opus.afterBlocking, 1)
})

test('renderInsights prints the hindsight table in tier order and the over-routed hint only when above 0', () => {
  const text = renderInsights(summarize([
    started('a', 'opus', 'low'),
    { type: 'task.passed', task: 'a', tier: 'opus' },
    started('b', 'haiku', 'low'),
    { type: 'escalated', task: 'b', because: 'attempts' },
    { type: 'task.passed', task: 'b', tier: 'sonnet' },
    started('c', 'sonnet'),
    { type: 'task.passed', task: 'c', tier: 'sonnet' },
  ]))
  assert.match(text, /### Routing in hindsight/)
  assert.match(text, /\| started on \| tasks \| passed there \| escalated \| escalated, finished on \| stopped \| passed after blocking review \|/)
  assert.match(text, /\| haiku \| 1 \| 0 \| 1 \| sonnet 1 \| 0 \| 0 \|\n\| sonnet \| 1 \| 1 \| 0 \| - \| 0 \| 0 \|\n\| opus \| 1 \| 1 \| 0 \| - \| 0 \| 0 \|/)
  assert.match(text, /Possibly over-routed: 1 task\(s\) started on opus at low or medium risk/)
  assert.match(text, /A hint to look at, not a verdict\./)
  const calm = renderInsights(summarize([started('a', 'opus', 'high'), { type: 'task.passed', task: 'a', tier: 'opus' }]))
  assert.match(calm, /### Routing in hindsight/)
  assert.ok(!calm.includes('over-routed'))
})

test('reduced telemetry has no start tier, so the table is omitted and the report is unchanged', () => {
  const summary = summarize([
    { type: 'task.passed', task: 'a', risk: 'low', costUsd: 0.01 },
    { type: 'task.stopped', task: 'b', risk: 'high', costUsd: 0.02 },
    { type: 'escalated', task: 'b', because: 'attempts' },
  ])
  assert.deepEqual(summary.hindsight, { byStart: {}, overRouted: 0 })
  const text = renderInsights(summary)
  assert.ok(!text.includes('hindsight'))
  assert.ok(!text.includes('over-routed'))
  assert.equal(
    text,
    [
      '## cc-tiers insights',
      '',
      '2 tasks, 3 events: 1 passed, 1 stopped, 1 escalations.',
      'Rework: 0 of 2 tasks had a diagnosed failure.',
      'Sample: small.',
      '',
      '### Escalation reasons',
      '',
      '| reason | count |',
      '| --- | --- |',
      '| attempts | 1 |',
      '',
      '### Cost by risk (estimated)',
      '',
      '| risk | tasks | estimated USD | estimated USD per task |',
      '| --- | --- | --- | --- |',
      '| high | 1 | $0.0200 | $0.0200 |',
      '| low | 1 | $0.0100 | $0.0100 |',
      '',
      '### Confidence on passed tasks',
      '',
      '| confidence | count |',
      '| --- | --- |',
      '| unknown | 1 |',
      '',
      '- Fewer than 10 tasks: the figures are descriptive only and must not change routing.',
      '',
    ].join('\n'),
  )
})

test('the hindsight table survives a tier named __proto__ and the real event shape on disk', (t) => {
  assert.equal(Object.keys(summarize([started('a', '__proto__')]).hindsight.byStart).length, 1)
  const dir = tempDir(t)
  const file = telemetryPath(dir)
  recordEvent(file, started('a', 'opus', 'low'))
  recordEvent(file, { type: 'review.done', task: 'a', tier: 'opus', role: 'reviewer', outcome: 'pass', review: { blocking: 0, discarded: 0, notes: 1, invalid: 0 } })
  recordEvent(file, { type: 'task.passed', task: 'a', tier: 'opus', role: 'reviewer', risk: 'low', costUsd: 0.5 })
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.match(result.stdout, /\| opus \| 1 \| 1 \| 0 \| - \| 0 \| 0 \|/)
  assert.match(result.stdout, /Possibly over-routed: 1 task\(s\)/)
})

test('the script prints the report for a data dir, or says there is no telemetry', (t) => {
  const dir = tempDir(t)
  const empty = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(empty.status, 0)
  assert.equal(empty.stdout, 'cc-tiers has no telemetry yet.\n')
  const missing = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'nope')], { encoding: 'utf8' })
  assert.equal(missing.stdout, 'cc-tiers has no telemetry yet.\n')
  recordEvent(telemetryPath(dir), { type: 'task.passed', task: 'a', risk: 'low', costUsd: 0.01 })
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /## cc-tiers insights/)
  assert.match(result.stdout, /1 tasks, 1 events: 1 passed/)
  const viaEnv = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: dir } })
  assert.match(viaEnv.stdout, /## cc-tiers insights/)
})
