import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Whole sessions driven hook by hook, as real processes, over a real transcript file: state bugs that only
// show across hooks (twin reports, a restart, a lost state file) surface here, not in real use.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)

const SESSION = 'sess-1'
const TASK = 'users-pagination'

const trailer = (role, status, extra = []) =>
  [`CC_TIERS_TASK: ${TASK}`, 'CC_TIERS_TIER: sonnet', `CC_TIERS_ROLE: ${role}`, ...extra, ...(status ? [`CC_TIERS_STATUS: ${status}`] : []), 'CC_TIERS_REASON: found'].join('\n')

function finding(fields = {}) {
  const base = { category: 'correctness', severity: 'blocking', evidence: 'trace', where: 'src/users.js:1', expected: 'the slot is freed', observed: 'the slot stays taken' }
  return ['CC_TIERS_FINDING_BEGIN', ...Object.entries({ ...base, ...fields }).map(([key, value]) => `${key}: ${value}`), 'CC_TIERS_FINDING_END'].join('\n')
}

const SPEC = 'CC_TIERS_SPEC_BEGIN\nCriteria:\n- the slot is freed (request)\nCC_TIERS_SPEC_END'
const WRITER_PROMPT = `CC_TIERS_TASK: ${TASK}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_RESEARCH: none - local change\n${SPEC}\nAdd pagination to src/users.js.`
const REVIEW_PROMPT = `CC_TIERS_TASK: ${TASK}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: reviewer\n${SPEC}\nReview the diff.`

const HANDBACK = (message) => ({ type: 'tool_use', name: 'SubagentHandback', input: { message } })
const HANDBACK_RESULT = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"success":true,"message":"Report delivered to your caller."}' }] }] },
})

let rows = 0
const uuid = () => `row-${(rows += 1)}`
const assistantRow = (blocks, id) => JSON.stringify({ type: 'assistant', uuid: uuid(), message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 40 }, content: blocks } })

/** The row the main transcript gets when a background agent hands its report back (shape taken from a real session). */
const handbackRow = (agentId, text) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    isSidechain: false,
    uuid: uuid(),
    origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'cc-tiers:implementer', handback: true, handbackReportText: text },
    message: { role: 'user', content: [{ type: 'text', text: `${agentId} handed back its report` }] },
  })

const appendRows = (file, ...lines) => appendFileSync(file, `${lines.join('\n')}\n`)

function hookEnv(dir, extra = {}) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_DATA: path.join(dir, 'data'),
    CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
    CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'always',
    CLAUDE_PLUGIN_OPTION_LEARN: 'off',
    CC_TIERS_CC_COST: '1',
    CC_TIERS_CC_COST_DATA: path.join(dir, 'cc-cost'),
    HOME: path.join(dir, 'home'),
    ...extra,
  }
  delete env.CLAUDE_PROJECT_DIR
  return env
}

