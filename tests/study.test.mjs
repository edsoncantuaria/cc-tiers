import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const { memoryPath } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'memory.mjs')).href)
const DEFAULTS = JSON.parse(readFileSync(path.join(ROOT, 'config', 'routing.default.json'), 'utf8'))

const routingWith = (user = {}) => tiers.mergeRouting(DEFAULTS, null, { verify: 'off', hard_start: 'opus', ...user })
const delegate = (state, routing, role, prompt) => tiers.checkDelegation(state, { subagent_type: `cc-tiers:${role}`, prompt }, routing, {})

const STUDY = 'study-billing-discount'
const FRONT = 'study-billing-discount-engine'

const agentEvent = (id, role, text, prompt, extra = {}) => ({
  ...tiers.normalizeEvent({
    session_id: 's',
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
    tool_response: { status: 'completed', content: [{ type: 'text', text }] },
  }),
  ...extra,
})

async function inTemp(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-study-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// The reports go through processReport, as the hooks do: it logs, charges spend and writes history and memory.
const report = (dir, routing, state, id, role, text, prompt, extra) => {
  const ctx = { routing, ccCost: false, projectDir: dir }
  const event = tiers.prepareReport(ctx, agentEvent(id, role, text, prompt, extra))
  return tiers.processReport(ctx, state, event)
}

const trailer = (task, status, reason = 'ok') => `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: reviewer\nCC_TIERS_STATUS: ${status}\nCC_TIERS_REASON: ${reason}`
const claimsPrompt = `CC_TIERS_TASK: ${STUDY}\nHow does the discount engine work?\nCC_TIERS_CLAIMS_BEGIN\n1. Discounts apply in src/billing.js:10.\nCC_TIERS_CLAIMS_END`
const finding = ['CC_TIERS_FINDING_BEGIN', 'category: correctness', 'severity: blocking', 'evidence: trace', 'where: src/billing.js:10', 'expected: applied once', 'observed: applied twice', 'CC_TIERS_FINDING_END'].join('\n')

test('isStudy tells a study slug by its study- prefix', () => {
  assert.equal(tiers.isStudy(STUDY), true)
  assert.equal(tiers.isStudy(FRONT), true)
  for (const slug of ['billing-discount', 'study', 'study-', 'studying-billing', 'final-gate', '', undefined]) assert.equal(tiers.isStudy(slug), false, String(slug))
})

test('a worker, implementer, architect or checker delegation on a study slug is refused with the study rule', () => {
  const routing = routingWith({ specify: 'off', research: 'off' })
  for (const role of ['worker', 'implementer', 'architect', 'checker']) {
    const refused = delegate(tiers.emptyState('s'), routing, role, `CC_TIERS_TASK: ${STUDY}\nChange the engine.`)
    assert.match(refused.deny, new RegExp(`${STUDY} is a study: a study changes no code; use a slug without the study- prefix for code work`), role)
    assert.equal(refused.input, null)
  }
  // Researcher and reviewer take a study slug; the same code roles still work on a slug without the prefix.
  for (const role of ['researcher', 'reviewer']) assert.equal(delegate(tiers.emptyState('s'), routing, role, claimsPrompt).deny, '', role)
  assert.equal(delegate(tiers.emptyState('s'), routing, 'implementer', 'CC_TIERS_TASK: billing-discount\nChange the engine.').deny, '')
  assert.equal(delegate(tiers.emptyState('s'), routing, 'checker', 'CC_TIERS_TASK: billing-discount\nCheck it.').deny, '')
})

test('a researcher pass or fail on a study slug marks research and logs a study, never an open code task', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const prompt = `CC_TIERS_TASK: ${FRONT}\nCC_TIERS_STUDY: how are discounts applied?`
    const message = report(dir, routing, state, 'r1', 'researcher', `brief\nCC_TIERS_TASK: ${FRONT}\nCC_TIERS_STATUS: pass`, prompt)
    assert.match(message, new RegExp(`cc-tiers marked ${FRONT} as researched`))
    assert.equal(state.researched[FRONT], true)
    assert.equal(state.log[FRONT].kind, 'study')
    assert.equal(state.log[FRONT].status, 'study-open')
    assert.equal(state.log[FRONT].attempts, 0)
    assert.deepEqual(state.tasks, {})
    assert.equal(tiers.openWork(state), '')
    // With a measured duration (the foreground path) the entry is the same one; a failed run logs it too.
    const timed = tiers.emptyState('s')
    report(dir, routing, timed, 'r2', 'researcher', `brief\nCC_TIERS_TASK: ${FRONT}\nCC_TIERS_STATUS: fail`, prompt, { durationMs: 4200 })
    assert.equal(timed.log[FRONT].kind, 'study')
    assert.equal(timed.log[FRONT].status, 'study-open')
    assert.equal(timed.log[FRONT].durationMs, 4200)
    assert.equal(timed.researched[FRONT], undefined)
    // A code task researched the same way still shows no log entry until a writer reports.
    const code = tiers.emptyState('s')
    report(dir, routing, code, 'r3', 'researcher', 'brief\nCC_TIERS_TASK: billing-discount\nCC_TIERS_STATUS: pass', 'CC_TIERS_TASK: billing-discount\nResearch.')
    assert.equal(code.log['billing-discount'], undefined)
  }))

