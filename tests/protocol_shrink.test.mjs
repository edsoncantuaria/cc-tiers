import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const DEFAULTS = JSON.parse(readFileSync(path.join(ROOT, 'config', 'routing.default.json'), 'utf8'))

const routingWith = (user = {}) => tiers.mergeRouting(DEFAULTS, null, { verify: 'off', hard_start: 'opus', ...user })
const delegate = (state, routing, role, prompt) => tiers.checkDelegation(state, { subagent_type: `cc-tiers:${role}`, prompt }, routing, {})

const SPEC = [
  'CC_TIERS_SPEC_BEGIN',
  'Criteria:',
  '- the page size is 20 (request)',
  'Edge cases:',
  '- an empty list returns [] (decided: simplest)',
  'Checks:',
  '- `npm test` passes (repo: package.json)',
  'CC_TIERS_SPEC_END',
].join('\n')

const agentEvent = (id, role, text, prompt) =>
  tiers.normalizeEvent({
    session_id: 's',
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
    tool_response: { status: 'completed', content: [{ type: 'text', text }] },
  })

async function inTemp(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-shrink-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const step = (state, routing, dir, id, role, text, prompt) => tiers.applyEvent(state, tiers.prepareReport({ routing, projectDir: dir }, agentEvent(id, role, text, prompt)), routing)

const finding = ['CC_TIERS_FINDING_BEGIN', 'category: correctness', 'severity: blocking', 'evidence: trace', 'where: src/a.js:1', 'expected: 20', 'observed: 10', 'CC_TIERS_FINDING_END'].join('\n')

test('a delegation with only CC_TIERS_TASK is allowed, and its reports are counted by subagent_type', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'on' })
    const state = tiers.emptyState('s')
    const writer = `CC_TIERS_TASK: users-pagination\nCC_TIERS_RESEARCH: none - local change\nPaginate the users list.\n${SPEC}`
    assert.equal(delegate(state, routing, 'implementer', writer).deny, '')
    const done = step(state, routing, dir, 'w1', 'implementer', 'CC_TIERS_TASK: users-pagination\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done', writer)
    assert.equal(done.meta.role, 'implementer')
    assert.equal(done.meta.tier, 'sonnet')
    assert.equal(done.meta.outcome, 'review')
    const review = `CC_TIERS_TASK: users-pagination\nReview the diff.\n${SPEC}`
    assert.equal(delegate(state, routing, 'reviewer', review).deny, '')
    const rejected = step(state, routing, dir, 'r1', 'reviewer', `${finding}\nCC_TIERS_TASK: users-pagination\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: page size`, review)
    assert.equal(rejected.meta.outcome, 'retry')
    assert.equal(state.tasks['users-pagination'].tier, 'sonnet')
    assert.match(state.tasks['users-pagination'].failures[0], /^sonnet\/reviewer: /)
  }))

test('a review is charged to the tier that wrote the diff, not to its TIER header', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const text = `${finding}\nCC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: reviewer\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: page size`
    const rejected = step(state, routing, dir, 'r1', 'reviewer', text, 'CC_TIERS_TASK: users-pagination\nReview.')
    assert.equal(rejected.meta.tier, 'sonnet')
    assert.equal(state.tasks['users-pagination'].tier, 'sonnet')
    // The log knows the tier once the counter is gone: a late review of a finished task.
    const late = tiers.emptyState('s')
    late.log = { 'users-pagination': { tiers: ['haiku'], attempts: 1, failures: 0, escalations: 0, reviews: [], effort: {}, status: 'done', finished: 'haiku' } }
    const checked = step(late, routing, dir, 'c1', 'checker', 'CC_TIERS_TASK: users-pagination\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: ok', 'CC_TIERS_TASK: users-pagination\nCheck.')
    assert.equal(checked.meta.tier, 'haiku')
  }))