/** A project whose allowed check appends to a file on each run, so a test can count the gate runs. */
function gateProject(dir) {
  const project = path.join(dir, 'project')
  mkdirSync(project)
  writeFileSync(path.join(project, 'probe.mjs'), "import { appendFileSync } from 'node:fs'\nappendFileSync(process.argv[2], 'ran')\n")
  const out = path.join(dir, 'probe-out')
  const ran = () => (existsSync(out) ? readFileSync(out, 'utf8').length / 'ran'.length : 0)
  const env = hookEnv(dir, { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node probe.mjs' })
  const report = (status = 'pass') => trailer('implementer', status, ['CC_TIERS_REVIEW: skip', `CC_TIERS_VERIFY: node probe.mjs ${out}`])
  return { project, env, ran, report }
}

const run = (script, payload, env) => spawnSync(process.execPath, [path.join(ROOT, 'hooks', script)], { input: JSON.stringify(payload), encoding: 'utf8', env })

function ok(proc) {
  assert.equal(proc.status, 0, proc.stderr)
  return proc
}

/** What a hook told Claude: its additional context, the block reason or the system message. */
function said(proc) {
  if (!proc.stdout.trim()) return ''
  const out = JSON.parse(proc.stdout)
  return [out.hookSpecificOutput?.additionalContext, out.reason, out.systemMessage].filter(Boolean).join('\n')
}

const stateOf = (dir, id = SESSION) => tiers.loadState(tiers.sessionPath(path.join(dir, 'data'), id), id)

/** The telemetry events cc-tiers flushed. */
const events = (dir) => {
  const file = path.join(dir, 'data', 'events.jsonl')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
}

/** One session: each method fires the hook Claude Code would, and the rows it would write reach the main transcript. */
function session(dir, env, { id = SESSION, project = '' } = {}) {
  const transcript = path.join(dir, `${id}.jsonl`)
  writeFileSync(transcript, '')
  mkdirSync(path.join(dir, 'agents'), { recursive: true })
  const base = { session_id: id, transcript_path: transcript, cwd: project }
  const stopPayload = { ...base, hook_event_name: 'Stop', stop_hook_active: false }
  const api = {
    transcript,
    state: () => stateOf(dir, id),
    start(source = 'startup') {
      const proc = ok(run('session_start.mjs', { ...base, hook_event_name: 'SessionStart', source }, env))
      appendRows(transcript, JSON.stringify({ type: 'attachment', uuid: uuid(), attachment: { hookName: `SessionStart:${source}`, stdout: proc.stdout } }))
      return proc
    },
    before(role, prompt, toolUseId = uuid()) {
      appendRows(transcript, assistantRow([{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: `cc-tiers:${role}`, prompt } }], `m-${toolUseId}`))
      return ok(run('before_agent.mjs', { ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { subagent_type: `cc-tiers:${role}`, prompt } }, env))
    },
    after(role, prompt, response, toolUseId) {
      const proc = ok(run('after_agent.mjs', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { subagent_type: `cc-tiers:${role}`, prompt }, tool_response: response }, env))
      const text = response.content?.map((block) => block.text).join('\n') || response.status
      appendRows(transcript, JSON.stringify({ type: 'user', uuid: uuid(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] } }))
      return proc
    },
    /** An Agent call that ran in the foreground and returned `text`. */
    foreground: (role, prompt, agentId, text, toolUseId) => api.after(role, prompt, { status: 'completed', agentId, content: [{ type: 'text', text }] }, toolUseId),
    /** An Agent call that ran in the background: cc-tiers registers its agent id. */
    launch: (role, prompt, agentId) => api.after(role, prompt, { status: 'async_launched', agentId, prompt }, `bg-${agentId}`),
    /** One SubagentStop; `handback` is what the agent's own transcript delivers through SubagentHandback. */
    subagentStop(agentId, role, { handback, last = '', stopActive = false, name = `${agentId}-stop` } = {}) {
      // Neither a hand-back nor a status in the last message would make the hook wait 2 s for one.
      assert.ok(handback !== undefined || tiers.parseHeaders(last).STATUS, 'a SubagentStop with nothing to read would wait 2 s')
      const file = path.join(dir, 'agents', `${name}.jsonl`)
      writeFileSync(file, handback === undefined ? '' : [assistantRow([HANDBACK(handback)], `m-${name}`), HANDBACK_RESULT].join('\n'))
      return ok(run('subagent_stop.mjs', { ...base, hook_event_name: 'SubagentStop', agent_id: agentId, agent_type: `cc-tiers:${role}`, agent_transcript_path: file, last_assistant_message: last, stop_hook_active: stopActive }, env))
    },
    /** The main transcript gets the hand-back row of a background agent. */
    handBack: (agentId, text) => appendRows(transcript, handbackRow(agentId, text)),
    /** A hook that scans the main transcript and gates nothing: UserPromptSubmit. */
    prompt: () => ok(run('stop.mjs', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }, env)),
    stop: () => ok(run('stop.mjs', stopPayload, env)),
    /** A Stop that has not ended yet: the caller can kill it while its gate runs. */
    startStop() {
      const child = spawn(process.execPath, [path.join(ROOT, 'hooks', 'stop.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
      child.stdin.end(JSON.stringify(stopPayload))
      return child
    },
  }
  return api
}

test('a session from start to Stop: delegation, a writer pass, a review rejection, a retry, a review pass', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { project, env, ran, report } = gateProject(dir)
    const pass = report().replace('CC_TIERS_REVIEW: skip\n', 'CC_TIERS_CRITERION: C1 pass - the slot is freed, shown by the probe\n')
    const s = session(dir, env, { project })

    assert.match(said(s.start()), /cc-tiers routing is active/)

    // The delegation is checked and passes; the writer's pass is gated and sent to review.
    const delegated = JSON.parse(s.before('implementer', WRITER_PROMPT).stdout)
    assert.notEqual(delegated.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(delegated.hookSpecificOutput.updatedInput.prompt, /CC_TIERS_CONTEXT_BEGIN/)
    const written = said(s.foreground('implementer', WRITER_PROMPT, 'agent-w1', pass, 'fg-1'))
    assert.match(written, /cc-tiers gate: users-pagination verified: node probe\.mjs/)
    assert.match(written, /Send the result to cc-tiers:reviewer/)
    assert.equal(ran(), 1)
    assert.equal(s.state().log[TASK].status, 'in review')

    // The review rejects it with a blocking finding that carries its evidence: one failure, and a retry is asked for.
    s.before('reviewer', REVIEW_PROMPT)
    const rejected = said(s.foreground('reviewer', REVIEW_PROMPT, 'agent-r1', `${finding()}\n${trailer('reviewer', 'fail')}`, 'fg-2'))
    assert.match(rejected, /counted a failure for users-pagination/)
    assert.match(rejected, /Retry on sonnet \(cc-tiers:implementer\)/)
    assert.equal(s.state().tasks[TASK].failures.length, 1)
    assert.equal(s.state().tasks[TASK].rejected, true)

    // The retry runs in the background: its SubagentStop counts the pass and gates it, and its hand-back row repeats it.
    const retry = `${WRITER_PROMPT}\nFailure notes:\n1. ${s.state().tasks[TASK].failures[0]}`
    s.before('implementer', retry)
    s.launch('implementer', retry, 'agent-w2')
    s.subagentStop('agent-w2', 'implementer', { handback: pass })
    assert.equal(ran(), 2)
    assert.equal(s.state().tasks[TASK].rejected, undefined, 'the retry is judged on its own')
    assert.match(s.state().pending.at(-1), /passed on sonnet/)
    s.handBack('agent-w2', pass)

    // The review passes: the task finishes with its one failure, and what was counted waits no more at Stop.
    const review = said(s.before('reviewer', REVIEW_PROMPT))
    assert.match(review, /Send the result to cc-tiers:reviewer/, 'the queued retry report reaches the next delegation')
    const finished = said(s.foreground('reviewer', REVIEW_PROMPT, 'agent-r2', trailer('reviewer', 'pass'), 'fg-3'))
    assert.match(finished, /Task users-pagination passed Opus review/)
    assert.match(finished, /cc-tiers completion: users-pagination verified on sonnet after 1 failed attempt/)
    assert.match(finished, /Criteria with evidence: 1\/1/)

    const ends = s.stop()
    assert.equal(said(ends), '', 'nothing is left to say')
    assert.equal(ran(), 2, 'Stop gates nothing again')
    const state = s.state()
    assert.deepEqual(state.tasks, {})
    assert.deepEqual(state.awaiting, [])
    assert.equal(state.log[TASK].status, 'done')
    assert.equal(state.log[TASK].failures, 1)
    assert.equal(state.log[TASK].attempts, 2)
    assert.equal(state.log[TASK].completion, 'verified')
    assert.ok(events(dir).some((event) => event.type === 'task.passed' && event.task === TASK))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** A writer pass parked from its hand-back row behind a review that still runs in the background. */
function parkedBehindReview(dir) {
  const { project, env, ran, report } = gateProject(dir)
  const s = session(dir, env, { project })
  s.start()
  s.launch('implementer', WRITER_PROMPT, 'agent-w')
  s.launch('reviewer', REVIEW_PROMPT, 'agent-v')
  s.handBack('agent-w', report())
  s.prompt()
  assert.equal(s.state().awaiting.length, 1)
  assert.match(said(s.stop()), /cc-tiers gate: users-pagination waits: a review \(agent-v\) is still running/)
  assert.equal(ran(), 0)
  return { s, ran }
}

test('a resumed session no longer waits for the background review of the process that died', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { s, ran } = parkedBehindReview(dir)
    s.start('resume')
    assert.equal(s.state().background['agent-v'].stops, 1, 'the dead reviewer is stopped, with no report counted')
    const end = said(s.stop())
    assert.doesNotMatch(end, /waits: a review/)
    assert.match(end, /cc-tiers gate: users-pagination verified: node probe\.mjs/)
    assert.equal(ran(), 1)
    assert.deepEqual(s.state().awaiting, [])
    assert.equal(s.state().log[TASK].attempts, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a compacted session still waits for its background review, which keeps running', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { s, ran } = parkedBehindReview(dir)
    s.start('compact')
    assert.equal(s.state().background['agent-v'].stops, undefined)
    assert.match(said(s.stop()), /waits: a review \(agent-v\)/)
    assert.equal(ran(), 0)
    assert.equal(s.state().awaiting.length, 1, 'the pass stays parked')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a fork carries the task records of its parent, never folds the rows it copied, and leaves the parent state alone', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { project, env } = gateProject(dir)
    const parent = session(dir, env, { id: 'parent', project })
    parent.start()
    parent.before('implementer', WRITER_PROMPT)
    parent.foreground('implementer', WRITER_PROMPT, 'agent-w', trailer('implementer', 'fail'), 'fg-1')
    parent.launch('reviewer', REVIEW_PROMPT, 'agent-v')
    assert.equal(parent.state().tasks[TASK].failures.length, 1)
    // A report the parent never scanned: counted in the fork, it would be a failure of a task the fork never ran.
    const copied = assistantRow([{ type: 'text', text: 'CC_TIERS_TASK: copied-task\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: old red' }], 'm-copied')
    appendRows(parent.transcript, copied)
    const parentFile = tiers.sessionPath(path.join(dir, 'data'), 'parent')
    const parentBytes = readFileSync(parentFile, 'utf8')

    // The fork starts with a copy of the parent transcript, uuids included, under its own session id.
    const fork = session(dir, env, { id: 'fork-1', project })
    writeFileSync(fork.transcript, readFileSync(parent.transcript))
    assert.match(said(fork.start('fork')), /carried the task records of session parent/)
    for (const hook of [() => fork.prompt(), () => fork.stop()]) {
      hook()
      const state = fork.state()
      assert.deepEqual(Object.keys(state.tasks), [TASK], 'the parent tasks, and none from the copied rows')
      assert.equal(state.tasks[TASK].failures.length, 1)
      assert.deepEqual(state.background, {}, 'the parent agents report to the parent')
    }
    assert.equal(readFileSync(parentFile, 'utf8'), parentBytes, 'the parent state is only read')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a state file gone or unreadable in the middle of a session is recovered with a note and without a crash', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const env = hookEnv(dir)
    const s = session(dir, env)
    s.start()
    s.before('implementer', WRITER_PROMPT)
    s.foreground('implementer', WRITER_PROMPT, 'agent-w', trailer('implementer', 'fail'), 'fg-1')
    assert.equal(s.state().tasks[TASK].failures.length, 1)
    const file = tiers.sessionPath(path.join(dir, 'data'), SESSION)
    const recovered = () => events(dir).filter((event) => event.type === 'state.recovered').map((event) => event.because)

    rmSync(file)
    assert.match(said(s.prompt()), /found no saved state for this session: attempt counts, reviews and parked reports start over/)
    assert.deepEqual(recovered(), ['missing'])
    assert.deepEqual(s.state().tasks, {}, 'the counts start over')
    assert.equal(said(s.prompt()), '', 'the note is told once')

    writeFileSync(file, '{ not json')
    assert.match(said(s.prompt()), /saved state unreadable/)
    assert.deepEqual(recovered(), ['missing', 'corrupt'])

    rmSync(file)
    assert.match(said(s.start('resume')), /no saved state for this session/, 'a resume continues the session, so it is told too')
    assert.deepEqual(recovered(), ['missing', 'corrupt', 'missing'])

    // The session goes on: a delegation is checked and counted again.
    const delegated = JSON.parse(s.before('implementer', WRITER_PROMPT).stdout)
    assert.notEqual(delegated.hookSpecificOutput.permissionDecision, 'deny')
    s.foreground('implementer', WRITER_PROMPT, 'agent-w2', trailer('implementer', 'fail'), 'fg-2')
    assert.equal(s.state().tasks[TASK].failures.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const HANG = [
  "import { existsSync, writeFileSync } from 'node:fs'",
  "writeFileSync(process.argv[2], 'started')",
  'const deadline = Date.now() + 20000',
  'while (!existsSync(process.argv[3]) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))',
].join('\n')

test('a Stop killed in the middle of its gate leaves the parked pass for the next Stop', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  const release = path.join(dir, 'gate-release')
  try {
    const { project, env } = gateProject(dir)
    writeFileSync(path.join(project, 'hang.mjs'), HANG)
    env.CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW = 'node hang.mjs'
    const started = path.join(dir, 'gate-started')
    const s = session(dir, env, { project })
    s.start()
    s.launch('implementer', WRITER_PROMPT, 'agent-w')
    s.handBack('agent-w', trailer('implementer', 'pass', ['CC_TIERS_REVIEW: skip', `CC_TIERS_VERIFY: node hang.mjs ${started} ${release}`]))
    s.prompt()
    assert.equal(s.state().awaiting.length, 1)

    const stop = s.startStop()
    const closed = new Promise((resolve) => stop.on('close', resolve))
    const deadline = Date.now() + 15000
    while (!existsSync(started) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.ok(existsSync(started), 'the gate command started')
    stop.kill('SIGKILL')
    await closed
    writeFileSync(release, '')

    const left = s.state()
    assert.equal(left.awaiting.length, 1, 'the pass stays parked')
    assert.equal(left.tasks[TASK], undefined, 'nothing was counted')
    assert.ok(left.background['agent-w'], 'the agent stays registered')

    // The killed hook left its gate lock behind; its holder is gone, so the next Stop takes it over at once.
    assert.ok(readdirSync(path.join(dir, 'data')).some((name) => /^gate-.*\.lock$/.test(name)), 'the killed gate left its lock')
    const end = said(s.stop())
    assert.match(end, /cc-tiers gate: users-pagination verified: node hang\.mjs/)
    assert.deepEqual(s.state().awaiting, [])
    assert.equal(s.state().log[TASK].attempts, 1)
  } finally {
    writeFileSync(release, '')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a writer fail read from its SubagentStop and from its hand-back row is one failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { project, env } = gateProject(dir)
    const s = session(dir, env, { project })
    const incomplete = trailer('implementer', 'fail')
    s.start()
    s.before('implementer', WRITER_PROMPT)
    s.launch('implementer', WRITER_PROMPT, 'agent-w')

    s.subagentStop('agent-w', 'implementer', { handback: incomplete, last: incomplete })
    s.handBack('agent-w', incomplete)
    s.stop()
    assert.equal(s.state().tasks[TASK].failures.length, 1, 'the stop and the row are one report')
    assert.equal(s.state().log[TASK].failures, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Task dup-report: today a second SubagentStop with the very text already counted reads as a retried attempt (a resumed run that
// failed the same way is a failure of its own, so the text alone cannot tell them apart), and the second failure escalates the task.
test('a second SubagentStop after the background work of the same writer ends is not a second failure', { todo: 'issue #28: duplicate report counted twice (task dup-report)' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-life-'))
  try {
    const { project, env } = gateProject(dir)
    const s = session(dir, env, { project })
    const incomplete = trailer('implementer', 'fail')
    s.start()
    s.before('implementer', WRITER_PROMPT)
    s.launch('implementer', WRITER_PROMPT, 'agent-w')

    s.subagentStop('agent-w', 'implementer', { handback: incomplete, last: incomplete })
    s.handBack('agent-w', incomplete)
    s.stop()
    // Its background work ends and it stops again with the very text it already reported, with no resume between.
    s.subagentStop('agent-w', 'implementer', { handback: incomplete, last: incomplete, name: 'agent-w-again' })
    s.stop()
    const state = s.state()
    assert.equal(state.log[TASK].failures, 1, 'the second stop is not a second failure')
    assert.equal(state.tasks[TASK].tier, 'sonnet', 'one failure does not escalate the task')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