test('a reviewer pass on a study slug logs done, prints the study line and no completion', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const message = report(dir, routing, state, 'v1', 'reviewer', trailer(STUDY, 'pass', 'claims hold'), claimsPrompt)
    assert.equal(message, `cc-tiers study: ${STUDY} claims checked by Opus review.`)
    assert.doesNotMatch(message, /cc-tiers completion|no writer attempt/)
    assert.equal(state.log[STUDY].kind, 'study')
    assert.equal(state.log[STUDY].status, 'done')
    assert.deepEqual(state.log[STUDY].reviews, ['reviewer'])
    assert.equal(state.log[STUDY].failures, 0)
    assert.equal(state.log[STUDY].finished, '')
    assert.deepEqual(state.tasks, {})
    assert.deepEqual(state.completions, {})
    assert.equal(tiers.openWork(state), '')
  }))

test('a reviewer fail on a study slug logs rejected and counts no failure, history or memory', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    assert.equal(routing.learn, true)
    assert.equal(routing.memory, true)
    const state = tiers.emptyState('s')
    const rejected = report(dir, routing, state, 'v1', 'reviewer', `${finding}\n${trailer(STUDY, 'fail', 'claim 1 is wrong.')}`, claimsPrompt)
    assert.equal(rejected, `cc-tiers study: ${STUDY} claims rejected: claim 1 is wrong. Fix the synthesis and send it to cc-tiers:reviewer again (at most 2 rounds).`)
    assert.equal(state.log[STUDY].status, 'rejected')
    assert.equal(state.log[STUDY].kind, 'study')
    assert.equal(state.log[STUDY].failures, 0)
    assert.equal(state.log[STUDY].escalations, 0)
    assert.deepEqual(state.tasks, {})
    assert.equal(Object.hasOwn(state.tasks, STUDY), false)
    assert.equal(existsSync(tiers.historyPath(dir)), false)
    assert.equal(existsSync(memoryPath(dir)), false)
    assert.equal(tiers.openWork(state), '')
    // Two more rejected rounds still count nothing, and the pass that follows finishes the study.
    for (const id of ['v2', 'v3']) report(dir, routing, state, id, 'reviewer', trailer(STUDY, 'fail', 'still wrong'), claimsPrompt)
    assert.deepEqual(state.tasks, {})
    assert.equal(state.log[STUDY].failures, 0)
    assert.equal(report(dir, routing, state, 'v4', 'reviewer', trailer(STUDY, 'pass'), claimsPrompt), `cc-tiers study: ${STUDY} claims checked by Opus review.`)
    assert.equal(state.log[STUDY].status, 'done')
    assert.deepEqual(state.log[STUDY].reviews, ['reviewer', 'reviewer', 'reviewer', 'reviewer'])
    assert.equal(existsSync(tiers.historyPath(dir)), false)
    assert.equal(existsSync(memoryPath(dir)), false)
  }))

test('a study rejection with no reason names its first blocking finding', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const text = `${finding}\nCC_TIERS_TASK: ${STUDY}\nCC_TIERS_STATUS: fail`
    const message = report(dir, routing, state, 'v1', 'reviewer', text, claimsPrompt)
    assert.match(message, new RegExp(`^cc-tiers study: ${STUDY} claims rejected: correctness @ src/billing.js:10: applied once / applied twice\\. Fix the synthesis`))
    assert.equal(state.log[STUDY].status, 'rejected')
    const bare = report(dir, routing, tiers.emptyState('s'), 'v2', 'reviewer', `CC_TIERS_TASK: ${STUDY}\nCC_TIERS_STATUS: fail`, claimsPrompt)
    assert.match(bare, /claims rejected: no reason given\. Fix the synthesis/)
  }))

