import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const DEFAULTS = JSON.parse(readFileSync(path.join(ROOT, 'config', 'routing.default.json'), 'utf8'))

const routingWith = (user = {}) => tiers.mergeRouting(DEFAULTS, null, { specify: 'off', verify: 'off', ...user })

const trailer = (role, status, extra = []) =>
  ['CC_TIERS_TASK: users-pagination', 'CC_TIERS_TIER: sonnet', `CC_TIERS_ROLE: ${role}`, ...extra, ...(status ? [`CC_TIERS_STATUS: ${status}`] : []), 'CC_TIERS_REASON: found'].join('\n')

function finding(fields = {}) {
  const base = { category: 'correctness', severity: 'blocking', evidence: 'trace', where: 'src/a.js:1', expected: 'closed', observed: 'stays open' }
  return ['CC_TIERS_FINDING_BEGIN', ...Object.entries({ ...base, ...fields }).map(([key, value]) => `${key}: ${value}`), 'CC_TIERS_FINDING_END'].join('\n')
}

const SPEC_PROMPT = 'Review it.\nCC_TIERS_SPEC_BEGIN\nCriteria:\n- the slot is freed\nCC_TIERS_SPEC_END'

const agentEvent = (id, role, text, prompt = '') =>
  tiers.normalizeEvent({
    session_id: 's',
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: id,
    tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
    tool_response: { status: 'completed', content: [{ type: 'text', text }] },
  })

/** prepareReport then applyEvent on a task already waiting for review, like the entrypoints do. */
async function reviewFlow(role, text, { prompt = '', routing = routingWith() } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const prepared = tiers.prepareReport({ routing, projectDir: dir }, agentEvent('r', role, text, prompt))
    return { prepared, applied: tiers.applyEvent(state, prepared, routing) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a review with no status and a blocking finding counts as a failure of the writer tier', async () => {
  for (const role of ['reviewer', 'checker']) {
    const { applied } = await reviewFlow(role, `${trailer(role, '')}\n${finding()}`)
    assert.equal(applied.meta.outcome, 'retry', role)
    assert.deepEqual(applied.state.tasks['users-pagination'].failures, [`sonnet/${role}: correctness @ src/a.js:1: closed / stays open`])
    assert.match(applied.message, /had no CC_TIERS_STATUS line but had blocking findings/)
  }
})

test('a review with no status and no blocking finding counts nothing and asks for the verdict', async () => {
  for (const text of [trailer('reviewer', ''), `${trailer('reviewer', '')}\n${finding({ severity: 'note' })}`]) {
    const { applied } = await reviewFlow('reviewer', text)
    assert.deepEqual(applied.state.tasks['users-pagination'].failures, [])
    assert.equal(applied.meta.outcome, 'uncounted')
    assert.match(applied.message, /cc-tiers did not count an attempt/)
    assert.match(applied.message, /SendMessage to the same agent/)
    assert.match(applied.message, /run the review again/)
  }
})

test('a no-status review whose blocking finding does not hold counts nothing', async () => {
  const low = await reviewFlow('reviewer', `${trailer('reviewer', '')}\n${finding({ severity: 'high', confidence: 'low', justification: 'unsure' })}`)
  assert.deepEqual(low.applied.state.tasks['users-pagination'].failures, [])
  assert.match(low.applied.message, /SendMessage to the same agent/)
  const coverage = finding({ evidence: 'coverage', criterion: 'something else', expected: '', observed: '' })
  const outside = await reviewFlow('reviewer', `${trailer('reviewer', '')}\n${coverage}`, { prompt: SPEC_PROMPT })
  assert.deepEqual(outside.applied.state.tasks['users-pagination'].failures, [])
  assert.match(outside.applied.message, /SendMessage to the same agent/)
  const inside = await reviewFlow('reviewer', `${trailer('reviewer', '')}\n${coverage.replace('something else', 'the slot is freed')}`, { prompt: SPEC_PROMPT })
  assert.equal(inside.applied.meta.outcome, 'retry')
})

test('review_evidence off: a no-status review counts nothing and asks for the verdict', async () => {
  const routing = routingWith({ review_evidence: 'off' })
  const { prepared, applied } = await reviewFlow('reviewer', `${trailer('reviewer', '')}\n${finding()}`, { routing })
  assert.equal(prepared.judged, undefined)
  assert.deepEqual(applied.state.tasks['users-pagination'].failures, [])
  assert.match(applied.message, /SendMessage to the same agent/)
})