test('a review of a task cc-tiers never saw uses its TIER header, then the default', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const pass = (tier) => `CC_TIERS_TASK: final-gate\n${tier ? `CC_TIERS_TIER: ${tier}\n` : ''}CC_TIERS_STATUS: pass\nCC_TIERS_REASON: ok`
    assert.equal(step(tiers.emptyState('s'), routing, dir, 'r1', 'reviewer', pass('opus'), 'CC_TIERS_TASK: final-gate').meta.tier, 'opus')
    assert.equal(step(tiers.emptyState('s'), routing, dir, 'r2', 'reviewer', pass(''), 'CC_TIERS_TASK: final-gate').meta.tier, 'sonnet')
  }))

test('the refusal for a missing task asks only for CC_TIERS_TASK', () => {
  const refused = delegate(tiers.emptyState('s'), routingWith(), 'implementer', 'Paginate the users list.')
  assert.match(refused.deny, /with a CC_TIERS_TASK: <slug> line/)
  assert.doesNotMatch(refused.deny, /CC_TIERS_TIER|CC_TIERS_ROLE/)
})

test('writer and review contexts list the criterion ids as cc-tiers numbers them', () => {
  const routing = routingWith({ specify: 'on' })
  const state = tiers.emptyState('s')
  const writer = delegate(state, routing, 'implementer', `CC_TIERS_TASK: users-pagination\nCC_TIERS_RESEARCH: none - local change\nPaginate the users list.\n${SPEC}`)
  const ids = /Criterion ids for CC_TIERS_CRITERION lines, in spec order: C1 the page size is 20; C2 an empty list returns \[\]; C3 `npm test` passes\./
  assert.match(writer.input.prompt, ids)
  const review = delegate(state, routing, 'reviewer', `CC_TIERS_TASK: users-pagination\nReview the diff.\n${SPEC}`)
  assert.match(review.input.prompt, ids)
  // No spec, no ids line.
  const plain = delegate(tiers.emptyState('s'), routing, 'implementer', 'CC_TIERS_TASK: other\nCC_TIERS_RESEARCH: none - local\nCC_TIERS_SPEC: none - mechanical\nRename it.')
  assert.doesNotMatch(plain.input?.prompt || '', /Criterion ids/)
})

test('a risk keyword with only ordinary files named starts on Sonnet one level up, with high risk', () => {
  const routing = routingWith({ specify: 'off' })
  const text = (files) => `CC_TIERS_TASK: gate-env\n${files ? `CC_TIERS_FILES: ${files}\n` : ''}Refuse a leading env on the docker exec line, a security hole in the gate.`
  const derated = tiers.decideTier(text('hooks/verify.mjs, tests/verify.test.mjs'), routing)
  assert.equal(derated.tier, 'sonnet')
  assert.equal(derated.risk.level, 'high')
  assert.ok(derated.risk.factors.includes('risk keyword, no sensitive file named'))
  const plain = tiers.decideTier('CC_TIERS_TASK: gate-env\nCC_TIERS_FILES: hooks/verify.mjs\nRefuse a leading env on the docker exec line.', routing)
  assert.equal(plain.tier, 'sonnet')
  assert.ok(tiers.EFFORTS.indexOf(derated.effort) > tiers.EFFORTS.indexOf(plain.effort), `${derated.effort} > ${plain.effort}`)
  for (const files of ['', 'src/auth/login.js', '.', 'src/', 'hooks', 'hooks/verify.mjs, Makefile', 'hooks/verify.mjs, .env']) {
    const kept = tiers.decideTier(text(files), routing)
    assert.equal(kept.tier, 'opus', files || 'no files')
    assert.equal(kept.because, 'hard', files || 'no files')
  }
  // A path named in the text, with no CC_TIERS_FILES, counts as named too.
  assert.equal(tiers.decideTier('CC_TIERS_TASK: gate-env\nFix the security hole in hooks/verify.mjs.', routing).tier, 'sonnet')
  // The old waiver still waives.
  const waived = tiers.decideTier(`${text('')}\nCC_TIERS_RISK: none - the word is only a quoted log line`, routing)
  assert.equal(waived.tier, 'sonnet')
  assert.equal(tiers.keywordRisk(`${text('')}\nCC_TIERS_RISK: none - quoted`, routing), false)
})