test('a study reviewer report with no CC_TIERS_STATUS is asked for its verdict again and counts nothing', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const applied = tiers.applyEvent(state, { kind: 'report', id: 'agent:a1', agent_id: 'a1', role: 'reviewer', prompt: claimsPrompt, text: `Looks fine.\nCC_TIERS_TASK: ${STUDY}` }, routing)
    assert.equal(applied.meta.outcome, 'uncounted')
    assert.match(applied.message, /finished without CC_TIERS_STATUS pass or fail/)
    assert.match(applied.message, /ask that reviewer for its verdict with SendMessage/)
    assert.equal(state.background.a1.role, 'reviewer')
    assert.deepEqual(state.tasks, {})
    const logged = tiers.emptyState('s')
    report(dir, routing, logged, 'v1', 'reviewer', `Looks fine.\nCC_TIERS_TASK: ${STUDY}`, claimsPrompt)
    assert.equal(logged.log[STUDY], undefined)
  }))

test('a study reviewer that crashed is not a verdict', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const event = tiers.normalizeEvent({
      session_id: 's',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Agent',
      tool_use_id: 'v1',
      tool_input: { subagent_type: 'cc-tiers:reviewer', prompt: claimsPrompt },
      error: 'agent crashed',
    })
    const message = tiers.processReport({ routing, ccCost: false, projectDir: dir }, state, event)
    assert.match(message, new RegExp(`cc-tiers study: ${STUDY} claims review did not finish \\(agent crashed\\)`))
    assert.doesNotMatch(message, /claims rejected/)
    assert.deepEqual(state.tasks, {})
    assert.equal(state.log[STUDY], undefined)
  }))

const quotedTrailer = 'CC_TIERS_TASK: fix-login\nCC_TIERS_ROLE: implementer\nCC_TIERS_STATUS: pass'
const quotingPrompt = (quoted) => `CC_TIERS_TASK: ${STUDY}\nHow are trailers read?\nCC_TIERS_CLAIMS_BEGIN\n1. A report ends with:\n${quoted}\nCC_TIERS_CLAIMS_END`

test('a trailer line quoted inside the claims block never acts as a header', () => {
  assert.deepEqual(tiers.parseHeaders(quotingPrompt(quotedTrailer)), { TASK: STUDY })
  assert.equal(tiers.parseHeaders(`${claimsPrompt}\nCC_TIERS_RESEARCH: none - fixture`).RESEARCH, 'none - fixture')
  assert.equal(tiers.parseHeaders(`CC_TIERS_RESEARCH_BEGIN\nCC_TIERS_TASK: other\nCC_TIERS_RESEARCH_END\nCC_TIERS_TASK: fix-login`).TASK, 'fix-login')
})

test('a study review whose claims quote a writer trailer is not refused, the same trailer outside the claims is', () => {
  const routing = routingWith({ specify: 'off' })
  const inside = delegate(tiers.emptyState('s'), routing, 'reviewer', quotingPrompt(quotedTrailer))
  assert.equal(inside.deny, '')
  const outside = delegate(tiers.emptyState('s'), routing, 'reviewer', `CC_TIERS_TASK: ${STUDY}\nReview.\n${quotedTrailer}`)
  assert.match(outside.deny, /writer's report trailer/)
})

test('a crashed or trailer-less study reviewer whose claims quote a live code slug counts nothing on that task', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const code = 'fix-login'
    report(dir, routing, state, 'w1', 'implementer', `CC_TIERS_TASK: ${code}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: ok`, `CC_TIERS_TASK: ${code}\nFix.`)
    const before = JSON.stringify([state.tasks, state.log[code]])
    const prompt = quotingPrompt(`CC_TIERS_TASK: ${code}\nCC_TIERS_STATUS: fail`)
    const crashed = tiers.normalizeEvent({
      session_id: 's',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Agent',
      tool_use_id: 'v1',
      tool_input: { subagent_type: 'cc-tiers:reviewer', prompt },
      error: 'agent crashed',
    })
    const message = tiers.processReport({ routing, ccCost: false, projectDir: dir }, state, crashed)
    assert.match(message, new RegExp(`cc-tiers study: ${STUDY} claims review did not finish`))
    assert.doesNotMatch(message, /counted a failure/)
    // A reviewer that answers with prose and no trailer falls back to the prompt slug too.
    report(dir, routing, state, 'v2', 'reviewer', 'Looks fine.', prompt)
    assert.equal(JSON.stringify([state.tasks, state.log[code]]), before)
    assert.equal(state.log[code].failures, 0)
    assert.equal(state.log[STUDY], undefined)
  }))

