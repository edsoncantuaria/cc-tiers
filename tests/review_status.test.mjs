import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('a review of a task with no writer attempt on record says so, charges no tier and asks no retry', () => {
  for (const role of ['reviewer', 'checker']) {
    for (const status of ['pass', 'fail']) {
      const state = tiers.emptyState('s')
      const prepared = agentEvent('r', role, `${trailer(role, status)}\n${finding()}`)
      const applied = tiers.applyEvent(state, prepared, routingWith())
      const label = `${role} ${status}`
      assert.equal(applied.meta.outcome, 'uncounted', label)
      assert.equal(applied.meta.tier, '', label)
      assert.match(applied.message, /no writer attempt was recorded for users-pagination/, label)
      assert.match(applied.message, /writer must record its attempt .*CC_TIERS_ATTEMPT/, label)
      assert.match(applied.message, /delegated implementer or worker is recorded through its Agent call, and your own attempt through a Bash heredoc/, label)
      assert.doesNotMatch(applied.message, /retry|Retry|passed .* review/, label)
      assert.deepEqual(state.tasks, {}, label)
    }
  }
})

test('a review of a task whose writer attempt is parked, counted or logged is charged to that writer', () => {
  const parked = tiers.emptyState('s')
  parked.awaiting = [{ id: 'row:1', role: 'orchestrator', text: trailer('orchestrator', 'pass') }]
  const counted = tiers.emptyState('s')
  counted.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
  const logged = tiers.emptyState('s')
  logged.log = { 'users-pagination': { tiers: ['haiku'], attempts: 1, failures: 0, escalations: 0, reviews: [], effort: {}, status: 'done', finished: 'haiku' } }
  for (const [name, state] of Object.entries({ parked, counted, logged })) {
    const applied = tiers.applyEvent(state, agentEvent('r', 'reviewer', `${trailer('reviewer', 'pass')}`), routingWith())
    assert.notEqual(applied.meta.outcome, 'uncounted', name)
    assert.doesNotMatch(applied.message, /no writer attempt was recorded/, name)
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

/** users-pagination already has a Sonnet writer attempt on record, so its reviews are charged to it. */
function recordWriter(dir) {
  const file = tiers.sessionPath(path.join(dir, 'data'), 'sess-1')
  const state = tiers.loadState(file, 'sess-1')
  state.log['users-pagination'] = { tiers: ['sonnet'], attempts: 1, failures: 0, escalations: 0, reviews: [], effort: {}, status: 'in review', finished: '' }
  tiers.saveState(file, state)
}

const run = (script, payload, env) => spawnSync(process.execPath, [path.join(ROOT, 'hooks', script)], { input: JSON.stringify(payload), encoding: 'utf8', env })

/** A background reviewer launched with `prompt`, whose verdict arrives only through SubagentHandback. */
function backgroundReview(dir, { prompt, handback, last = '' }) {
  const env = hookEnv(dir)
  recordWriter(dir)
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
    recordWriter(dir)
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

const sessionState = (dir) => tiers.loadState(tiers.sessionPath(path.join(dir, 'data'), 'sess-1'), 'sess-1')

const WRITER_PROMPT = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_RESEARCH: none - local change\nAdd pagination.'
const RESEARCH_PROMPT = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_ROLE: researcher\nResearch the export.'

/** An Agent call that ran in the background: cc-tiers registers its agent id. */
function launchAgent(env, agentId, role, prompt) {
  const launched = run(
    'after_agent.mjs',
    {
      session_id: 'sess-1',
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_use_id: `bg-${agentId}`,
      tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
      tool_response: { status: 'async_launched', agentId, prompt },
    },
    env,
  )
  assert.equal(launched.status, 0, launched.stderr)
}

/** One SubagentStop of a background agent: `handback` is what its transcript delivers through SubagentHandback, `last` its last message. */
function stopAgent(dir, env, agentId, role, name, { handback, last = '', cwd } = {}) {
  const file = path.join(dir, `${name}.jsonl`)
  writeFileSync(file, handback === undefined ? '' : [assistantRow([HANDBACK(handback)], `m-${name}`), HANDBACK_RESULT].join('\n'))
  const stop = run('subagent_stop.mjs', { ...stopPayload(agentId, file, last), agent_type: `cc-tiers:${role}`, cwd }, env)
  assert.equal(stop.status, 0, stop.stderr)
  return sessionState(dir)
}

/** The row the main transcript gets when a background agent hands its report back (shape taken from a real session). */
const handbackRow = (agentId, text, uuid, origin = {}) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    isSidechain: false,
    uuid,
    origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'cc-tiers:implementer', handback: true, handbackReportText: text, ...origin },
    message: { role: 'user', content: [{ type: 'text', text: `${agentId} handed back its report` }] },
  })

/** A hook that scans the main transcript and counts no gate: UserPromptSubmit. */
function scanMain(env, transcript, cwd) {
  const proc = run('stop.mjs', { session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'go on', transcript_path: transcript, cwd }, env)
  assert.equal(proc.status, 0, proc.stderr)
  return proc
}

const appendRows = (file, ...rows) => appendFileSync(file, `${rows.join('\n')}\n`)

test('an agent of any role that stops with no status stays registered, so its next stop after SendMessage is its report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    // The agent hit its turn limit: its last message is prose and its transcript has no hand-back.
    const silent = stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { last: 'I ran out of turns before I could report.' })
    assert.equal(silent.background['agent-w'].stops, 1)
    assert.equal(silent.background['agent-w'].role, 'implementer')
    assert.equal(silent.background['agent-w'].prompt, WRITER_PROMPT)
    assert.equal(silent.tasks['users-pagination'], undefined, 'no attempt counted yet')
    // Resumed with SendMessage, it delivers a real report.
    const counted = stopAgent(dir, env, 'agent-w', 'implementer', 'w2', { handback: trailer('implementer', 'fail') })
    assert.equal(counted.tasks['users-pagination'].failures.length, 1)
    assert.equal(counted.background['agent-w'], undefined)
    assert.ok(counted.seen.includes('agent:agent-w:1'))

    launchAgent(env, 'agent-r', 'researcher', RESEARCH_PROMPT)
    const waiting = stopAgent(dir, env, 'agent-r', 'researcher', 'r1', { handback: trailer('researcher', '') })
    assert.equal(waiting.background['agent-r'].stops, 1)
    assert.deepEqual(waiting.researched, {})
    const researched = stopAgent(dir, env, 'agent-r', 'researcher', 'r2', { handback: trailer('researcher', 'pass') })
    assert.deepEqual(researched.researched, { 'users-pagination': true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a writer resumed after its report was counted counts its next report as a new attempt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    const first = stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: trailer('implementer', 'fail') })
    assert.equal(first.tasks['users-pagination'].failures.length, 1)
    assert.equal(first.background['agent-w'], undefined)
    // The same agent is asked to retry and reports the same way: that is the second attempt.
    const second = stopAgent(dir, env, 'agent-w', 'implementer', 'w2', { handback: trailer('implementer', 'fail') })
    assert.equal(second.tasks['users-pagination'].tier, 'opus', 'two failures on Sonnet escalate')
    assert.equal(second.log['users-pagination'].attempts, 2)
    assert.ok(second.seen.includes('agent:agent-w:1'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a writer retried by SendMessage after a review rejected it is a new attempt, not the rejected one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off', CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'always' }
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    const passed = stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: trailer('implementer', 'pass') })
    assert.equal(passed.log['users-pagination'].status, 'in review')
    launchAgent(env, 'agent-v', 'reviewer', REVIEW_PROMPT)
    const rejected = stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { handback: `${finding()}\n${trailer('reviewer', 'fail')}` })
    assert.equal(rejected.tasks['users-pagination'].rejected, true)
    assert.equal(rejected.tasks['users-pagination'].failures.length, 1)
    const retried = stopAgent(dir, env, 'agent-w', 'implementer', 'w2', { handback: trailer('implementer', 'pass') })
    assert.equal(retried.tasks['users-pagination'].rejected, undefined, 'the retry is judged on its own')
    assert.equal(retried.log['users-pagination'].attempts, 2, 'the writer and its retry')
    assert.match(retried.pending.at(-1), /passed on sonnet/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** The Stop hook: judges and gates what is parked, then asks the orchestrator to continue. */
function endTurn(env, transcript, cwd) {
  const proc = run('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', transcript_path: transcript, cwd, stop_hook_active: false }, env)
  assert.equal(proc.status, 0, proc.stderr)
  return proc
}

