import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = await import(pathToFileURL(path.join(ROOT, 'hooks', 'contract.mjs')).href)
const verify = await import(pathToFileURL(path.join(ROOT, 'hooks', 'verify.mjs')).href)

const SPEC = `Criteria:
- Parser returns the criteria (request)
- Ids follow the order (repo: hooks/verify.mjs:240-246)
**Preserve:**
- parseVerify keeps working (user)
## Checks
1. \`node --test tests/\` passes (decided: no shell)
Security:
- No shell is spawned
Evidence:
- The gate output is shown
EDGE CASES:
- Empty spec gives no criteria
Assumed:
- Node 18 or newer
Ambiguous:
- Is na mandatory?`

const gate = (extra = {}) => ({ status: 'pass', verified: ['node --test tests/x.test.mjs'], flaky: [], unverified: [], ...extra })

/** Criteria already evaluated: the ids in pass are evidenced, the others take the given state. */
function evaluated(states) {
  return states.map((state, i) => ({
    id: `C${i + 1}`,
    kind: 'functional',
    text: `criterion ${i + 1}`,
    origin: '',
    mandatory: true,
    check: '',
    state: state === 'pass' ? 'pass' : state,
    evidenced: state === 'pass',
    evidence: '',
  }))
}

test('exports the kinds and states', () => {
  assert.deepEqual(contract.CRITERION_STATES, ['pending', 'pass', 'fail', 'unverifiable', 'na'])
  assert.deepEqual(contract.CRITERION_KINDS, ['functional', 'preserve', 'check', 'security', 'evidence', 'edge'])
})

test('parseContract reads every heading into its kind, with ids over criteria only', () => {
  const parsed = contract.parseContract(SPEC)
  assert.deepEqual(
    parsed.criteria.map((c) => [c.id, c.kind]),
    [['C1', 'functional'], ['C2', 'functional'], ['C3', 'preserve'], ['C4', 'check'], ['C5', 'security'], ['C6', 'evidence'], ['C7', 'edge']],
  )
  assert.ok(parsed.criteria.every((c) => c.mandatory))
  assert.deepEqual(parsed.assumptions, ['Node 18 or newer'])
  assert.deepEqual(parsed.ambiguities, ['Is na mandatory?'])
})

test('parseContract extracts text, origin and the first backticked check', () => {
  const [first, second, , check, security] = contract.parseContract(SPEC).criteria
  assert.equal(first.text, 'Parser returns the criteria')
  assert.equal(first.origin, 'request')
  assert.equal(second.origin, 'repo: hooks/verify.mjs:240-246')
  assert.equal(check.origin, 'decided: no shell')
  assert.equal(check.check, 'node --test tests/')
  assert.equal(security.origin, '')
  assert.equal(first.check, '')
})

test('parseContract takes the check only from a check-kind line and the first backticks', () => {
  const parsed = contract.parseContract('Criteria:\n- run `npm test`\nChecks:\n- `a b` then `c`\n- no command here')
  assert.equal(parsed.criteria[0].check, '')
  assert.equal(parsed.criteria[1].check, 'a b')
  assert.equal(parsed.criteria[2].check, '')
})

test('parseContract treats lines before any heading as functional and accepts an origin with a reason', () => {
  const parsed = contract.parseContract('- loose line (request: um agente posterior não pode enfraquecer)\nPreserve:\n- keep it')
  assert.equal(parsed.criteria[0].kind, 'functional')
  assert.equal(parsed.criteria[0].text, 'loose line')
  assert.equal(parsed.criteria[0].origin, 'request: um agente posterior não pode enfraquecer')
  assert.equal(parsed.criteria[1].kind, 'preserve')
})

test('parseContract ignores bare bullets, lone origin tags and blank lines', () => {
  const parsed = contract.parseContract('Criteria:\n-\n*\n1.\n(request)\n- (user)\n\n- real one')
  assert.deepEqual(parsed.criteria.map((c) => c.text), ['real one'])
  assert.equal(parsed.criteria[0].id, 'C1')
})

test('parseContract ignores a line that is only an origin tag with a reason', () => {
  const parsed = contract.parseContract('Criteria:\n- (request: um agente posterior)\n(user: porque sim)\n- (repo: a.mjs:1)\n- (decided: x)\n- (docs: y)\n- real')
  assert.deepEqual(parsed.criteria.map((c) => [c.id, c.text]), [['C1', 'real']])
})