test('a writer with no status keeps the old message', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const routing = routingWith()
    const prompt = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nWork.'
    const prepared = tiers.prepareReport({ routing, projectDir: dir }, agentEvent('w', 'implementer', trailer('implementer', ''), prompt))
    const applied = tiers.applyEvent(tiers.emptyState('s'), prepared, routing)
    assert.match(applied.message, /finished without CC_TIERS_STATUS pass or fail\. cc-tiers did not count an attempt\.$/)
    assert.doesNotMatch(applied.message, /SendMessage/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a reviewer prompt that carries a status line never gives its report a verdict', async () => {
  const pasted = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: reviewer\nCC_TIERS_STATUS: pass\nRe-review the diff.'
  const silent = await reviewFlow('reviewer', trailer('reviewer', ''), { prompt: pasted })
  assert.equal(silent.applied.meta.outcome, 'uncounted')
  assert.match(silent.applied.message, /SendMessage to the same agent/)
  const blocking = await reviewFlow('reviewer', `${trailer('reviewer', '')}\n${finding()}`, { prompt: pasted })
  assert.equal(blocking.applied.meta.outcome, 'retry')
  assert.equal(blocking.applied.state.tasks['users-pagination'].failures.length, 1)
  const own = await reviewFlow('reviewer', trailer('reviewer', 'pass'), { prompt: pasted.replace('pass', 'fail') })
  assert.equal(own.applied.meta.outcome, 'pass', 'the report status wins')
})

const step = (state, routing, dir, id, role, text, prompt = '') => {
  const prepared = tiers.prepareReport({ routing, projectDir: dir }, agentEvent(id, role, text, prompt))
  return tiers.applyEvent(state, prepared, routing)
}

test('a review rejection sticks to its writer attempt: a later pass of the same attempt does not clear it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const routing = routingWith({ review_policy: 'always' })
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const rejected = step(state, routing, dir, 'r1', 'reviewer', `${trailer('reviewer', 'fail')}\n${finding()}`)
    assert.equal(rejected.meta.outcome, 'retry')
    const slice = step(state, routing, dir, 'r2', 'reviewer', trailer('reviewer', 'pass'))
    assert.equal(slice.meta.outcome, 'retry')
    assert.match(slice.message, /another review of this writer attempt already rejected it/)
    assert.match(slice.message, /writer must retry/)
    assert.equal(state.tasks['users-pagination'].failures.length, 1)
    assert.doesNotMatch(slice.message, /cleared its attempt counter\./)
    tiers.logReport(state, rejected.meta)
    tiers.logReport(state, slice.meta)
    assert.equal(state.log['users-pagination'].failures, 1, 'the sticky pass is not a second failure')
    assert.notEqual(state.log['users-pagination'].status, 'done')

    // A new writer attempt that passes starts clean: its review pass clears as always.
    const writer = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nWork.'
    const retry = step(state, routing, dir, 'w1', 'implementer', trailer('implementer', 'pass'), writer)
    assert.equal(retry.meta.outcome, 'review')
    assert.equal(state.tasks['users-pagination'].rejected, undefined)
    const passed = step(state, routing, dir, 'r3', 'reviewer', trailer('reviewer', 'pass'))
    assert.equal(passed.meta.outcome, 'pass')
    assert.equal(state.tasks['users-pagination'], undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a rejection that escalated the task still sticks against a later pass of the same attempt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const routing = routingWith({ max_attempts: 1 })
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const rejected = step(state, routing, dir, 'r1', 'reviewer', `${trailer('reviewer', 'fail')}\n${finding()}`)
    assert.equal(rejected.meta.outcome, 'escalate')
    const slice = step(state, routing, dir, 'r2', 'reviewer', trailer('reviewer', 'pass'))
    assert.equal(slice.meta.outcome, 'retry')
    assert.equal(state.tasks['users-pagination'].tier, 'opus')
    assert.match(slice.message, /already rejected it/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const HANDBACK = (message) => ({ type: 'tool_use', name: 'SubagentHandback', input: { message } })
const HANDBACK_RESULT = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"success":true,"message":"Report delivered to your caller."}' }] }] },
})
const assistantRow = (blocks, id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 40 }, content: blocks } })

function hookEnv(dir) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_DATA: path.join(dir, 'data'),
    CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
    CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'cheap',
    CLAUDE_PLUGIN_OPTION_LEARN: 'off',
    CC_TIERS_CC_COST: '1',
    CC_TIERS_CC_COST_DATA: path.join(dir, 'cc-cost'),
    HOME: path.join(dir, 'home'),
  }
  delete env.CLAUDE_PROJECT_DIR
  return env
}