test('redoFromPrompt ignores a done study named in a complaint, and still counts a done code task', () => {
  const entry = (extra) => ({ tiers: [], attempts: 0, failures: 0, escalations: 0, reviews: ['reviewer'], effort: {}, status: 'done', finished: '', ...extra })
  const state = { ...tiers.emptyState('s'), log: { [STUDY]: entry({ kind: 'study' }), 'fix-login': entry({ tiers: ['sonnet'], attempts: 1 }) } }
  assert.deepEqual(tiers.redoFromPrompt(state, `${STUDY} is still broken`), [])
  assert.equal(state.log[STUDY].redo, undefined)
  assert.equal(state.events.length, 0)
  assert.equal(tiers.redoFromPrompt(state, 'fix-login is still broken').length, 1)
})

test('a non-study review with no writer is still dropped, and final-gate keeps its own path', () =>
  inTemp(async (dir) => {
    const routing = routingWith({ specify: 'off' })
    const state = tiers.emptyState('s')
    const dropped = tiers.applyEvent(state, tiers.prepareReport({ routing, projectDir: dir }, agentEvent('v1', 'reviewer', trailer('billing-discount', 'pass'), 'CC_TIERS_TASK: billing-discount\nReview.')), routing)
    assert.equal(dropped.meta.outcome, 'uncounted')
    assert.match(dropped.message, /no writer attempt was recorded for billing-discount/)
    const gate = tiers.applyEvent(tiers.emptyState('s'), tiers.prepareReport({ routing, projectDir: dir }, agentEvent('v2', 'reviewer', trailer('final-gate', 'pass'), 'CC_TIERS_TASK: final-gate\nReview.')), routing)
    assert.doesNotMatch(gate.message, /no writer attempt/)
    assert.notEqual(gate.meta.outcome, 'study-pass')
  }))

test('studyTitle titles a study prompt on one line, cut on a word boundary', () => {
  assert.equal(tiers.studyTitle('/cc-tiers:study How does billing apply discounts?'), 'Study: How does billing apply discounts?')
  assert.equal(tiers.studyTitle('/study  is   the\n  import\tfeasible? '), 'Study: is the import feasible?')
  const long = tiers.studyTitle('/cc-tiers:study How does the billing service compute the discount for a customer with several subscriptions and a coupon?')
  assert.equal(long, 'Study: How does the billing service compute the discount for')
  assert.ok(long.length <= 60)
  // A word that ends exactly at 60 characters stays.
  const exact = `Study: ${'a'.repeat(53)}`
  assert.equal(tiers.studyTitle(`/cc-tiers:study ${'a'.repeat(53)} more words`), exact)
  // One word longer than the limit is cut hard.
  assert.equal(tiers.studyTitle(`/cc-tiers:study ${'b'.repeat(90)}`), `Study: ${'b'.repeat(53)}`)
  // A multi-line question is one line.
  assert.doesNotMatch(tiers.studyTitle('/cc-tiers:study first line\nsecond line\n\nthird line'), /\n/)
  for (const prompt of ['', 'study the billing code', '/cc-tiers:redo fix-login still broken', '/cc-tiers:study', '/cc-tiers:study   ', '/studyx how', '/cc-tiers:report', undefined]) {
    assert.equal(tiers.studyTitle(prompt), '', String(prompt))
  }
})