test('parseContract of empty text has no criteria', () => {
  for (const text of ['', undefined, null, '  \n ']) {
    assert.deepEqual(contract.parseContract(text), { criteria: [], assumptions: [], ambiguities: [] })
  }
})

test('criterionKey folds case, accents, bullet, origin tag and spacing', () => {
  assert.equal(contract.criterionKey('- Migração   FEITA (request)'), 'migracao feita')
  assert.equal(contract.criterionKey('2. migracao feita (repo: a.mjs:1)'), 'migracao feita')
  assert.equal(contract.criterionKey(undefined), '')
})

test('criterionKey is the one verify.mjs exports, including the origin tag with a reason', () => {
  assert.equal(contract.criterionKey, verify.criterionKey)
  assert.equal(contract.criterionKey('- Keep it (request: um agente posterior)'), 'keep it')
  assert.equal(contract.criterionKey('- Keep it (user: porque sim)'), 'keep it')
  const previous = contract.parseContract('Criteria:\n- Keep it (request: um agente posterior)')
  assert.deepEqual(contract.weakenedCriteria(previous, contract.parseContract('Criteria:\n- keep it')), [])
})

test('weakenedCriteria returns dropped and reworded mandatory criteria only', () => {
  const previous = contract.parseContract('Criteria:\n- Keep A (request)\n- Keep B\n- Keep C')
  const same = contract.parseContract('Criteria:\n- keep a\n- Keep B (user)\n- Keep C\n- New D')
  assert.deepEqual(contract.weakenedCriteria(previous, same), [])
  const weaker = contract.parseContract('Criteria:\n- Keep A\n- Keep B when convenient')
  assert.deepEqual(contract.weakenedCriteria(previous, weaker).map((c) => c.id), ['C2', 'C3'])
  assert.deepEqual(contract.weakenedCriteria(previous, contract.parseContract('')).length, 3)
  assert.deepEqual(contract.weakenedCriteria(contract.parseContract(''), same), [])
})

test('parseCriterionReports reads the four states, case-insensitive ids, last line wins', () => {
  const text = [
    'CC_TIERS_CRITERION: C1 pass - npm test passes',
    'CC_TIERS_CRITERION: c2 fail - broke',
    'CC_TIERS_CRITERION: C3 unverifiable - needs a device',
    'CC_TIERS_CRITERION: C4 na - not applicable here',
    'CC_TIERS_CRITERION: C1 fail - on second thought',
    'CC_TIERS_CRITERION: C5 PASS',
  ].join('\n')
  assert.deepEqual(contract.parseCriterionReports(text), [
    { id: 'C1', state: 'fail', evidence: 'on second thought' },
    { id: 'C2', state: 'fail', evidence: 'broke' },
    { id: 'C3', state: 'unverifiable', evidence: 'needs a device' },
    { id: 'C4', state: 'na', evidence: 'not applicable here' },
    { id: 'C5', state: 'pass', evidence: '' },
  ])
})

test('parseCriterionReports ignores na and unverifiable without a reason, and bad lines', () => {
  const text = 'CC_TIERS_CRITERION: C1 na\nCC_TIERS_CRITERION: C2 unverifiable -\nCC_TIERS_CRITERION: C3 maybe - x\nCC_TIERS_CRITERION: pass\nnoise'
  assert.deepEqual(contract.parseCriterionReports(text), [])
  assert.deepEqual(contract.parseCriterionReports(undefined), [])
  const kept = contract.parseCriterionReports('CC_TIERS_CRITERION: C1 na - real reason\nCC_TIERS_CRITERION: C1 na')
  assert.deepEqual(kept, [{ id: 'C1', state: 'na', evidence: 'real reason' }])
})