const run = (script, payload, env) => spawnSync(process.execPath, [path.join(ROOT, 'hooks', script)], { input: JSON.stringify(payload), encoding: 'utf8', env })

/** A background reviewer launched with `prompt`, whose verdict arrives only through SubagentHandback. */
function backgroundReview(dir, { prompt, handback, last = '' }) {
  const env = hookEnv(dir)
  run(
    'after_agent.mjs',
    {
      session_id: 'sess-1',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_use_id: 'bg-1',
      tool_input: { subagent_type: 'cc-tiers:reviewer', prompt },
      tool_response: { status: 'async_launched', agentId: 'agent-r', prompt },
    },
    env,
  )
  const file = path.join(dir, 'agent-r.jsonl')
  writeFileSync(file, [assistantRow([HANDBACK(handback)], 'm-r'), HANDBACK_RESULT].join('\n'))
  const stop = run(
    'subagent_stop.mjs',
    { session_id: 'sess-1', hook_event_name: 'SubagentStop', agent_id: 'agent-r', agent_type: 'cc-tiers:reviewer', agent_transcript_path: file, last_assistant_message: last },
    env,
  )
  assert.equal(stop.status, 0, stop.stderr)
  return { env, state: tiers.loadState(tiers.sessionPath(path.join(dir, 'data'), 'sess-1'), 'sess-1') }
}

const REVIEW_PROMPT = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: reviewer\nReview the diff.'

