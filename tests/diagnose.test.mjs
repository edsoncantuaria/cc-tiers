import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { FAILURE_CATEGORIES, declaresPackage, diagnoseFailure, missingPackage, nextAction } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'diagnose.mjs')).href)

const fromDetail = (detail) => diagnoseFailure({ detail })
const fromReason = (reason) => diagnoseFailure({ reason })

test('exports the fifteen categories', () => {
  assert.equal(FAILURE_CATEGORIES.length, 15)
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
    unverifiable: 'report-partial',
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
  for (const category of FAILURE_CATEGORIES.filter((item) => item !== 'unverifiable')) {
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

test('an unverifiable diagnosis reports partial and is never escalated or stopped', () => {
  const diagnosis = fromReason('cannot be tested here: needs a real payment gateway')
  assert.equal(diagnosis.category, 'unverifiable')
  assert.equal(diagnosis.confirmed, false)
  const first = nextAction(diagnosis, { tier: 'sonnet', attemptsLeft: 2 })
  assert.equal(first.action, 'report-partial')
  assert.match(first.note, /do not move up a tier/)
  for (const tier of ['haiku', 'sonnet', 'opus']) {
    assert.equal(nextAction(diag('unverifiable', { repeated: true }), { tier }).action, 'report-partial', tier)
    assert.equal(nextAction(diag('unverifiable'), { tier, attemptsLeft: 0 }).action, 'report-partial', tier)
  }
})

test('unverifiable phrasing in English and Portuguese is recognized', () => {
  for (const text of [
    'unverifiable without the device',
    'this cannot be reproduced locally',
    "we can't test the checkout flow here",
    'unable to exercise the webhook in this repo',
    'there is no way to verify it locally',
    'needs a live browser to reproduce the bug',
    'requires a real payment database to test it',
    'Nao da para testar sem o ambiente',
    'Não é possível reproduzir aqui',
    'sem como testar isso aqui',
    'sem jeito de reproduzir o erro',
  ]) {
    assert.equal(fromReason(text).category, 'unverifiable', text)
  }
})

test('unverifiable is the last resort: a reason another category explains keeps that category', () => {
  const cases = [
    ['architecture', 'design coupling makes the module impossible to test'],
    ['architecture', 'circular dependency between services: cannot be tested in isolation'],
    ['architecture', 'arquitetura acoplada, nao da para testar'],
    ['requirement', 'acceptance criterion cannot be tested as written'],
    ['integration', 'integration cannot be tested here'],
    ['integration', 'status 404 from the gateway; cannot test against staging'],
    ['scope', 'touches an unrelated file, cannot test that file'],
  ]
  for (const [category, reason] of cases) assert.equal(fromReason(reason).category, category, reason)
  assert.equal(nextAction(fromReason('design coupling makes the module impossible to test'), { tier: 'sonnet', attemptsLeft: 1 }).action, 'escalate')
})

test('an auth or permission failure is never reported as partial', () => {
  for (const reason of ['auth bypass, cannot be tested here', 'permission check missing, cannot test without real accounts', 'autorizacao falha, nao da para testar']) {
    assert.notEqual(fromReason(reason).category, 'unverifiable', reason)
  }
})

test('common wordings of not being able to test are recognized', () => {
  for (const reason of ['nao da pra testar sem o servidor', 'nao consigo reproduzir aqui', 'can\u2019t test the webhook without a public URL']) {
    assert.equal(fromReason(reason).category, 'unverifiable', reason)
  }
})

test('reasons that only mention a missing test, credentials or production keep their own category', () => {
  const cases = [
    ['requirement', 'criterio sem teste para o caso vazio'],
    ['requirement', 'acceptance criterion has no test setup for the empty list'],
    ['security', 'requires credentials to be stored in plain text, security leak'],
    ['integration', 'the endpoint requires credentials and returns status 401'],
    ['unknown', 'no test harness for the module'],
    ['unknown', 'requires production access to deploy'],
    ['unknown', 'unable to verify the first certificate'],
  ]
  for (const [category, text] of cases) {
    assert.equal(fromReason(text).category, category, text)
  }
})

test('a security reason that also says it cannot be tested stays security and escalates', () => {
  for (const text of ['cannot be tested here: data exposure through the endpoint', 'unverifiable security leak']) {
    const diagnosis = fromReason(text)
    assert.equal(diagnosis.category, 'security', text)
    assert.equal(nextAction(diagnosis, { tier: 'sonnet' }).action, 'escalate', text)
  }
  assert.equal(fromDetail('cannot be tested here\nsecurity: token leak in the log').category, 'security')
})

test('a failed assertion that mentions an unverifiable phrase stays a test', () => {
  const detail = "not ok 1 - charges the card\nAssertionError: expected 1 to equal 2\nnote: cannot be tested here, needs a real payment gateway"
  assert.equal(fromDetail(detail).category, 'test')
  assert.equal(fromReason('assertion failed; cannot be tested here').category, 'test')
})

test('an unverifiable line in the output never overrides the reason, and never confirms', () => {
  const cases = [
    ['security', 'cannot be tested here', 'sql injection in the search endpoint'],
    ['security', 'cannot be reproduced locally', 'security leak: token printed in the log'],
    ['requirement', 'cannot be tested here', 'acceptance criterion for the empty list is not met'],
    ['architecture', 'unable to reproduce in this repo', 'circular dependency between modules'],
    ['regression', 'cannot be tested here', 'regression: broke existing checkout'],
  ]
  for (const [category, detail, reason] of cases) assert.equal(diagnoseFailure({ detail, reason }).category, category, reason)
  const auth = diagnoseFailure({ detail: 'cannot be tested here', reason: 'auth bypass on the admin route' })
  assert.notEqual(auth.category, 'unverifiable')
  assert.equal(diagnoseFailure({ detail: 'skipped: cannot be tested here' }).category, 'unknown', 'a runner line alone decides nothing')
  const own = diagnoseFailure({ reason: 'cannot be tested here: needs a real payment gateway', detail: 'ok 1 - other' })
  assert.equal(own.category, 'unverifiable')
  assert.equal(own.confirmed, false)
})

test('a secret, token or password failure is never reported as partial', () => {
  for (const reason of ['secret token logged; cannot test in prod', 'senha exposta, nao da para testar', 'password reset cannot be tested here']) {
    assert.notEqual(diagnoseFailure({ reason }).category, 'unverifiable', reason)
  }
})

test('auth-like wordings are never reported as partial', () => {
  const reasons = [
    'returns 401 Unauthorized, cannot be reproduced locally',
    'unauthenticated request accepted, cannot be tested here',
    'OAuth login cannot be tested here',
    'admin role check missing, cannot be tested here',
    'forbidden 403, cannot be tested here',
    'api key hardcoded, cannot be tested here',
    'jwt signature not checked; cannot be tested here',
    'nao consigo reproduzir o login do admin',
  ]
  for (const reason of reasons) assert.notEqual(diagnoseFailure({ reason }).category, 'unverifiable', reason)
})

test('the symptom of an unverifiable diagnosis comes from the reason, never from the output', () => {
  const diagnosis = diagnoseFailure({ reason: 'cannot be tested here: needs a real payment gateway', detail: 'warning: cannot be tested here' })
  assert.equal(diagnosis.category, 'unverifiable')
  assert.match(diagnosis.symptom, /payment gateway/)
  assert.equal(diagnosis.evidence, '')
})

test('missingPackage names the package a machine line says is missing, cut to what a manifest lists', () => {
  const node = (name, bare = true) => ({ name, local: false, python: false, bare })
  assert.deepEqual(missingPackage("Error: Cannot find module 'left-pad'"), node('left-pad'))
  assert.deepEqual(missingPackage("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zz' imported from /x/a.mjs"), node('zz'))
  assert.deepEqual(missingPackage("Error: Cannot find package 'zz'"), node('zz'))
  assert.deepEqual(missingPackage("Error: Cannot find module 'lodash/fp'"), node('lodash', false))
  assert.deepEqual(missingPackage("Error: Cannot find module '@scope/pkg/sub/file'"), node('@scope/pkg', false))
  assert.deepEqual(missingPackage("Error: Cannot find module '@scope/pkg'"), node('@scope/pkg'))
  assert.deepEqual(missingPackage("Error: Cannot find module 'socket.io'"), node('socket.io'), 'a dot is part of an npm name')
  const python = (name, bare = true) => ({ name, local: false, python: true, bare })
  assert.deepEqual(missingPackage("ModuleNotFoundError: No module named 'requests.adapters'"), python('requests', false))
  assert.deepEqual(missingPackage("ModuleNotFoundError: No module named 'yaml'"), python('yaml'))
  assert.deepEqual(missingPackage('ImportError: No module named yaml'), python('yaml'))
})

test('missingPackage marks a path, alias or subpath specifier as the project\'s own file', () => {
  for (const specifier of ['./x', '../x', './', '..', '/abs/x.js', '~/x', '@/x', '#x', 'C:\\abs\\x.js']) {
    assert.deepEqual(missingPackage(`Error: Cannot find module '${specifier}'`), { name: specifier, local: true, python: false, bare: false }, specifier)
  }
  const esm = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/p/nope.mjs' imported from /p/c.mjs"
  assert.equal(missingPackage(esm).local, true)
  assert.equal(missingPackage("Error: Cannot find module '.hidden'").local, false, 'only ./ and ../ start a relative path')
})

test('missingPackage reads only machine lines of a dependency failure', () => {
  for (const text of ['zsh: command not found: phpunit', 'Error: spawn phpunit ENOENT', 'Error [ERR_MODULE_NOT_FOUND]', '', undefined, null, 'ok 1 - passes']) {
    assert.equal(missingPackage(text), null, String(text))
  }
  // A test name or an assertion that quotes the error is not the failure.
  assert.equal(missingPackage("not ok 1 - reports Cannot find module 'x'"), null)
  assert.equal(missingPackage("AssertionError: expected the error\nError: Cannot find module 'x'"), null)
  assert.equal(missingPackage("- Error: Cannot find module 'x'\n+ Error: Cannot find module 'y'"), null)
  assert.equal(missingPackage("not ok 1 - names x\nError: Cannot find module 'left-pad'\n    at a.js:1")?.name, 'left-pad')
})

test('missingPackage is null when the output also reports a missing command', () => {
  const module = "Error: Cannot find module 'left-pad'"
  for (const command of ['zsh: command not found: phpunit', 'Error: spawn phpunit ENOENT']) {
    assert.equal(missingPackage(`${command}\n${module}`), null, command)
    assert.equal(missingPackage(`${module}\n${command}`), null, command)
  }
  assert.equal(missingPackage("ModuleNotFoundError: No module named 'yaml'\nsh: 1: ruff: command not found"), null)
})

test('declaresPackage finds an npm package in any dependency map of package.json and nothing else', () => {
  const manifest = JSON.stringify({ name: 'self', dependencies: { a: '1' }, devDependencies: { b: '1' }, peerDependencies: { c: '1' }, optionalDependencies: { '@s/d': '1' }, scripts: { e: 'x' } })
  const declared = (name) => declaresPackage({ name, local: false, python: false }, [{ file: 'package.json', text: manifest }])
  for (const name of ['a', 'b', 'c', '@s/d']) assert.equal(declared(name), true, name)
  for (const name of ['e', 'self', 'A', 'x']) assert.equal(declared(name), false, name)
  for (const text of ['', '{', '[]', 'null', '{"dependencies":"a"}']) assert.equal(declaresPackage({ name: 'a', local: false, python: false }, [{ file: 'package.json', text }]), false, text)
  assert.equal(declaresPackage({ name: 'a', local: true, python: false }, [{ file: 'package.json', text: manifest }]), false, 'a local file is never a package')
  assert.equal(declaresPackage({ name: 'a', local: false, python: false }, []), false, 'no manifest declares nothing')
})

test('declaresPackage reads requirements lines, PEP 621 and Poetry tables for a Python import', () => {
  const requirements = [
    '# pins',
    'requests>=2.0  # http',
    'Flask[async]==2.0',
    'numpy ; python_version < "3.9"',
    'typing_extensions',
    'tool @ https://example.com/tool.whl',
    '-r base.txt',
    '--index-url https://example.com',
    'git+https://example.com/zed.git#egg=zed',
  ].join('\n')
  const python = (name) => ({ name, local: false, python: true })
  const inRequirements = (name) => declaresPackage(python(name), [{ file: 'requirements-dev.txt', text: requirements }])
  for (const name of ['requests', 'flask', 'Flask', 'numpy', 'typing-extensions', 'tool']) assert.equal(inRequirements(name), true, name)
  for (const name of ['base', 'git', 'zed', 'pins', 'yaml']) assert.equal(inRequirements(name), false, name)
  assert.equal(declaresPackage(python('yaml'), [{ file: 'requirements.txt', text: 'PyYAML==6.0' }]), false, 'a pip name that differs from the import name is not matched')

  const pyproject = [
    '[build-system]',
    'requires = ["setuptools>=61"]',
    '',
    '[project]',
    'name = "myapp"',
    'requires-python = ">=3.9"',
    'classifiers = [',
    '  "Programming Language :: Python",',
    ']',
    'dependencies = [',
    '  "httpx>=0.2",  # client',
    '  "rich[jupyter]",',
    ']',
    '',
    '[project.optional-dependencies]',
    'dev = ["pytest", "ruff"]',
    '',
    '[dependency-groups]',
    'docs = [',
    '  "sphinx",',
    ']',
    '',
    '[tool.poetry.dependencies]',
    'python = "^3.9"',
    'django = { version = "^4", extras = ["bcrypt"] }',
    '"ruamel.yaml" = "^0.17"',
    '',
    '[tool.poetry.group.test.dependencies]',
    'hypothesis = "*"',
    '',
    '[[tool.poetry.source]]',
    'name = "private"',
  ].join('\n')
  const inPyproject = (name) => declaresPackage(python(name), [{ file: 'pyproject.toml', text: pyproject }])
  for (const name of ['httpx', 'rich', 'pytest', 'ruff', 'sphinx', 'django', 'ruamel.yaml', 'hypothesis']) assert.equal(inPyproject(name), true, name)
  for (const name of ['setuptools', 'myapp', 'private', 'classifiers', 'Programming', 'bcrypt']) assert.equal(inPyproject(name), false, name)
})