test('evaluateCriteria: a check is evidenced only by a verified command equal to it after whitespace normalization', () => {
  const parsed = contract.parseContract('Checks:\n- `node --test tests/a.test.mjs`\n- `node  --test   tests/b.test.mjs`\n- `node --test`\n- `npm run lint`')
  const verified = ['node --test tests/a.test.mjs', 'node --test  tests/b.test.mjs']
  const out = contract.evaluateCriteria(parsed, { verified })
  assert.deepEqual(out.map((c) => [c.state, c.evidenced]), [['pass', true], ['pass', true], ['pending', false], ['pending', false]])
  assert.equal(out[0].evidence, 'node --test tests/a.test.mjs')
  assert.equal(out[1].evidence, 'node --test  tests/b.test.mjs')
})

test('evaluateCriteria: a verified command that adds arguments does not evidence the check', () => {
  const parsed = contract.parseContract('Checks:\n- `npm test`\n- `node --test`')
  const verified = ['npm test -- --grep nothing-matches', 'node --test tests/a.test.mjs']
  const out = contract.evaluateCriteria(parsed, { verified })
  assert.deepEqual(out.map((c) => [c.state, c.evidenced]), [['pending', false], ['pending', false]])
})

test('evaluateCriteria: a declared pass is evidenced only with a verified command in the evidence or a passed review', () => {
  const parsed = contract.parseContract('Criteria:\n- one\n- two\n- three')
  const reports = [
    { id: 'C1', state: 'pass', evidence: 'ran node --test tests/a.test.mjs and it is green' },
    { id: 'C2', state: 'pass', evidence: 'looks right to me' },
  ]
  const verified = ['node --test tests/a.test.mjs']
  const out = contract.evaluateCriteria(parsed, { reports, verified })
  assert.deepEqual(out.map((c) => [c.state, c.evidenced, c.evidence]), [
    ['pass', true, 'node --test tests/a.test.mjs'],
    ['pass', false, 'declared'],
    ['pending', false, ''],
  ])
  const reviewed = contract.evaluateCriteria(parsed, { reports, verified, reviewPassed: true })
  assert.deepEqual(reviewed.map((c) => [c.state, c.evidenced, c.evidence]), [
    ['pass', true, 'node --test tests/a.test.mjs'],
    ['pass', true, 'looks right to me'],
    ['pending', false, ''],
  ])
})

test('evaluateCriteria: a pass names the verified command only as whole tokens', () => {
  const parsed = contract.parseContract('Criteria:\n- a\n- b\n- c\n- d\n- e\n- f')
  const report = (id, evidence) => ({ id, state: 'pass', evidence })
  const reports = [
    report('C1', 'npm tests were not run'),
    report('C2', 'xnpm test is a different command'),
    report('C3', 'ran `npm test`'),
    report('C4', 'npm test.'),
    report('C5', '"npm test" is green'),
    report('C6', 'npm  test: green'),
  ]
  const out = contract.evaluateCriteria(parsed, { reports, verified: ['npm test'] })
  assert.deepEqual(out.map((c) => [c.evidenced, c.evidence]), [
    [false, 'declared'],
    [false, 'declared'],
    [true, 'npm test'],
    [true, 'npm test'],
    [true, 'npm test'],
    [true, 'npm test'],
  ])
})

test('evaluateCriteria: fail, unverifiable and na reports keep their reason', () => {
  const parsed = contract.parseContract('Criteria:\n- a\n- b\n- c')
  const reports = [
    { id: 'C1', state: 'fail', evidence: 'broke' },
    { id: 'C2', state: 'unverifiable', evidence: 'needs a device' },
    { id: 'C3', state: 'na', evidence: 'not here' },
  ]
  const out = contract.evaluateCriteria(parsed, { reports })
  assert.deepEqual(out.map((c) => [c.state, c.evidenced, c.evidence]), [
    ['fail', false, 'broke'],
    ['unverifiable', false, 'needs a device'],
    ['na', false, 'not here'],
  ])
})

test('evaluateCriteria: a reviewer coverage finding fails the criterion whatever the report says', () => {
  const parsed = contract.parseContract('Checks:\n- `npm test` passes (request)\nCriteria:\n- Other (user)')
  const reports = [{ id: 'C1', state: 'pass', evidence: 'npm test' }, { id: 'C2', state: 'pass', evidence: 'ok' }]
  const out = contract.evaluateCriteria(parsed, { reports, verified: ['npm test'], reviewPassed: true, failedCriteria: ['- `npm test` passes (request)'] })
  assert.equal(out[0].state, 'fail')
  assert.equal(out[0].evidenced, false)
  assert.equal(out[1].state, 'pass')
})