test('the UserPromptSubmit hook titles a study prompt, with or without its own context, and no other prompt', async () => {
  await inTemp(async (dir) => {
    const run = (prompt) =>
      spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'stop.mjs')], {
        input: JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: dir, CLAUDE_PROJECT_DIR: '' },
      })
    const alone = run('/cc-tiers:study How does billing apply discounts?')
    assert.equal(alone.status, 0)
    assert.deepEqual(JSON.parse(alone.stdout), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', sessionTitle: 'Study: How does billing apply discounts?' } })
    // A note waiting for the session travels with the title.
    writeFileSync(tiers.sessionPath(dir, 's1'), JSON.stringify({ ...tiers.emptyState('s1'), pending: ['cc-tiers: an earlier report'] }))
    const merged = JSON.parse(run('/study is the import feasible?').stdout)
    assert.equal(merged.hookSpecificOutput.additionalContext, 'cc-tiers: an earlier report')
    assert.equal(merged.hookSpecificOutput.sessionTitle, 'Study: is the import feasible?')
    // Any other prompt gets no title.
    assert.equal(run('/cc-tiers:report').stdout, '')
    writeFileSync(tiers.sessionPath(dir, 's1'), JSON.stringify({ ...tiers.emptyState('s1'), pending: ['cc-tiers: a note'] }))
    const plain = JSON.parse(run('what is the weather').stdout)
    assert.deepEqual(plain, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'cc-tiers: a note' } })
  })
})

test('the qa skill is user-invoked only, runs on a study slug, has the five finding types and a reviewer rule for command claims', () => {
  const text = readFileSync(path.join(ROOT, 'skills', 'qa', 'SKILL.md'), 'utf8')
  const front = text.slice(0, text.indexOf('\n---', 4))
  assert.ok(text.startsWith('---\n'))
  assert.match(front, /^disable-model-invocation: true$/m)
  const lower = text.toLowerCase()
  for (const needle of ['study-qa-', 'CC_TIERS_CLAIMS_BEGIN', 'techniques.md']) assert.ok(text.includes(needle), `qa skill mentions ${needle}`)
  for (const type of ['confirmed bug', 'suspicion', 'risk', 'coverage gap', 'test not run']) assert.ok(lower.includes(`**${type}**`), `qa skill types a finding as ${type}`)
  assert.ok(text.split('\n').length <= 120, 'qa skill stays within 120 lines')
  const inside = text.slice(text.indexOf('## Inside a task'), text.indexOf('## Findings'))
  assert.ok(inside.startsWith('## Inside a task'), 'qa skill has an Inside a task section before Findings')
  for (const needle of ['No `study-qa` slug', 'skip Wiring and Review', 'Write no file, in plan mode or not', "the spec's `Repro:` criterion"]) assert.ok(inside.includes(needle), `qa Inside a task mentions ${needle}`)
  const findings = text.slice(text.indexOf('## Findings'), text.indexOf('## Guards'))
  assert.match(findings, /In a standalone run \(`\/cc-tiers:qa`\), a confirmed bug also ends with the line[^]*``- `<command>` fails before the fix with <message>``\. Start no fix task\. Inside a task the orchestrator follows its trigger\./)
  const reviewer = readFileSync(path.join(ROOT, 'agents', 'reviewer.md'), 'utf8')
  const claims = reviewer.slice(reviewer.indexOf('## Claims mode'))
  assert.match(claims, /source is a command[^]*`evidence: trace`, never `evidence: command`/)
})

test('the qa skill makes no claim the research could not source: no "different path", the 3-value rule is our own advice', () => {
  const skill = readFileSync(path.join(ROOT, 'skills', 'qa', 'SKILL.md'), 'utf8')
  const techniques = readFileSync(path.join(ROOT, 'skills', 'qa', 'techniques.md'), 'utf8')
  const unsupportedClaims = (skillText, techniquesText) => {
    for (const body of [skillText, techniquesText]) assert.doesNotMatch(body, /different path/i)
    const advice = techniquesText.split(/(?<=\.) /).find((sentence) => sentence.includes('3-value where'))
    assert.match(advice, /^Our own advice/)
    assert.doesNotMatch(advice, /CTFL|ISTQB/)
  }
  unsupportedClaims(skill, techniques)
  assert.throws(() => unsupportedClaims(`${skill}\nValidate by a different path.`, techniques))
  assert.throws(() => unsupportedClaims(skill, `${techniques}\nValidate by a different path.`))
  assert.throws(() => unsupportedClaims(skill, techniques.replace("Our own advice, not the syllabus's: use 3-value", 'CTFL: use 3-value')))
  assert.throws(() => unsupportedClaims(skill, techniques.replace("Our own advice, not the syllabus's", 'Our own advice from CTFL')))
  assert.throws(() => unsupportedClaims(skill, techniques.replace('3-value where', '3-value in')))
})