/** A project whose allowed check appends to `out` on each run, so a test can count the gate runs; `text` is a writer pass that declares it. */
function gateProject(dir) {
  const project = path.join(dir, 'project')
  mkdirSync(project)
  writeFileSync(path.join(project, 'probe.mjs'), "import { appendFileSync } from 'node:fs'\nappendFileSync(process.argv[2], 'ran')\n")
  const out = path.join(dir, 'probe-out')
  const env = { ...hookEnv(dir), CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node probe.mjs' }
  return { project, out, env, text: trailer('implementer', 'pass', ['CC_TIERS_REVIEW: skip', `CC_TIERS_VERIFY: node probe.mjs ${out}`]) }
}

test('a peer hand-back row in the main transcript counts as its agent\'s report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    recordWriter(dir)
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, '')
    launchAgent(env, 'agent-r', 'researcher', RESEARCH_PROMPT)
    launchAgent(env, 'agent-v', 'reviewer', REVIEW_PROMPT)
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT.replace('users-pagination', 'csv-export'))
    // SubagentStop of each saw no status; the report reaches the main transcript afterwards.
    for (const [id, role] of [['agent-r', 'researcher'], ['agent-v', 'reviewer'], ['agent-w', 'implementer']]) {
      assert.equal(stopAgent(dir, env, id, role, `${id}-1`, { last: 'handed back' }).background[id].stops, 1)
    }
    appendRows(
      transcript,
      handbackRow('agent-r', trailer('researcher', 'pass'), 'u1', { name: 'cc-tiers:researcher' }),
      handbackRow('agent-v', `${finding()}\n${trailer('reviewer', 'fail')}`, 'u2', { name: 'cc-tiers:reviewer' }),
      handbackRow('agent-w', trailer('implementer', 'fail').replace('users-pagination', 'csv-export'), 'u3'),
    )
    // The next delegation is checked after the row is read: research counts at once.
    const delegation = run(
      'before_agent.mjs',
      { session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Agent', transcript_path: transcript, tool_input: { subagent_type: 'cc-tiers:implementer', prompt: `${WRITER_PROMPT.replace('none - local change', 'done')}` } },
      env,
    )
    assert.equal(delegation.status, 0, delegation.stderr)
    assert.doesNotMatch(delegation.stdout, /no finished research/)
    const parked = sessionState(dir)
    assert.deepEqual(parked.researched, { 'users-pagination': true })
    assert.deepEqual(parked.awaiting.map((item) => item.id), ['agent:agent-v:1', 'agent:agent-w:1'], 'a verdict waits for Stop, where it is judged')
    assert.deepEqual(parked.tasks, {})

    endTurn(env, transcript)
    const state = sessionState(dir)
    assert.equal(state.log['users-pagination'].failures, 1, 'the review verdict is counted')
    assert.equal(state.log['csv-export'].failures, 1, 'the writer failure is counted')
    assert.deepEqual(state.awaiting, [])
    for (const id of ['agent-r', 'agent-v', 'agent-w']) assert.equal(state.background[id], undefined, id)
    assert.ok(state.seen.includes('agent:agent-w:1'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a writer pass in a hand-back row waits for the Stop gate like a stop does', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const { project, out, env, text } = gateProject(dir)
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, `${handbackRow('agent-w', text, 'u1')}\n`)
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    scanMain(env, transcript, project)
    const parked = sessionState(dir)
    assert.equal(existsSync(out), false, 'the gate does not run in a PreToolUse-time hook')
    assert.equal(parked.tasks['users-pagination'], undefined, 'not counted before its gate')
    assert.deepEqual(
      parked.awaiting.map((item) => ({ id: item.id, role: item.role, agent_id: item.agent_id, prompt: item.prompt, text: item.text })),
      [{ id: 'agent:agent-w', role: 'implementer', agent_id: 'agent-w', prompt: WRITER_PROMPT, text }],
    )
    assert.ok(parked.awaiting[0].launchedAt > 0)
    assert.ok(parked.background['agent-w'], 'the agent stays registered until its report is counted')

    const end = endTurn(env, transcript, project)
    assert.equal(readFileSync(out, 'utf8'), 'ran')
    assert.match(JSON.parse(end.stdout).reason, /cc-tiers gate: users-pagination verified: node probe\.mjs/)
    const state = sessionState(dir)
    assert.deepEqual(state.awaiting, [])
    assert.equal(state.log['users-pagination'].attempts, 1)
    assert.equal(state.background['agent-w'], undefined)
    assert.equal(state.finished['agent-w'].role, 'implementer')

    // Its own SubagentStop, arriving after, neither runs the gate again nor counts it twice.
    const after = stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: text, cwd: project })
    assert.equal(readFileSync(out, 'utf8'), 'ran')
    assert.equal(after.log['users-pagination'].attempts, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the stop of an agent counts its report first and drops the parked hand-back row', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const { project, out, env, text } = gateProject(dir)
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, `${handbackRow('agent-w', text, 'u1')}\n`)
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    scanMain(env, transcript, project)
    assert.equal(sessionState(dir).awaiting.length, 1)

    const counted = stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: text, cwd: project })
    assert.equal(readFileSync(out, 'utf8'), 'ran')
    assert.equal(counted.log['users-pagination'].attempts, 1)
    assert.deepEqual(counted.awaiting, [], 'the row is dropped')

    endTurn(env, transcript, project)
    assert.equal(readFileSync(out, 'utf8'), 'ran', 'Stop does not gate it again')
    assert.equal(sessionState(dir).log['users-pagination'].attempts, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the same report from SubagentStop and from the main transcript is counted once, in either order', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, '')
    const forTask = (text, task) => text.replace('users-pagination', task)
    const text = trailer('implementer', 'fail')

    // SubagentStop first, the row after.
    launchAgent(env, 'agent-a', 'implementer', WRITER_PROMPT)
    assert.equal(stopAgent(dir, env, 'agent-a', 'implementer', 'a1', { handback: text }).tasks['users-pagination'].failures.length, 1)
    appendRows(transcript, handbackRow('agent-a', text, 'u1'))
    scanMain(env, transcript)
    endTurn(env, transcript)
    assert.equal(sessionState(dir).tasks['users-pagination'].failures.length, 1, 'the row repeats the stop')

    // The row first, then SubagentStop counts it and drops the row, so Stop has nothing left.
    launchAgent(env, 'agent-b', 'implementer', forTask(WRITER_PROMPT, 'csv-export'))
    const other = forTask(text, 'csv-export')
    appendRows(transcript, handbackRow('agent-b', other, 'u2'))
    scanMain(env, transcript)
    assert.equal(sessionState(dir).tasks['csv-export'], undefined)
    assert.equal(stopAgent(dir, env, 'agent-b', 'implementer', 'b1', { handback: other }).tasks['csv-export'].failures.length, 1)
    endTurn(env, transcript)
    assert.equal(sessionState(dir).tasks['csv-export'].failures.length, 1)

    // The row first, Stop counts it, then SubagentStop is not counted again.
    launchAgent(env, 'agent-c', 'implementer', forTask(WRITER_PROMPT, 'report-export'))
    const third = forTask(text, 'report-export')
    appendRows(transcript, handbackRow('agent-c', third, 'u3'))
    scanMain(env, transcript)
    endTurn(env, transcript)
    assert.equal(sessionState(dir).tasks['report-export'].failures.length, 1)
    assert.equal(stopAgent(dir, env, 'agent-c', 'implementer', 'c1', { handback: third }).tasks['report-export'].failures.length, 1)

    // A resumed run that reports the same text is a new attempt: the pair was already matched.
    assert.equal(stopAgent(dir, env, 'agent-c', 'implementer', 'c2', { handback: third }).tasks['report-export'].tier, 'opus')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** The frame the harness puts around a hand-back: a preamble, then the report with every line indented (shape taken from a real session). */
const handbackBody = (text) =>
  `[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n${text.split('\n').map((line) => `  ${line}`).join('\n')}`

/** A hand-back that arrives while the session is mid-turn: a queued_command attachment, with no handbackReportText. */
const queuedHandbackRow = (agentId, text, uuid) =>
  JSON.stringify({
    type: 'attachment',
    isSidechain: false,
    uuid,
    attachment: {
      type: 'queued_command',
      prompt: `<agent-message from="${agentId}">\n${handbackBody(text)}\n</agent-message>`,
      commandMode: 'prompt',
      origin: { kind: 'peer', from: agentId, senderTaskId: agentId, body: handbackBody(text), handback: true },
      isMeta: true,
    },
  })

test('a hand-back queued mid-turn or carried only in origin.body counts as its agent\'s report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, '')
    launchAgent(env, 'agent-r', 'researcher', RESEARCH_PROMPT)
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT.replace('users-pagination', 'csv-export'))
    // Each SubagentStop saw no status: the hand-back was not in the agent transcript yet.
    stopAgent(dir, env, 'agent-r', 'researcher', 'r1', { last: '' })
    stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { last: '' })
    const research = trailer('researcher', 'pass')
    const writer = trailer('implementer', 'fail').replace('users-pagination', 'csv-export')
    appendRows(
      transcript,
      queuedHandbackRow('agent-r', research, 'q1'),
      handbackRow('agent-w', writer, 'u1', { handbackReportText: undefined, body: handbackBody(writer) }),
    )
    scanMain(env, transcript)
    assert.deepEqual(sessionState(dir).researched, { 'users-pagination': true })
    endTurn(env, transcript)
    const state = sessionState(dir)
    assert.equal(state.tasks['csv-export'].failures.length, 1)
    assert.equal(state.log['csv-export'].failures, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('SubagentStop reads the hand-back, not a reworded last message, so the row of that report is its twin', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, '')
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    const handed = trailer('implementer', 'fail', ['CC_TIERS_REASON: make lint nao rodou no catalogo'])
    const last = trailer('implementer', 'fail', ['CC_TIERS_REASON: make lint não rodou no catálogo'])
    assert.equal(stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: handed, last }).tasks['users-pagination'].failures.length, 1)
    appendRows(transcript, handbackRow('agent-w', handed, 'u1'))
    endTurn(env, transcript)
    assert.equal(sessionState(dir).tasks['users-pagination'].failures.length, 1, 'the row repeats the stop')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('agentHandbackReport reads only the latest run: a hand-back before a SendMessage resume is not the next stop\'s report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const file = path.join(dir, 'agent.jsonl')
    // Shapes taken from real subagent transcripts: a harness nudge (no origin) stays in the run, a SendMessage (coordinator) starts a new one.
    const nudge = JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '[Your previous response had no visible output.]' } })
    const resumed = JSON.stringify({ type: 'user', isMeta: true, origin: { kind: 'coordinator' }, message: { role: 'user', content: 'Your report had no status. Send only the trailer.' } })
    writeFileSync(file, `${[assistantRow([HANDBACK(trailer('implementer', 'fail'))], 'm1'), HANDBACK_RESULT, nudge].join('\n')}\n`)
    assert.match(tiers.agentHandbackReport(file), /STATUS: fail/)
    appendRows(file, resumed)
    assert.equal(tiers.agentHandbackReport(file), '')
    appendRows(file, assistantRow([HANDBACK(trailer('implementer', 'pass'))], 'm2'))
    assert.match(tiers.agentHandbackReport(file), /STATUS: pass/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('SubagentStop waits briefly for a hand-back the agent transcript has not written yet', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    launchAgent(env, 'agent-r', 'researcher', RESEARCH_PROMPT)
    const file = path.join(dir, 'r1.jsonl')
    writeFileSync(file, '')
    const child = spawn(process.execPath, [path.join(ROOT, 'hooks', 'subagent_stop.mjs')], { env, stdio: ['pipe', 'ignore', 'pipe'] })
    child.stdin.end(JSON.stringify({ ...stopPayload('agent-r', file, ''), agent_type: 'cc-tiers:researcher' }))
    setTimeout(() => writeFileSync(file, [assistantRow([HANDBACK(trailer('researcher', 'pass'))], 'm-r1'), HANDBACK_RESULT].join('\n')), 300)
    const code = await new Promise((resolve) => child.on('close', resolve))
    assert.equal(code, 0)
    assert.deepEqual(sessionState(dir).researched, { 'users-pagination': true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('SubagentStop of an agent cc-tiers did not launch in the background does not wait for a hand-back', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    const file = path.join(dir, 'x1.jsonl')
    writeFileSync(file, '')
    const started = Date.now()
    const stop = run('subagent_stop.mjs', { ...stopPayload('agent-x', file, 'done, no trailer'), agent_type: 'cc-tiers:reviewer' }, env)
    assert.equal(stop.status, 0, stop.stderr)
    // The wait is 10 x 200 ms; a hook that skips it ends well before that.
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a reviewer verdict with no evidenced finding counts the same whichever path brings it', async () => {
  const verdict = trailer('reviewer', 'fail')
  const outcome = async (order) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
    try {
      const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off', CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'always' }
      const transcript = path.join(dir, 'main.jsonl')
      writeFileSync(transcript, '')
      launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
      stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: trailer('implementer', 'pass') })
      launchAgent(env, 'agent-v', 'reviewer', REVIEW_PROMPT)
      const row = () => {
        appendRows(transcript, handbackRow('agent-v', verdict, 'u1', { name: 'cc-tiers:reviewer' }))
        scanMain(env, transcript)
      }
      if (order === 'row then stop') {
        row()
        stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { handback: verdict })
      } else if (order === 'row then Stop hook') {
        row()
        endTurn(env, transcript)
      } else if (order === 'silent stop, row, Stop hook') {
        stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { last: 'handed back' })
        row()
        endTurn(env, transcript)
      } else {
        stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { handback: verdict })
      }
      return sessionState(dir).log['users-pagination'].status
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  assert.equal(await outcome('stop only'), 'done')
  for (const order of ['row then stop', 'row then Stop hook', 'silent stop, row, Stop hook']) assert.equal(await outcome(order), 'done', order)
})