test('a background reviewer rejection delivered through SubagentHandback is counted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const handback = `Review done.\n${finding()}\n${trailer('reviewer', 'fail')}`
    const { env, state } = backgroundReview(dir, { prompt: REVIEW_PROMPT, handback, last: 'I handed the review back.' })
    assert.deepEqual(state.tasks['users-pagination'].failures, ['sonnet/reviewer: correctness @ src/a.js:1: closed / stays open'])
    const end = run('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false }, env)
    assert.doesNotMatch(end.stdout, /without CC_TIERS_STATUS/)
    assert.match(end.stdout, /correctness @ src\/a\.js:1/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a background reviewer that quotes a spec marker in a finding is still counted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const quoted = finding({ observed: 'the prompt opens' })
    const handback = `${quoted.replace('CC_TIERS_FINDING_END', 'CC_TIERS_SPEC_BEGIN\nCC_TIERS_FINDING_END')}\n${trailer('reviewer', 'fail')}`
    const { state } = backgroundReview(dir, { prompt: REVIEW_PROMPT, handback })
    assert.equal(state.tasks['users-pagination'].failures.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a background reviewer with no status counts a blocking finding, and asks for the verdict without one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const { state } = backgroundReview(dir, { prompt: REVIEW_PROMPT, handback: `${finding()}\n${trailer('reviewer', '')}` })
    assert.equal(state.tasks['users-pagination'].failures.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const other = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const { env } = backgroundReview(other, { prompt: REVIEW_PROMPT, handback: trailer('reviewer', '') })
    const end = run('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false }, env)
    assert.match(end.stdout, /SendMessage to the same agent/)
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})

const stopPayload = (agentId, file, last = '') => ({
  session_id: 'sess-1',
  hook_event_name: 'SubagentStop',
  agent_id: agentId,
  agent_type: 'cc-tiers:reviewer',
  agent_transcript_path: file,
  last_assistant_message: last,
})

/** One SubagentStop whose verdict arrives through SubagentHandback, like a resumed background reviewer. */
function stopWithHandback(dir, env, agentId, name, handback) {
  const file = path.join(dir, `${name}.jsonl`)
  writeFileSync(file, [assistantRow([HANDBACK(handback)], `m-${name}`), HANDBACK_RESULT].join('\n'))
  const stop = run('subagent_stop.mjs', stopPayload(agentId, file), env)
  assert.equal(stop.status, 0, stop.stderr)
  return tiers.loadState(tiers.sessionPath(path.join(dir, 'data'), 'sess-1'), 'sess-1')
}

test('a foreground reviewer that ended with no status is counted when its follow-up verdict arrives', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = hookEnv(dir)
    const launched = run(
      'after_agent.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'fg-1',
        tool_input: { subagent_type: 'cc-tiers:reviewer', prompt: REVIEW_PROMPT },
        tool_response: { status: 'completed', agentId: 'agent-f', content: [{ type: 'text', text: trailer('reviewer', '') }] },
      },
      env,
    )
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /SendMessage to the same agent/)
    const waiting = tiers.loadState(tiers.sessionPath(path.join(dir, 'data'), 'sess-1'), 'sess-1')
    assert.equal(waiting.background['agent-f'].role, 'reviewer')
    assert.equal(waiting.background['agent-f'].prompt, REVIEW_PROMPT)
    assert.equal(waiting.tasks['users-pagination'], undefined, 'no attempt counted yet')

    const state = stopWithHandback(dir, env, 'agent-f', 'follow-up', `${finding()}\n${trailer('reviewer', 'fail')}`)
    assert.deepEqual(state.tasks['users-pagination'].failures, ['sonnet/reviewer: correctness @ src/a.js:1: closed / stays open'])
    assert.equal(state.background['agent-f'], undefined, 'a counted verdict closes the registration')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a background reviewer asked again for its verdict is counted once it answers, and a silent answer asks again', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const { env, state: first } = backgroundReview(dir, { prompt: REVIEW_PROMPT, handback: trailer('reviewer', '') })
    assert.equal(first.tasks['users-pagination'], undefined)
    assert.equal(first.background['agent-r'].stops, 1, 'the silent stop keeps the agent registered')
    const again = stopWithHandback(dir, env, 'agent-r', 'second', trailer('reviewer', ''))
    assert.equal(again.tasks['users-pagination'], undefined, 'a second silent stop counts nothing')
    assert.equal(again.background['agent-r'].stops, 2)
    assert.equal(again.pending.filter((note) => /SendMessage to the same agent/.test(note)).length, 2, 'and it asks again')
    assert.deepEqual(Object.keys(again.background), ['agent-r'])

    const counted = stopWithHandback(dir, env, 'agent-r', 'third', `${finding()}\n${trailer('reviewer', 'fail')}`)
    assert.equal(counted.tasks['users-pagination'].failures.length, 1)
    assert.equal(counted.tasks['users-pagination'].tier, 'sonnet')
    assert.equal(counted.background['agent-r'], undefined)
    assert.ok(counted.seen.includes('agent:agent-r:2'), 'each stop of the agent has its own report id')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the registry of agents waiting for a verdict stays bounded', () => {
  const routing = routingWith()
  const state = tiers.emptyState('s')
  for (let index = 0; index < 80; index += 1) {
    const event = { ...agentEvent(`t${index}`, 'reviewer', trailer('reviewer', ''), REVIEW_PROMPT), agent_id: `agent-${index}` }
    tiers.applyEvent(state, event, routing)
  }
  const names = Object.keys(state.background)
  assert.equal(names.length, 50)
  assert.equal(names.at(-1), 'agent-79')
  assert.equal(names[0], 'agent-30')
})

test('the prompts state the no-status and large-diff rules, and the review agents have more turns', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    assert.match(text, /no `CC_TIERS_STATUS` line is never a pass/, file)
    assert.match(text, /`SendMessage` to its agent/, file)
    assert.match(text, /an answer with no status asks again/, file)
    assert.match(text, /Reviews of one task share its slug, and one rejection fails the writer's attempt/, file)
    assert.match(text, /more than 15 files/, file)
    assert.match(text, /one `cc-tiers:reviewer` per group of related files, plus one integration review over the whole diff, each with the spec block/, file)
  }
  assert.match(readFileSync(path.join(ROOT, 'agents/reviewer.md'), 'utf8'), /^maxTurns: 40$/m)
  assert.match(readFileSync(path.join(ROOT, 'agents/checker.md'), 'utf8'), /^maxTurns: 25$/m)
})

const workspace = await import(pathToFileURL(path.join(ROOT, 'hooks', 'workspace.mjs')).href)