test('evaluateCriteria: a declared fail beats a matching verified check', () => {
  const parsed = contract.parseContract('Checks:\n- `npm test`')
  const out = contract.evaluateCriteria(parsed, { reports: [{ id: 'C1', state: 'fail', evidence: 'flaky in CI' }], verified: ['npm test'] })
  assert.equal(out[0].state, 'fail')
})

test('evaluateCriteria of an empty contract is empty', () => {
  assert.deepEqual(contract.evaluateCriteria(contract.parseContract('')), [])
})

test('completion: verified with the gate passed and every criterion evidenced', () => {
  const done = contract.completion({ criteria: evaluated(['pass', 'pass']), gate: gate() })
  assert.equal(done.status, 'verified')
  assert.equal(done.implemented, true)
  assert.deepEqual(done.checks, { run: 1, passed: 1, failed: 0, notRun: 0, flaky: 0 })
  assert.deepEqual(done.criteria, { total: 2, evidenced: 2, pending: [], failed: [], unverifiable: [], na: [] })
  assert.deepEqual(done.remaining, [])
  assert.equal(done.confidence.level, 'high')
  assert.deepEqual(done.confidence.reasons, ['gate verified 1 command'])
})

test('completion: na counts as satisfied only once a review accepted it; pending blocks verified', () => {
  const accepted = evaluated(['pass', 'na']).map((c) => (c.state === 'na' ? { ...c, evidenced: true } : c))
  assert.equal(contract.completion({ criteria: accepted, gate: gate() }).status, 'verified')
  const declared = contract.completion({ criteria: evaluated(['pass', 'na']), gate: gate() })
  assert.equal(declared.status, 'partial')
  assert.ok(declared.confidence.reasons.includes('criterion C2 n/a only as declared'))
  assert.match(declared.remaining.join('\n'), /C2 declared n\/a/)
  const partial = contract.completion({ criteria: evaluated(['pass', 'pending']), gate: gate() })
  assert.equal(partial.status, 'partial')
  assert.deepEqual(partial.criteria.pending, ['C2'])
  assert.deepEqual(partial.remaining, ['criterion C2 pending'])
  assert.equal(partial.confidence.level, 'moderate')
  assert.ok(partial.confidence.reasons.includes('criterion C2 pending'))
})

test('completion: strictFrom lets a low risk task verify with pending criteria', () => {
  const criteria = evaluated(['pending'])
  assert.equal(contract.completion({ criteria, risk: 'low', gate: gate() }).status, 'verified')
  assert.equal(contract.completion({ criteria, risk: 'low', gate: gate(), strictFrom: 'low' }).status, 'partial')
  assert.equal(contract.completion({ criteria, risk: 'medium', gate: gate(), strictFrom: 'high' }).status, 'verified')
})

test('completion: high and critical risk need a passed review to be verified', () => {
  const criteria = evaluated(['pass'])
  for (const risk of ['high', 'critical']) {
    const without = contract.completion({ criteria, risk, gate: gate(), review: 'pending' })
    assert.equal(without.status, 'partial')
    assert.ok(without.remaining.includes('no independent review'))
    assert.equal(contract.completion({ criteria, risk, gate: gate(), review: 'pass' }).status, 'verified')
  }
  assert.equal(contract.completion({ criteria, risk: 'medium', gate: gate() }).status, 'verified')
})

test('completion: a failed gate, a failed review or a failed criterion is failed with low confidence', () => {
  const failedGate = contract.completion({ criteria: evaluated(['pass']), gate: gate({ status: 'fail', failure: { raw: 'x' } }) })
  assert.equal(failedGate.status, 'failed')
  assert.equal(failedGate.checks.failed, 1)
  assert.equal(failedGate.checks.run, 2)
  assert.ok(failedGate.confidence.reasons.includes('gate failed'))
  const failedReview = contract.completion({ criteria: evaluated(['pass']), gate: gate(), review: 'fail' })
  assert.equal(failedReview.status, 'failed')
  assert.ok(failedReview.confidence.reasons.includes('review failed'))
  for (const result of [failedGate, failedReview]) assert.equal(result.confidence.level, 'low')
})