test('the agent spend is charged whichever path counted the report first', async () => {
  const spendOf = async (order, role, prompt, text) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
    try {
      const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
      const transcript = path.join(dir, 'main.jsonl')
      writeFileSync(transcript, '')
      launchAgent(env, 'agent-x', role, prompt)
      if (order !== 'stop only') {
        appendRows(transcript, handbackRow('agent-x', text, 'u1', { name: `cc-tiers:${role}` }))
        scanMain(env, transcript)
      }
      if (order === 'row then Stop hook') endTurn(env, transcript)
      const state = stopAgent(dir, env, 'agent-x', role, 'x1', { handback: text })
      return state.spend['users-pagination']
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  const expected = { haiku: 0, sonnet: 40, opus: 0 }
  const writer = trailer('implementer', 'fail')
  assert.deepEqual(await spendOf('stop only', 'implementer', WRITER_PROMPT, writer), expected)
  assert.deepEqual(await spendOf('row then stop', 'implementer', WRITER_PROMPT, writer), expected)
  assert.deepEqual(await spendOf('row then Stop hook', 'implementer', WRITER_PROMPT, writer), expected)
  // Research is counted from the row at once, so its stop only charges the spend.
  assert.deepEqual(await spendOf('row then stop', 'researcher', RESEARCH_PROMPT, trailer('researcher', 'pass')), expected)
})

test('a stop with no status after its row counted or parked the report adds no message and no re-registration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    recordWriter(dir)
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(transcript, '')
    launchAgent(env, 'agent-r', 'researcher', RESEARCH_PROMPT)
    launchAgent(env, 'agent-v', 'reviewer', REVIEW_PROMPT)
    appendRows(
      transcript,
      handbackRow('agent-r', trailer('researcher', 'pass'), 'u1', { name: 'cc-tiers:researcher' }),
      handbackRow('agent-v', `${finding()}\n${trailer('reviewer', 'fail')}`, 'u2', { name: 'cc-tiers:reviewer' }),
    )
    scanMain(env, transcript)

    // The researcher's row was counted, the reviewer's waits for Stop: neither stop asks for a report again.
    const state = stopAgent(dir, env, 'agent-r', 'researcher', 'r1', { last: 'handed back' })
    stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { last: 'handed back' })
    const silent = sessionState(dir)
    assert.equal(state.background['agent-r'], undefined)
    assert.equal(silent.background['agent-r'], undefined)
    assert.equal(silent.background['agent-v'].stops, undefined)
    assert.deepEqual(silent.pending, [])
    assert.equal(silent.awaiting.length, 1)

    endTurn(env, transcript)
    const counted = sessionState(dir)
    assert.equal(counted.log['users-pagination'].failures, 1)
    assert.equal(counted.background['agent-v'], undefined)
    assert.deepEqual(counted.awaiting, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a hand-back row from an unknown agent, a non-handback peer row, or a row with no status is ignored', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-status-'))
  try {
    const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off' }
    const transcript = path.join(dir, 'main.jsonl')
    launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
    const text = trailer('implementer', 'fail')
    writeFileSync(
      transcript,
      [
        handbackRow('never-launched', text, 'u1'),
        handbackRow('agent-w', text, 'u2', { handback: false }),
        handbackRow('agent-w', text, 'u3', { kind: 'user' }),
        handbackRow('agent-w', trailer('implementer', ''), 'u4'),
        handbackRow('agent-w', text, 'u5', { handbackReportText: undefined }),
        JSON.stringify({ ...JSON.parse(handbackRow('agent-w', text, 'u6')), isSidechain: true }),
      ].join('\n') + '\n',
    )
    scanMain(env, transcript)
    const state = sessionState(dir)
    assert.deepEqual(state.tasks, {})
    assert.ok(state.background['agent-w'], 'the agent still waits for its report')
    assert.equal(state.background['agent-w'].stops, undefined)
    assert.equal(state.finished['never-launched'], undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the finished agents a later stop can count are bounded like the running ones', () => {
  const routing = routingWith()
  const ctx = { routing, projectDir: '', ccCost: false }
  const state = tiers.emptyState('s')
  for (let index = 0; index < 80; index += 1) {
    const id = `agent-${index}`
    tiers.applyEvent(state, { kind: 'background', agent_id: id, role: 'implementer', prompt: REVIEW_PROMPT.replace('reviewer', 'implementer'), session_id: 's' }, routing)
    tiers.processAgentReport(ctx, state, tiers.agentReport(id, state.background[id], trailer('implementer', 'fail')))
  }
  assert.deepEqual(state.background, {})
  const names = Object.keys(state.finished)
  assert.equal(names.length, 50)
  assert.equal(names.at(-1), 'agent-79')
  assert.equal(names[0], 'agent-30')
})

