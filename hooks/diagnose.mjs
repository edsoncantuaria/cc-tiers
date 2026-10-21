/**
 * Failure diagnosis: classify why a task failed from the report, gate, review or error text, then pick the next action.
 * Pure functions with no I/O, so the orchestrator can call them on any failure it holds.
 */

import { fold } from './verify.mjs'

export const FAILURE_CATEGORIES = [
  'syntax',
  'type',
  'test',
  'regression',
  'requirement',
  'docs-version',
  'dependency',
  'integration',
  'architecture',
  'security',
  'infra',
  'flaky',
  'scope',
  'unverifiable',
  'unknown',
]

const MAX_SYMPTOM = 160
const MAX_EVIDENCE = 300
const MAX_EVIDENCE_LINES = 3

/** What a real environment failure prints; a test name or assertion message can carry the words but not these codes. */
const DEPENDENCY_MACHINE = /cannot find module|modulenotfounderror|err_module_not_found|no module named|command not found|spawn \S+ enoent/
const INFRA_MACHINE = /econnrefused|enotfound|eaddrinuse|etimedout|enospc|eai_again|javascript heap out of memory|cannot connect to the docker daemon/

/** Only an explicit inability to test, reproduce or verify: a missing test, credentials or production alone prove nothing. */
const CANNOT = "(?:cannot|can['’]t|can not|unable to|no way to|impossible to) (?:be )?"
const UNVERIFIABLE_RE = new RegExp(
  [
    'unverifiable',
    `${CANNOT}(?:test(?:ed)?|reproduc(?:ed|e)|exercis(?:ed|e))`,
    // A bare "verify" is also a TLS or signature error ("unable to verify the first certificate"), so it needs a place.
    `${CANNOT}verif(?:ied|y)(?: (?:it|this))? (?:here|locally|in this repo)`,
    '(?:needs?|requires?) (?:a |an )?(?:live|real) (?:\\w+ )?(?:service|device|browser|database|account) to (?:test|verify|reproduce)',
    'nao (?:da|e possivel) (?:para |pra )?(?:testar|reproduzir)',
    'nao consigo (?:testar|reproduzir)',
    'sem (?:como|jeito de) (?:testar|reproduzir)',
  ].join('|'),
)
const SECURITY_RE = /security|injection|\bxss\b|\bcsrf\b|\bleak|exposure|seguranca/
/** Words that make a failure security-like even when the security rule does not name it; such a failure is never reported as partial. */
const SENSITIVE_RE = new RegExp(
  `${SECURITY_RE.source}|auth|login|logon|sign.?in|session|\\broles?\\b|permiss|privileg|access control|forbidden|\\b40[13]\\b|api.?key|jwt|` +
    'secret|token|credential|credencia|password|passwd|senha|segredo|autentic|autoriz|acesso negado|papel de',
)

/** An assertion is a code failure, whatever words its message or its test name carry. */
const ASSERTION_RE = /assertionerror|\bnot ok\b|\bfail\b|expected .* to |\bassert/
/** Proof that an assertion failed somewhere in the output; then no line of it, diff values included, is an environment fault. */
const FAILED_ASSERTION_RE = /assertionerror|err_assertion|expected values to be|expected .* to (?:equal|be|deep|match|include|have|throw|contain)\b|expect\(received\)/
/** The actual/expected value lines of an assertion diff. */
const DIFF_VALUE_RE = /^(?:[+-]\s|actual:|expected:|received:)/i