test('completion: three evidenced passes plus one fail is still failed', () => {
  const done = contract.completion({ criteria: evaluated(['pass', 'pass', 'pass', 'fail']), gate: gate(), review: 'pass', risk: 'high' })
  assert.equal(done.status, 'failed')
  assert.deepEqual(done.criteria.failed, ['C4'])
  assert.equal(done.criteria.evidenced, 3)
  assert.equal(done.confidence.level, 'low')
  assert.ok(done.confidence.reasons.includes('criterion C4 failed'))
})

test('completion: partial from an evidenced criterion alone, unverified with nothing', () => {
  const alone = contract.completion({ criteria: evaluated(['pass']) })
  assert.equal(alone.status, 'partial')
  assert.equal(alone.confidence.level, 'moderate')
  const nothing = contract.completion({ criteria: evaluated(['pending']) })
  assert.equal(nothing.status, 'unverified')
  assert.equal(nothing.confidence.level, 'low')
  assert.ok(nothing.confidence.reasons.includes('no verified command'))
  const declared = contract.completion({ criteria: [{ ...evaluated(['pass'])[0], evidenced: false }] })
  assert.equal(declared.status, 'unverified')
})

test('completion: flaky commands count as verified but lower the confidence', () => {
  const flakyOnly = contract.completion({ criteria: [], gate: { status: 'pass', verified: [], flaky: ['npm test'], unverified: [] } })
  assert.equal(flakyOnly.status, 'verified')
  assert.deepEqual(flakyOnly.checks, { run: 1, passed: 1, failed: 0, notRun: 0, flaky: 1 })
  const both = contract.completion({ criteria: [], gate: gate({ verified: ['npm test', 'npm lint'], flaky: ['npm test'] }) })
  assert.equal(both.checks.passed, 2)
  assert.equal(both.confidence.level, 'moderate')
  assert.ok(both.confidence.reasons.includes('1 flaky command'))
  assert.ok(both.confidence.reasons.includes('gate verified 2 commands'))
})

test('completion: an unverifiable criterion blocks verified and caps confidence at moderate', () => {
  const done = contract.completion({ criteria: [...evaluated(['pass']), { ...evaluated(['unverifiable'])[0], id: 'C2', evidence: 'needs a device' }], gate: gate(), risk: 'low' })
  assert.equal(done.status, 'verified')
  assert.equal(done.confidence.level, 'moderate')
  assert.deepEqual(done.remaining, ['criterion C2 unverifiable: needs a device'])
  const strict = contract.completion({ criteria: [...evaluated(['pass']), { ...evaluated(['unverifiable'])[0], id: 'C2' }], gate: gate() })
  assert.equal(strict.status, 'partial')
  assert.deepEqual(strict.criteria.unverifiable, ['C2'])
})

test('completion: critical risk without a passed review is low confidence', () => {
  const done = contract.completion({ criteria: evaluated(['pass']), gate: gate(), risk: 'critical', review: 'skipped' })
  assert.equal(done.confidence.level, 'low')
  assert.ok(done.confidence.reasons.includes('critical risk without review'))
  const reviewed = contract.completion({ criteria: evaluated(['pass']), gate: gate(), risk: 'critical', review: 'pass' })
  assert.equal(reviewed.status, 'verified')
  assert.equal(reviewed.confidence.level, 'high')
})

test('completion: unverified command reasons are remaining', () => {
  const done = contract.completion({ criteria: [], gate: gate({ unverified: [{ raw: 'make', reason: 'outside verify_allow: make' }] }) })
  assert.deepEqual(done.remaining, ['outside verify_allow: make'])
  assert.equal(done.checks.notRun, 1)
})

test('completion: no criteria depends on the gate alone', () => {
  assert.equal(contract.completion({ criteria: [], gate: gate() }).status, 'verified')
  assert.equal(contract.completion({ criteria: [] }).status, 'unverified')
  assert.equal(contract.completion({ criteria: [], gate: gate({ status: 'fail' }) }).status, 'failed')
  assert.deepEqual(contract.completion({ criteria: [] }).criteria, { total: 0, evidenced: 0, pending: [], failed: [], unverifiable: [], na: [] })
})