test('a task derated by path cannot skip its Opus review', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off', review_policy: 'cheap' })
    const state = tiers.emptyState('s')
    const prompt = 'CC_TIERS_TASK: gate-env\nCC_TIERS_FILES: hooks/verify.mjs\nCC_TIERS_RESEARCH: none - local\nRefuse a leading env on the docker exec line, a security hole.'
    assert.equal(delegate(state, routing, 'implementer', prompt).deny, '')
    const done = step(state, routing, dir, 'w1', 'implementer', 'CC_TIERS_TASK: gate-env\nCC_TIERS_REVIEW: skip\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done', prompt)
    assert.equal(done.meta.outcome, 'review')
    assert.match(done.message, /cc-tiers:reviewer \(Opus\)/)
    assert.match(done.message, /Review cannot be skipped: it matches an Opus review keyword, so its review cannot be skipped/)
  }))

test("a review of the session's own Opus attempt, still waiting for its gate, is charged to opus without a TIER header", () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off', verify: 'on' })
    const state = tiers.emptyState('s')
    state.awaiting = [{ id: 'transcript:1', role: 'orchestrator', text: 'CC_TIERS_TASK: gate-env\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done' }]
    const text = `${finding}\nCC_TIERS_TASK: gate-env\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: page size`
    const rejected = step(state, routing, dir, 'r1', 'reviewer', text, 'CC_TIERS_TASK: gate-env\nReview.')
    assert.equal(rejected.meta.tier, 'opus')
    assert.match(state.tasks['gate-env'].failures[0], /^opus\/reviewer: /)
    // Another task's parked attempt does not decide this one.
    const other = step(state, routing, dir, 'r2', 'reviewer', text.replaceAll('gate-env', 'users-pagination'), 'CC_TIERS_TASK: users-pagination\nReview.')
    assert.equal(other.meta.tier, 'sonnet')
  }))

test('a review that rejects the session attempt parked for Stop keeps its rejection when that parked report is counted', () =>
  inTemp(async (dir) => {
    // Verify off here: the parking is set by hand, and the gate is not what this test checks.
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const own = 'CC_TIERS_TASK: gate-env\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done'
    state.awaiting = [{ id: 'transcript:1', role: 'orchestrator', text: own }]
    const rejected = step(state, routing, dir, 'r1', 'reviewer', `${finding}\nCC_TIERS_TASK: gate-env\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: page size`, 'CC_TIERS_TASK: gate-env\nReview.')
    assert.equal(rejected.meta.outcome, 'retry')
    assert.deepEqual(state.tasks['gate-env'].judged, ['transcript:1'])
    // Stop counts the parked pass: it is the attempt the review judged, not a new one.
    const parked = tiers.applyEvent(state, tiers.prepareReport({ routing, projectDir: dir }, { kind: 'report', id: 'transcript:1', role: 'orchestrator', prompt: '', text: own }), routing)
    tiers.dropAwaiting(state, ['transcript:1'])
    assert.equal(parked.meta.outcome, 'retry')
    assert.equal(parked.meta.stillRejected, true)
    assert.match(parked.message, /its review already rejected this opus attempt/)
    assert.equal(state.tasks['gate-env'].rejected, true)
    assert.equal(state.tasks['gate-env'].failures.length, 1)
    const slice = step(state, routing, dir, 'r2', 'reviewer', 'CC_TIERS_TASK: gate-env\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: ok', 'CC_TIERS_TASK: gate-env\nReview.')
    assert.equal(slice.meta.outcome, 'retry', 'another review of the rejected attempt does not finish it')
    // The next session attempt is new: it clears the rejection and goes to review.
    const next = tiers.applyEvent(state, tiers.prepareReport({ routing, projectDir: dir }, { kind: 'report', id: 'transcript:2', role: 'orchestrator', prompt: '', text: own }), routing)
    assert.equal(next.meta.outcome, 'review')
    assert.equal(state.tasks['gate-env'].rejected, undefined)
    assert.equal(state.tasks['gate-env'].judged, undefined)
  }))
