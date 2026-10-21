import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { FAILURE_CATEGORIES, diagnoseFailure, nextAction } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'diagnose.mjs')).href)

const fromDetail = (detail) => diagnoseFailure({ detail })
const fromReason = (reason) => diagnoseFailure({ reason })

test('exports the fourteen categories', () => {
  assert.equal(FAILURE_CATEGORIES.length, 14)
  assert.equal(FAILURE_CATEGORIES.at(-1), 'unknown')
})

const DETAIL_CASES = [
  ['syntax', 'SyntaxError: Unexpected end of input'],
  ['syntax', 'Unexpected token }'],
  ['syntax', 'PHP Parse error: syntax error, unexpected "}"'],
  ['syntax', 'ParseError in file'],
  ['type', 'src/a.ts(3,1): error TS2322: Type string is not assignable to type number'],
  ['type', "TypeError: 'x' is not assignable to parameter"],
  ['type', 'mypy: Incompatible types'],
  ['type', 'phpstan level 6: 3 errors'],
  ['type', 'a type error in the call'],
  ['dependency', "Error: Cannot find module 'left-pad'"],
  ['dependency', "ModuleNotFoundError: No module named 'yaml'"],
  ['dependency', 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package'],
  ['dependency', 'zsh: command not found: phpunit'],
  ['dependency', 'Error: spawn phpunit ENOENT'],
  ['docs-version', 'TypeError: fs.cpSync is not a function'],
  ['docs-version', "Module './x' has no exported member 'y'"],
  ['docs-version', 'DeprecationWarning: deprecated since 3.0'],
  ['docs-version', 'NoMethodError: no such method foo'],
  ['docs-version', 'error: unknown option --frobnicate'],
  ['docs-version', 'Call to undefined method Foo::bar()'],
  ['infra', 'Error: connect ECONNREFUSED 127.0.0.1:5432'],
  ['infra', 'getaddrinfo ENOTFOUND registry.npmjs.org'],
  ['infra', 'Error: listen EADDRINUSE :::3000'],
  ['infra', 'read ETIMEDOUT'],
  ['infra', 'getaddrinfo EAI_AGAIN registry.npmjs.org'],
  ['infra', 'ENOSPC: no space left on device'],
  ['infra', 'FATAL ERROR: JavaScript heap out of memory'],
  ['infra', 'Cannot connect to the Docker daemon'],
  ['flaky', 'test is flaky, passed on retry'],
  ['regression', 'regression: login test now fails'],
  ['regression', 'previously passing test'],
  ['regression', 'this broke existing behavior'],
  ['test', 'AssertionError [ERR_ASSERTION]: expected 1 to equal 2'],
  ['test', 'expected true to be false'],
  ['test', 'not ok 3 - parses the line'],
  ['test', 'FAIL tests/a.test.mjs'],
  ['test', '2 tests failing'],
  ['architecture', 'circular dependency between a and b'],
  ['architecture', 'tight coupling in the layering'],
  ['requirement', 'did not meet the acceptance criterion'],
  ['requirement', 'misunderstood the spec'],
  ['integration', 'contract mismatch with the billing service'],
  ['integration', 'server answered with a 404 response'],
  ['integration', 'schema mismatch on the payload'],
  ['security', 'possible SQL injection'],
  ['security', 'XSS in the template'],
  ['security', 'CSRF token missing'],
  ['security', 'secret leak in the log'],
  ['security', 'data exposure through the endpoint'],
  ['scope', 'edit is out of scope'],
  ['scope', 'touches an unrelated file'],
  ['unknown', 'something odd happened'],
]

for (const [category, detail] of DETAIL_CASES) {
  test(`detail "${detail}" is ${category}, confirmed`, () => {
    const diagnosis = fromDetail(detail)
    assert.equal(diagnosis.category, category)
    assert.equal(diagnosis.confirmed, category !== 'unknown')
  })
}

// Prose that names an environment fault: a hypothesis in a reason, never confirmed from a detail.
const PROSE_CASES = [
  ['dependency', 'package not found: foo'],
  ['dependency', 'Módulo não encontrado: yaml'],
  ['infra', 'API error: rate limit exceeded'],
  ['infra', 'upstream returned HTTP 503'],
  ['infra', 'got a 5xx from the server'],
  ['infra', 'Anthropic API overloaded'],
  ['infra', 'the job ran out of memory'],
]

test('the same text as a reason is a hypothesis', () => {
  for (const [category, text] of [...DETAIL_CASES, ...PROSE_CASES].filter(([category]) => category !== 'unknown')) {
    const diagnosis = fromReason(text)
    assert.equal(diagnosis.category, category)
    assert.equal(diagnosis.confirmed, false)
  }
})

test('prose about the environment in a detail is not confirmed', () => {
  for (const [, text] of PROSE_CASES) {
    const diagnosis = fromDetail(text)
    assert.equal(diagnosis.category, 'unknown', text)
    assert.equal(diagnosis.confirmed, false, text)
  }
})

test('detail outranks the reason', () => {
  const diagnosis = diagnoseFailure({ reason: 'tests are failing', detail: 'SyntaxError: bad' })
  assert.equal(diagnosis.category, 'syntax')
  assert.equal(diagnosis.confirmed, true)
})

test('an unmatched detail falls back to the reason as a hypothesis', () => {
  const diagnosis = diagnoseFailure({ reason: 'misunderstood the spec', detail: 'done in 2s' })
  assert.equal(diagnosis.category, 'requirement')
  assert.equal(diagnosis.confirmed, false)
})

test('syntax wins over a test failure in the same output', () => {
  const diagnosis = fromDetail('AssertionError: expected 1 to equal 2\nSyntaxError: Unexpected token')
  assert.equal(diagnosis.category, 'syntax')
})

test('Portuguese text folds accents', () => {
  assert.equal(fromDetail('Erro de sintaxe na linha 3').category, 'syntax')
  assert.equal(fromReason('Módulo não encontrado: yaml').category, 'dependency')
  assert.equal(fromReason('limite de taxa: rate limit atingido').category, 'infra')
  assert.equal(fromDetail('o teste falhou').category, 'test')
  assert.equal(fromReason('Regressão no login').category, 'regression')
})

const REVIEW_CASES = [
  ['regression', 'regression'],
  ['compatibility', 'regression'],
  ['security', 'security'],
  ['access-control', 'security'],
  ['input-validation', 'security'],
  ['data-exposure', 'security'],
  ['scope', 'scope'],
  ['api-usage', 'docs-version'],
  ['correctness', 'test'],
  ['error-handling', 'test'],
  ['concurrency', 'test'],
  ['state', 'test'],
]

for (const [reviewCategory, category] of REVIEW_CASES) {
  test(`review category ${reviewCategory} is ${category}, confirmed`, () => {
    const diagnosis = diagnoseFailure({ source: 'review', reviewCategory, reason: 'the reviewer disagrees' })
    assert.equal(diagnosis.category, category)
    assert.equal(diagnosis.confirmed, true)
  })
}

test('concurrency and state become architecture when the reason names design words', () => {
  for (const reviewCategory of ['concurrency', 'state']) {
    const diagnosis = diagnoseFailure({ source: 'review', reviewCategory, reason: 'shared state shows a coupling problem' })
    assert.equal(diagnosis.category, 'architecture')
    assert.equal(diagnosis.confirmed, true)
  }
})

test('the reviewer category outranks text guessing', () => {
  const diagnosis = diagnoseFailure({ source: 'review', reviewCategory: 'security', reason: 'assertion failing', detail: 'FAIL' })
  assert.equal(diagnosis.category, 'security')
})

test('an unknown review category falls back to the text', () => {
  const diagnosis = diagnoseFailure({ source: 'review', reviewCategory: 'style', reason: 'misunderstood the spec' })
  assert.equal(diagnosis.category, 'requirement')
  assert.equal(diagnosis.confirmed, false)
})

test('review category is ignored outside a review', () => {
  const diagnosis = diagnoseFailure({ source: 'gate', reviewCategory: 'security', detail: 'FAIL a.test.mjs' })
  assert.equal(diagnosis.category, 'test')
})

test('symptom is the first line that matched, else the first meaningful line, cut at 160 chars', () => {
  assert.equal(fromDetail(`\n  \n${'x'.repeat(200)}\nFAIL a.test.mjs`).symptom, 'FAIL a.test.mjs')
  assert.equal(fromDetail(`\n  \n${'x'.repeat(200)}\nnothing here`).symptom, 'x'.repeat(160))
  assert.equal(fromDetail(`not ok ${'y'.repeat(200)}`).symptom, `not ok ${'y'.repeat(153)}`)
  assert.equal(fromReason('only a reason').symptom, 'only a reason')
  assert.equal(diagnoseFailure({ reason: 'tests broke\nmisunderstood the spec', detail: 'done in 2s' }).symptom, 'misunderstood the spec')
})

test('the symptom skips TAP noise when no line matched', () => {
  const tap = 'TAP version 13\n# Subtest: parses\nok 1 - parses\n1..1\n\nsomething odd happened'
  assert.equal(fromDetail(tap).symptom, 'something odd happened')
  assert.equal(fromDetail('TAP version 13\n1..0').symptom, '')
})

test('evidence holds up to three matching detail lines, at most 300 chars', () => {
  const lines = ['ok 1', 'not ok 2 - a', 'not ok 3 - b', 'not ok 4 - c', 'not ok 5 - d']
  assert.equal(fromDetail(lines.join('\n')).evidence, 'not ok 2 - a\nnot ok 3 - b\nnot ok 4 - c')
  assert.equal(fromDetail(`not ok ${'y'.repeat(400)}`).evidence.length, 300)
  assert.equal(fromReason('tests are failing').evidence, '')
})

test('hypothesis is one sentence per category', () => {
  for (const [, detail] of DETAIL_CASES) {
    const { hypothesis } = fromDetail(detail)
    assert.ok(hypothesis.endsWith('.') && !hypothesis.slice(0, -1).includes('. '))
  }
})

test('signature ignores digits, quoted strings and paths', () => {
  const a = fromDetail("Error: Cannot find module 'left-pad' in /home/a/src/x.mjs:12:5")
  const b = fromDetail('Error: Cannot find module "right-pad" in /tmp/b/lib/y.mjs:99:1')
  assert.equal(a.signature, b.signature)
  assert.match(a.signature, /^dependency:/)
  assert.equal(fromDetail('expected 1 to equal 2 at x.mjs:3').signature, fromDetail('expected 7 to equal 9 at y.mjs:40').signature)
  assert.notEqual(fromDetail('SyntaxError: a').signature, fromDetail('Unexpected token').signature)
})

test('repeated and tried come from previous', () => {
  const first = fromDetail('AssertionError: expected 1 to equal 2 at a.mjs:3')
  const again = diagnoseFailure({ detail: 'AssertionError: expected 5 to equal 6 at a.mjs:9', previous: [first] })
  assert.equal(again.repeated, true)
  assert.deepEqual(again.tried, ['test'])
  const other = diagnoseFailure({ detail: 'SyntaxError: x', previous: [first] })
  assert.equal(other.repeated, false)
  assert.deepEqual(other.tried, ['test'])
  assert.equal(first.repeated, false)
  assert.deepEqual(first.tried, [])
})

test('empty or malformed input is unknown and does not throw', () => {
  for (const input of [undefined, null, {}, { reason: '', detail: '' }, { detail: 42, reason: ['x'], previous: 'nope' }, { previous: { a: 1 } }]) {
    const diagnosis = diagnoseFailure(input)
    assert.equal(diagnosis.category, 'unknown')
    assert.equal(diagnosis.confirmed, false)
    assert.equal(diagnosis.symptom, '')
    assert.equal(diagnosis.repeated, false)
    assert.deepEqual(diagnosis.tried, [])
  }
  assert.equal(diagnoseFailure({ previous: [null, { category: 'test' }, 5] }).tried[0], 'test')
})

const diag = (category, extra = {}) => ({ category, repeated: false, ...extra })

test('nextAction maps each category', () => {
  const expected = {
    syntax: 'retry',
    type: 'retry',
    test: 'retry',
    regression: 'retry',
    requirement: 'retry',
    'docs-version': 'retry-research',
    dependency: 'rerun-env',
    infra: 'rerun-env',
    flaky: 'rerun-env',
    architecture: 'escalate',
    security: 'escalate',
    integration: 'retry',
    scope: 'retry',
    unknown: 'retry',
  }
  assert.deepEqual(Object.keys(expected).sort(), [...FAILURE_CATEGORIES].sort())
  for (const [category, action] of Object.entries(expected)) {
    const result = nextAction(diag(category), { tier: 'sonnet', attemptsLeft: 2 })
    assert.equal(result.action, action, category)
    assert.ok(result.note)
  }
})

test('nextAction notes carry the advice of each category', () => {
  assert.match(nextAction(diag('regression'), { tier: 'sonnet' }).note, /broader suite/)
  assert.match(nextAction(diag('requirement'), { tier: 'sonnet' }).note, /spec/)
  assert.match(nextAction(diag('docs-version'), { tier: 'sonnet' }).note, /installed version/)
  assert.match(nextAction(diag('dependency'), { tier: 'sonnet' }).note, /Do not change code/)
  assert.match(nextAction(diag('test'), { tier: 'sonnet' }).note, /failing test output/)
})

test('architecture and security stop at the top tier', () => {
  assert.equal(nextAction(diag('architecture'), { tier: 'opus' }).action, 'stop')
  assert.equal(nextAction(diag('security'), { tier: 'haiku' }).action, 'escalate')
})

test('a repeated diagnosis escalates, or stops at opus', () => {
  for (const category of FAILURE_CATEGORIES) {
    assert.equal(nextAction(diag(category, { repeated: true }), { tier: 'sonnet' }).action, 'escalate', category)
    assert.equal(nextAction(diag(category, { repeated: true }), { tier: 'opus' }).action, 'stop', category)
  }
})

test('no attempts left on a retry escalates, or stops at opus; the environment action is unchanged', () => {
  assert.equal(nextAction(diag('test'), { tier: 'haiku', attemptsLeft: 0 }).action, 'escalate')
  assert.equal(nextAction(diag('docs-version'), { tier: 'opus', attemptsLeft: 0 }).action, 'stop')
  assert.equal(nextAction(diag('infra'), { tier: 'sonnet', attemptsLeft: 0 }).action, 'rerun-env')
})

test('nextAction tolerates a missing diagnosis or context', () => {
  assert.equal(nextAction(undefined).action, 'retry')
  assert.equal(nextAction({ category: 'nonsense' }, {}).action, 'retry')
})

// A failing assertion is a code failure, whatever words its message or its test name carry.
const ASSERTION_WITH_ENV_WORDS = [
  'AssertionError [ERR_ASSERTION]: expected response status 500 to equal 200',
  'not ok 4 - applies the rate limit\nAssertionError: expected 429 got 200',
  'not ok 1 - handles HTTP 503 from upstream by retrying\nAssertionError',
  "AssertionError: expected 'Usuário não encontrado' to equal 'ok'",
  'not ok 2 - reports ECONNREFUSED to the caller\nAssertionError: expected 1 to equal 2',
  "AssertionError: expected 'Cannot find module x' to equal 'y'",
  "AssertionError: expected 'deprecated' to equal 'current'",
]

test('an assertion whose message or test name holds environment words is a test, confirmed', () => {
  for (const detail of ASSERTION_WITH_ENV_WORDS) {
    const diagnosis = fromDetail(detail)
    assert.equal(diagnosis.category, 'test', detail)
    assert.equal(diagnosis.confirmed, true, detail)
    assert.equal(nextAction(diagnosis, { tier: 'sonnet' }).action, 'retry', detail)
  }
})

test('the same assertion in a reason is a test hypothesis, not an environment one', () => {
  for (const reason of ASSERTION_WITH_ENV_WORDS) {
    const diagnosis = fromReason(reason)
    assert.equal(diagnosis.category, 'test', reason)
    assert.equal(diagnosis.confirmed, false, reason)
  }
})

test('a DeprecationWarning line next to an AssertionError is a test', () => {
  const diagnosis = fromDetail('DeprecationWarning: Buffer() is deprecated\nAssertionError: expected 1 to equal 2')
  assert.equal(diagnosis.category, 'test')
  assert.equal(diagnosis.confirmed, true)
  assert.equal(fromDetail('DeprecationWarning: Buffer() is deprecated').category, 'docs-version')
})

test('a TypeError that is not a function is docs-version, confirmed from a detail and a hypothesis from a reason', () => {
  const detail = fromDetail('TypeError: x is not a function')
  assert.equal(detail.category, 'docs-version')
  assert.equal(detail.confirmed, true)
  const reason = fromReason('TypeError: x is not a function')
  assert.equal(reason.category, 'docs-version')
  assert.equal(reason.confirmed, false)
})

test('a machine error on its own line is infra even beside an assertion line', () => {
  const diagnosis = fromDetail('not ok 1 - saves the user\nError: connect ECONNREFUSED 127.0.0.1:5432')
  assert.equal(diagnosis.category, 'infra')
  assert.equal(diagnosis.confirmed, true)
  assert.equal(diagnosis.symptom, 'Error: connect ECONNREFUSED 127.0.0.1:5432')
  assert.equal(diagnosis.evidence, 'Error: connect ECONNREFUSED 127.0.0.1:5432')
  const missing = fromDetail('not ok 2 - loads the plugin\nError: Cannot find module \'left-pad\'')
  assert.equal(missing.category, 'dependency')
})

test('a connection refusal with no assertion line is infra, confirmed', () => {
  const diagnosis = fromDetail('Error: connect ECONNREFUSED 127.0.0.1:5432')
  assert.equal(diagnosis.category, 'infra')
  assert.equal(diagnosis.confirmed, true)
  assert.equal(nextAction(diagnosis, { tier: 'sonnet' }).action, 'rerun-env')
})

test('an AssertionError with a SyntaxError is syntax', () => {
  const diagnosis = fromDetail('AssertionError: expected 1 to equal 2\nSyntaxError: Unexpected token }')
  assert.equal(diagnosis.category, 'syntax')
  assert.equal(diagnosis.symptom, 'SyntaxError: Unexpected token }')
})

test('two different failing tests in node --test output have different signatures', () => {
  const tap = (name, message) => `TAP version 13\n# Subtest: ${name}\nnot ok 1 - ${name}\n  ---\n  error: ${message}\n  ...\n1..1`
  const a = fromDetail(tap('parses the header', 'expected 1 to equal 2'))
  const b = fromDetail(tap('writes the footer', 'expected 3 to equal 4'))
  assert.equal(a.category, 'test')
  assert.equal(a.symptom, 'not ok 1 - parses the header')
  assert.notEqual(a.signature, b.signature)
  assert.equal(a.repeated, false)
  assert.equal(diagnoseFailure({ detail: tap('writes the footer', 'expected 5 to equal 6'), previous: [a, b] }).repeated, true)
  assert.equal(diagnoseFailure({ detail: tap('another case', 'expected 5 to equal 6'), previous: [a, b] }).repeated, false)
})

test('a non-string detail or a previous that is not an array does not throw', () => {
  for (const input of [{ detail: 42 }, { detail: { a: 1 } }, { detail: null, reason: null }, { previous: 'nope' }, { previous: null }]) {
    const diagnosis = diagnoseFailure(input)
    assert.equal(diagnosis.category, 'unknown')
    assert.deepEqual(diagnosis.tried, [])
    assert.equal(diagnosis.repeated, false)
  }
})

test('real node --test assertion output is a test failure, whatever error text its diff values quote', () => {
  const tap = (value) => [
    'TAP version 13',
    'not ok 1 - loads',
    '  ---',
    '  error: |-',
    '    Expected values to be strictly equal:',
    `    + ${value}`,
    "    - 'ok'",
    "  code: 'ERR_ASSERTION'",
    "  name: 'AssertionError'",
  ].join('\n')
  for (const value of ["'Cannot find module x'", "'connect ECONNREFUSED 127.0.0.1:5432'", "'rate limit exceeded'", "'x is deprecated'"]) {
    const d = diagnoseFailure({ detail: tap(value) })
    assert.equal(d.category, 'test', value)
    assert.equal(nextAction(d, { tier: 'sonnet', attemptsLeft: 1 }).action, 'retry', value)
  }
  assert.notEqual(diagnoseFailure({ reason: "not ok 1 - handles errors\n  + 'rate limit exceeded'" }).category, 'infra')
  const thrown = diagnoseFailure({ detail: "not ok 1 - saves\n  error: 'connect ECONNREFUSED 127.0.0.1:5432'\n  code: 'ECONNREFUSED'" })
  assert.equal(thrown.category, 'infra', 'a thrown connection error with no failed assertion stays infra')
})

test('two different failing tests in spec-reporter output get different signatures', () => {
  const out = (name, a, b) => ['✖ ' + name + ' (2ms)', 'ℹ tests 1', 'ℹ pass 0', 'ℹ fail 1', '✖ failing tests:', 'test at x.test.mjs:3:1', '✖ ' + name + ' (2ms)', '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', `  ${a} !== ${b}`, "    code: 'ERR_ASSERTION',"].join('\n')
  const first = diagnoseFailure({ detail: out('parses the header', 1, 2) })
  const second = diagnoseFailure({ detail: out('writes the footer', 3, 4), previous: [first] })
  assert.equal(first.category, 'test')
  assert.equal(first.symptom, '✖ parses the header (2ms)')
  assert.notEqual(first.signature, second.signature)
  assert.equal(second.repeated, false)
  const again = diagnoseFailure({ detail: out('parses the header', 5, 6), previous: [first] })
  assert.equal(again.repeated, true, 'the same test failing again is repeated')
  const tap = diagnoseFailure({ detail: 'TAP version 13\nnot ok 1 - writes the footer\n# fail 1\n  AssertionError: x' })
  assert.equal(tap.symptom, 'not ok 1 - writes the footer')
})

test('a Jest assertion is a test failure whatever its Received value quotes', () => {
  const jest = "expect(received).toBe(expected) // Object.is equality\n\nExpected: 'ok'\nReceived: 'Cannot find module x'"
  assert.equal(diagnoseFailure({ detail: jest }).category, 'test')
})