/** Runner chrome: TAP headers and passes, and the summary lines of the TAP and spec reporters. */
const TAP_NOISE_RE = /^(?:tap version \d+|# subtest\b|ok \d+\b|1\.\.\d+|# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b|ℹ\s*\w+|✖ failing tests|✔ |test at )/
/** The name of a failed test in either reporter: 'not ok 3 - name' or '✖ name (2ms)'. */
const FAILED_TEST_RE = /^(?:not ok \d+ - (.+)|✖ (?!failing tests)(.+?)(?: \([\d.]+m?s\))?)$/

/**
 * Text patterns on folded (lowercase, no accents) lines. The first row that matches wins, so the order is the precedence:
 * the earliest stage of a failure comes first because it explains the later ones, and a sharper word beats a generic one.
 * A rule with `machine` confirms from a detail only on that pattern; `re` adds prose that counts only in a reason, as a hypothesis.
 * A `guard` marks a claim an assertion outranks: 'line' ignores assertion lines, 'output' ignores the whole text that holds one.
 * An `unless` pattern drops the rule when any line of the reason or the output matches it.
 * A `reasonOnly` rule is never read from the output: a runner line cannot decide it, only the reporter's own words.
 */
const RULES = [
  { category: 'syntax', re: /syntaxerror|unexpected token|parseerror|parse error|erro de sintaxe/ },
  { category: 'type', re: /error ts\d+|is not assignable|\bmypy\b|phpstan|type error|erro de tipo/ },
  {
    category: 'dependency',
    guard: 'line',
    machine: DEPENDENCY_MACHINE,
    re: new RegExp(`${DEPENDENCY_MACHINE.source}|package not found|nao encontrad[oa]`),
  },
  { category: 'docs-version', guard: 'output', re: /is not a function|has no exported member|deprecated|no such method|unknown option|undefined method/ },
  {
    category: 'infra',
    guard: 'line',
    machine: INFRA_MACHINE,
    re: new RegExp(`${INFRA_MACHINE.source}|out of memory|rate limit|\\b5xx\\b|\\bhttp 5\\d\\d\\b|status(?: code)? 5\\d\\d|overloaded|docker daemon`),
  },
  { category: 'flaky', re: /flaky|intermittent|non-?determinis|passed on retry/ },
  // Before test: a regression report usually also says that a test is failing.
  { category: 'regression', re: /regress|previously passing|broke existing|quebrou/ },
  { category: 'test', re: /assertionerror|expected .* to |expect\(received\)|\bassert|\bfail(?:ed|ing)?\b|not ok|falhou|falharam/ },
  { category: 'architecture', re: /architecture|design|circular|coupling|layering|arquitetura/ },
  { category: 'requirement', re: /requirement|\bspec\b|criterion|acceptance|misunderstood|requisito|criterio/ },
  { category: 'integration', re: /integration|contract mismatch|\b4xx\b|\b4\d\d response|status(?: code)? 4\d\d|schema mismatch|integracao/ },
  { category: 'security', re: SECURITY_RE },
  { category: 'scope', re: /scope|unrelated file|escopo/ },
  // Last: only a failure no other category explains, a failed assertion stays a test, and a security-like one is never reported as partial.
  { category: 'unverifiable', guard: 'output', reasonOnly: true, unless: SENSITIVE_RE, re: UNVERIFIABLE_RE },
]

const DESIGN_RE = /architecture|design|circular|coupling|layering|arquitetura/

/** Reviewer categories that settle the diagnosis without guessing from text. */
const REVIEW_CATEGORIES = {
  regression: 'regression',
  compatibility: 'regression',
  security: 'security',
  'access-control': 'security',
  'input-validation': 'security',
  'data-exposure': 'security',
  scope: 'scope',
  'api-usage': 'docs-version',
  correctness: 'test',
  'error-handling': 'test',
  // These two become architecture when the reason names design words.
  concurrency: 'test',
  state: 'test',
}

const HYPOTHESES = {
  syntax: 'The code does not parse; a typo or an unbalanced token in the changed file.',
  type: 'A type check fails; a value or signature does not match its declared type.',
  test: 'A test assertion fails; the behavior differs from what the test expects.',
  regression: 'The change broke behavior that worked before.',
  requirement: 'The change does not do what the spec asks, or the spec was misread.',
  'docs-version': 'An API is used as a different version documents it; check the installed version.',
  dependency: 'A module, package or command the code needs is missing from the environment.',
  integration: 'The code and another system disagree on a contract, schema or response.',
  architecture: 'The failure comes from how the parts are arranged, not from one line.',
  security: 'The change opens a security hole or exposes data.',
  infra: 'The environment failed (network, port, disk, memory, rate limit or service), not the code.',
  flaky: 'The failure is intermittent and may pass on a rerun.',
  scope: 'The change touches files or behavior outside the task.',
  unverifiable: 'The repo has no way to exercise this failure, so another attempt cannot be checked.',
  unknown: 'The text does not show a cause; read the full output before changing code.',
}

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function linesOf(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function reviewCategoryToCategory(reviewCategory, reason) {
  const key = fold(reviewCategory).trim()
  const mapped = REVIEW_CATEGORIES[key]
  if (!mapped) return null
  const stateful = key === 'concurrency' || key === 'state'
  return stateful && DESIGN_RE.test(fold(reason)) ? 'architecture' : mapped
}

const isAssertion = (line) => ASSERTION_RE.test(fold(line))

/** The lines that make a rule match; strict reads only the machine pattern, which is what a confirmed claim needs. */
function matchingLines(rule, lines, strict) {
  if (rule.guard === 'output' && lines.some(isAssertion)) return []
  // A failed assertion anywhere makes the whole output a code failure: its diff values may quote any error text.
  if (rule.guard && lines.some((line) => FAILED_ASSERTION_RE.test(fold(line)))) return []
  const re = strict ? rule.machine ?? rule.re : rule.re
  return lines.filter((line) => !TAP_NOISE_RE.test(fold(line)) && re.test(fold(line)) && !(rule.guard === 'line' && (isAssertion(line) || DIFF_VALUE_RE.test(line))))
}

/** Strips what changes between two runs of the same error: quoted strings, paths with line numbers and digits. */
function normalize(symptom) {
  return fold(symptom)
    .replace(/"[^"]*"|`[^`]*`|(?<!\w)'[^']*'/g, '<q>')
    .replace(/[^\s'"`()]*[\\/][^\s'"`()]*/g, '<path>')
    .replace(/[\w.-]+\.(?:mjs|cjs|jsx?|tsx?|json|php|py|md|sh|ya?ml)\b(?::\d+)*/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function diagnoseFailure(input) {
  const { reason, detail, source, reviewCategory, previous } = input ?? {}
  const reasonText = asText(reason)
  const history = Array.isArray(previous) ? previous : []
  const detailLines = linesOf(asText(detail))
  const reasonLines = linesOf(reasonText)

  const reviewed = source === 'review' ? reviewCategoryToCategory(asText(reviewCategory), reasonText) : null
  const allowed = (rule) => !rule.unless || ![...detailLines, ...reasonLines].some((line) => rule.unless.test(fold(line)))
  const detailRule = reviewed ? null : RULES.find((rule) => !rule.reasonOnly && allowed(rule) && matchingLines(rule, detailLines, true).length)
  const category =
    reviewed ?? detailRule?.category ?? RULES.find((rule) => allowed(rule) && matchingLines(rule, reasonLines, false).length)?.category ?? 'unknown'
  const rule = RULES.find((item) => item.category === category)
  // A reason-only category takes nothing from the output, so a runner line cannot change its symptom or signature either.
  const found = rule && !rule.reasonOnly ? matchingLines(rule, detailLines, Boolean(detailRule)) : []
  const foundInReason = rule ? matchingLines(rule, reasonLines, false) : []
  const firstMeaningful = detailLines.find((line) => !TAP_NOISE_RE.test(fold(line)))

  // For a failing test the test's name tells two failures apart; the summary lines of the runner never do.
  const named = category === 'test' ? detailLines.find((line) => FAILED_TEST_RE.test(line)) : null
  const symptom = (named ?? found[0] ?? foundInReason[0] ?? firstMeaningful ?? reasonLines[0] ?? '').slice(0, MAX_SYMPTOM)
  const signature = `${category}:${normalize(symptom)}`
  return {
    category,
    symptom,
    evidence: found.slice(0, MAX_EVIDENCE_LINES).join('\n').slice(0, MAX_EVIDENCE),
    hypothesis: HYPOTHESES[category],
    confirmed: Boolean(reviewed || detailRule),
    signature,
    repeated: history.some((entry) => entry?.signature === signature),
    tried: history.map((entry) => entry?.category).filter((item) => typeof item === 'string'),
  }
}

const ACTIONS = {
  syntax: ['retry', 'Fix the syntax error where it is reported, then rerun the check that parses the file.'],
  type: ['retry', 'Fix the type error where it is reported, then rerun the type check.'],
  test: ['retry', 'Retry with the failing test output; fix the cause the assertion shows.'],
  regression: ['retry', 'Fix what broke and run the broader suite, not only the focused test.'],
  requirement: ['retry', 'Re-read the spec first; change a criterion only when the failure shows it was wrong.'],
  'docs-version': ['retry-research', 'Check the installed version and its docs for the API before using it again.'],
  dependency: ['rerun-env', 'The environment is missing something: fix it, then rerun. Do not change code until then.'],
  infra: ['rerun-env', 'The environment failed: fix or wait it out, then rerun. Do not change code until then.'],
  flaky: ['rerun-env', 'Rerun the check; the failure is intermittent.'],
  architecture: ['escalate', 'The cause is the design, which needs a stronger tier to decide.'],
  security: ['escalate', 'A security finding needs a stronger tier to fix.'],
  integration: ['retry', 'Check the contract on both sides, then retry.'],
  scope: ['retry', 'Revert what is outside the task and retry with only the files it names.'],
  unverifiable: ['report-partial', 'The repo cannot exercise this failure: do not move up a tier. Deliver the verifiable part, report the task as partial, and name the test setup that is missing.'],
  unknown: ['retry', 'Read the full output to find the cause, then retry.'],
}

export function nextAction(diagnosis, { tier, attemptsLeft } = {}) {
  const category = diagnosis?.category in ACTIONS ? diagnosis.category : 'unknown'
  const [action, note] = ACTIONS[category]
  // A stronger tier cannot verify what the repo cannot exercise, so repeating or running out of attempts changes nothing.
  if (action === 'report-partial') return { action, note }
  const exhausted = diagnosis?.repeated === true || (typeof attemptsLeft === 'number' && attemptsLeft <= 0 && action.startsWith('retry'))
  const stronger = action === 'escalate' || exhausted
  if (!stronger) return { action, note }
  if (tier === 'opus') return { action: 'stop', note: `${note} Already at the top tier: stop and report.` }
  return { action: 'escalate', note: exhausted ? `Same failure again or no attempts left: move up a tier. ${note}` : note }
}