test('a writer that stopped with no status is idle: Stop releases its task slot', () => {
  const state = tiers.emptyState('s')
  state.active = { 'users-pagination': { role: 'implementer', files: ['src/a.js'], at: Date.now() } }
  state.background = { a1: { role: 'implementer', prompt: 'CC_TIERS_TASK: users-pagination\nWork.', at: Date.now(), stops: 1 } }
  tiers.releaseIdleWriters(state)
  assert.equal(state.active['users-pagination'], undefined)
})

test('a reviewer rejection that arrives by the hand-back row is charged to the writer tier whichever path brings it', async () => {
  const outcome = async (order) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-tier-'))
    try {
      const env = { ...hookEnv(dir), CLAUDE_PLUGIN_OPTION_VERIFY: 'off', CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'always' }
      const transcript = path.join(dir, 'main.jsonl')
      writeFileSync(transcript, '')
      launchAgent(env, 'agent-w', 'implementer', WRITER_PROMPT)
      stopAgent(dir, env, 'agent-w', 'implementer', 'w1', { handback: trailer('implementer', 'pass') })
      launchAgent(env, 'agent-v', 'reviewer', REVIEW_PROMPT)
      const verdict = `${finding()}\n${trailer('reviewer', 'fail')}`
      if (order === 'row then Stop hook') {
        appendRows(transcript, handbackRow('agent-v', verdict, 'u1', { name: 'cc-tiers:reviewer' }))
        scanMain(env, transcript)
        endTurn(env, transcript)
      } else if (order === 'row then stop') {
        appendRows(transcript, handbackRow('agent-v', verdict, 'u1', { name: 'cc-tiers:reviewer' }))
        scanMain(env, transcript)
        stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { handback: verdict })
      } else {
        stopAgent(dir, env, 'agent-v', 'reviewer', 'v1', { handback: verdict })
      }
      const s = sessionState(dir)
      return { tier: s.tasks['users-pagination'].tier, failures: s.tasks['users-pagination'].failures }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  const base = await outcome('stop only')
  assert.equal(base.tier, 'sonnet')
  for (const order of ['row then Stop hook', 'row then stop']) {
    const got = await outcome(order)
    assert.deepEqual(got, base, order)
  }
})