test('completion: a gate that passed with no listed command still verifies', () => {
  const done = contract.completion({ criteria: [], gate: { status: 'pass', verified: [], flaky: [], unverified: [] } })
  assert.equal(done.status, 'verified')
  assert.deepEqual(done.confidence.reasons, ['gate passed'])
})

test('a writer cannot reach verified by declaring every criterion n/a', () => {
  const spec = contract.parseContract('Criteria:\n- Tokens are rotated')
  const reports = contract.parseCriterionReports('CC_TIERS_CRITERION: C1 na - n/a')
  const alone = contract.evaluateCriteria(spec, { reports, verified: ['npm test'] })
  assert.equal(alone[0].evidenced, false)
  const result = contract.completion({ criteria: alone, gate: { status: 'pass', verified: ['npm test'], flaky: [], unverified: [] } })
  assert.notEqual(result.status, 'verified')
  assert.notEqual(result.confidence.level, 'high')
  const reviewed = contract.evaluateCriteria(spec, { reports, verified: ['npm test'], reviewPassed: true })
  assert.equal(contract.completion({ criteria: reviewed, gate: { status: 'pass', verified: ['npm test'], flaky: [], unverified: [] }, review: 'pass' }).status, 'verified')
})

test('a check criterion is evidenced only by its own command, never by another command or a review', () => {
  const spec = contract.parseContract('Checks:\n- `npm run lint` passes')
  const other = contract.evaluateCriteria(spec, { reports: [{ id: 'C1', state: 'pass', evidence: 'npm test' }], verified: ['npm test'] })
  assert.equal(other[0].evidenced, false)
  const reviewed = contract.evaluateCriteria(spec, { reports: [{ id: 'C1', state: 'pass', evidence: 'fine' }], verified: ['npm test'], reviewPassed: true })
  assert.equal(reviewed[0].evidenced, false)
  assert.match(reviewed[0].evidence, /npm run lint` did not run/)
  assert.equal(contract.evaluateCriteria(spec, { verified: ['npm run lint'] })[0].evidenced, true)
})

test('at low risk a declared n/a never verifies, and a pending criterion keeps confidence below high', () => {
  const spec = contract.parseContract('Criteria:\n- Tokens are rotated')
  const passGate = { status: 'pass', verified: ['npm test'], flaky: [], unverified: [] }
  const na = contract.evaluateCriteria(spec, { reports: contract.parseCriterionReports('CC_TIERS_CRITERION: C1 na - n/a'), verified: ['npm test'] })
  const declared = contract.completion({ criteria: na, risk: 'low', gate: passGate })
  assert.notEqual(declared.status, 'verified')
  assert.notEqual(declared.confidence.level, 'high')
  const pending = contract.completion({ criteria: contract.evaluateCriteria(spec, { verified: ['npm test'] }), risk: 'low', gate: passGate })
  assert.equal(pending.status, 'verified', 'low risk may conclude on light checks')
  assert.equal(pending.confidence.level, 'moderate')
  assert.ok(pending.confidence.reasons.includes('criterion C1 pending'))
})

test('a pass only the writer declared keeps confidence below high and is listed, at any risk', () => {
  const passGate = { status: 'pass', verified: ['npm test'], flaky: [], unverified: [] }
  const plain = contract.parseContract('Criteria:\n- Tokens are rotated')
  const declared = contract.evaluateCriteria(plain, { reports: [{ id: 'C1', state: 'pass', evidence: 'looks right' }], verified: ['npm test'] })
  for (const risk of ['low', 'medium']) {
    const result = contract.completion({ criteria: declared, risk, gate: passGate })
    assert.notEqual(result.confidence.level, 'high', risk)
    assert.ok(result.confidence.reasons.includes('criterion C1 passed only as declared'), risk)
    assert.match(result.remaining.join('\n'), /C1 passed only as declared/, risk)
  }
  const check = contract.parseContract('Checks:\n- `npm run lint` passes')
  const unrun = contract.evaluateCriteria(check, { reports: [{ id: 'C1', state: 'pass', evidence: 'fine' }], verified: ['npm test'], reviewPassed: true })
  const result = contract.completion({ criteria: unrun, risk: 'low', gate: passGate, review: 'pass' })
  assert.notEqual(result.confidence.level, 'high')
  assert.match(result.remaining.join('\n'), /npm run lint` did not run/)
})