test('a review of a diff over 15 changed files is told to slice, once per delegation and never for a writer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const routing = routingWith()
    const state = tiers.emptyState('s')
    state.snapshots = { 'users-pagination': workspace.workspaceSnapshot(dir) }
    for (let index = 0; index < 15; index += 1) writeFileSync(path.join(dir, `f${index}.js`), 'x\n')
    const header = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: reviewer\n'
    const delegate = (role, body) => tiers.checkDelegation(state, { subagent_type: `cc-tiers:${role}`, prompt: `${header.replace('reviewer', role)}${body}` }, routing, { projectDir: dir })
    assert.equal(delegate('reviewer', 'Review the diff.').context, '', '15 files is not large')
    writeFileSync(path.join(dir, 'f15.js'), 'x\n')
    const large = delegate('reviewer', 'Review the diff.')
    assert.match(large.context, /changed 16 files/)
    assert.match(large.context, /one cc-tiers:reviewer per group of related files, plus one integration review over the whole diff, each with the CC_TIERS_SPEC block/)
    assert.equal(delegate('reviewer', 'Review the diff.').context, large.context, 'each review delegation gets it once')
    assert.match(delegate('checker', 'Check it.').context, /diff is large/)
    assert.doesNotMatch(delegate('implementer', 'Fix it.').context, /diff is large/)
    state.snapshots = {}
    assert.equal(delegate('reviewer', 'Review the diff.').context, '', 'no stored snapshot, no note')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejections of one writer attempt count once: further slices add findings, they never escalate or stop the task', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const routing = routingWith({ max_attempts: 2 })
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const first = step(state, routing, dir, 'r1', 'reviewer', `${trailer('reviewer', 'fail')}\n${finding()}`)
    assert.equal(first.meta.outcome, 'retry')
    for (const id of ['r2', 'r3', 'r4']) {
      const again = step(state, routing, dir, id, 'reviewer', `${trailer('reviewer', 'fail')}\n${finding({ where: `src/${id}.js:1` })}`)
      assert.equal(again.meta.outcome, 'retry', id)
      assert.equal(again.meta.stillRejected, true, id)
      assert.match(again.message, /another review of this writer attempt already rejected it, so this rejection is not counted again/)
      assert.match(again.message, new RegExp(`src/${id}\\.js:1`), 'its findings reach the retry notes')
      tiers.logReport(state, again.meta)
    }
    // A slice with no status line but a blocking finding is the same: one attempt, one failure.
    const silent = step(state, routing, dir, 'r5', 'reviewer', `${trailer('reviewer', '')}\n${finding()}`)
    assert.equal(silent.meta.stillRejected, true)
    assert.doesNotMatch(silent.message, /so it counts as a failure/)
    assert.equal(state.tasks['users-pagination'].tier, 'sonnet', 'no escalation from one attempt')
    assert.equal(state.tasks['users-pagination'].failures.length, 1)
    // The next writer attempt can fail on its own: that is the second failure, and it escalates.
    const writer = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nWork.'
    step(state, routing, dir, 'w1', 'implementer', trailer('implementer', 'pass'), writer)
    const second = step(state, routing, dir, 'r6', 'reviewer', `${trailer('reviewer', 'fail')}\n${finding()}`)
    assert.equal(second.meta.outcome, 'escalate')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a reviewer waiting for its verdict does not keep a writer slot at Stop', () => {
  const state = tiers.emptyState('s')
  state.active = { 'users-pagination': { role: 'implementer', files: ['src/a.js'], at: Date.now() } }
  state.background = { a1: { role: 'reviewer', prompt: 'CC_TIERS_TASK: users-pagination\nReview it.', at: Date.now() } }
  tiers.releaseIdleWriters(state)
  assert.equal(state.active['users-pagination'], undefined)
  state.active = { 'users-pagination': { role: 'implementer', files: ['src/a.js'], at: Date.now() } }
  state.background = { a2: { role: 'implementer', prompt: 'CC_TIERS_TASK: users-pagination\nWork.', at: Date.now() } }
  tiers.releaseIdleWriters(state)
  assert.ok(state.active['users-pagination'], 'a background writer still holds its slot')
})

test('a task stopped at the Opus ceiling stays stopped when other reviews of that attempt arrive', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const routing = routingWith({ max_attempts: 1 })
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'opus', failures: [], carried: [] } }
    const first = step(state, routing, dir, 'r1', 'reviewer', `${trailer('reviewer', 'fail')}\n${finding()}`)
    assert.equal(first.meta.outcome, 'stop')
    tiers.logReport(state, first.meta)
    for (const [id, status] of [['r2', 'pass'], ['r3', 'fail']]) {
      const later = step(state, routing, dir, id, 'reviewer', `${trailer('reviewer', status)}\n${status === 'fail' ? finding({ where: 'src/b.js:2' }) : ''}`)
      assert.equal(later.meta.outcome, 'stop', id)
      assert.equal(later.meta.stillRejected, true, id)
      assert.match(later.message, /the task stopped at opus.*It stays stopped: report it to the user/s, id)
      assert.doesNotMatch(later.message, /retry/i, id)
      tiers.logReport(state, later.meta)
      assert.equal(state.log['users-pagination'].status, 'stopped', id)
    }
    assert.equal(state.log['users-pagination'].failures, 1, 'one attempt, one failure')
    assert.equal(state.events.filter((event) => event.type === 'task.stopped').length <= 1, true, 'the stop is not reported twice')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