test('a review rejection counted from its parked row judges the writer attempts parked before it, not a new attempt parked after it', () => {
  const routing = routingWith({ verify: 'on' })
  const ctx = { routing, ccCost: false, projectDir: '' }
  const state = tiers.emptyState('s')
  const head = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus'
  const attempt = (reason) => `${head}\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_VERIFY: none - x\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: ${reason}`
  const prompt = 'CC_TIERS_TASK: users-pagination\nreview it'
  const verdict = `${head}\nCC_TIERS_ROLE: reviewer\n${finding()}\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: off by one`
  const { kind, ...review } = tiers.agentReport('R', { role: 'reviewer', prompt, at: 1 }, verdict)
  state.background.R = { role: 'reviewer', prompt, at: 1 }
  state.awaiting = [{ id: 'row:u1', role: 'orchestrator', text: attempt('first') }, review, { id: 'row:u3', role: 'orchestrator', text: attempt('fixed the off by one') }]
  const [first, rejection, second] = tiers.prepareParked(ctx, tiers.peekAwaiting(state), {})
  assert.equal(second.gate.status, 'unverified', 'the later attempt has its own gate')

  assert.match(tiers.countParked(ctx, state, first), /Send the result to cc-tiers:reviewer/)
  assert.match(tiers.countParked(ctx, state, rejection), /counted a failure for users-pagination/)
  assert.deepEqual(state.tasks['users-pagination'].judged, ['row:u1'], 'only the attempt parked before the review')
  const message = tiers.countParked(ctx, state, second)
  assert.doesNotMatch(message, /not a new attempt/)
  assert.match(message, /Send the result to cc-tiers:reviewer/)
  assert.equal(state.tasks['users-pagination'].rejected, undefined, 'the new attempt clears the rejection')
  assert.equal(state.tasks['users-pagination'].failures.length, 1)
  assert.deepEqual(state.evidence['users-pagination'].gate.unverified.map((item) => item.reason), ['no project dir'], 'its gate is kept as evidence')
})
