import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const integrity = await import(pathToFileURL(path.join(ROOT, 'hooks', 'integrity.mjs')).href)
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const report = await import(pathToFileURL(path.join(ROOT, 'hooks', 'report.mjs')).href)

const PROMPT = 'CC_TIERS_TASK: fix-login\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nFix it'

async function withDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-integrity-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** A real internal fault: the session state path is a directory, so saving the state throws. */
function brokenData(dir, session = 's1') {
  const data = path.join(dir, 'data')
  mkdirSync(path.join(data, `session-${session}.json`), { recursive: true })
  return data
}

function runHook(script, payload, data, { root = ROOT, env = {} } = {}) {
  const proc = spawnSync(process.execPath, [path.join(root, 'hooks', script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: '', ...env },
  })
  return { status: proc.status, output: proc.stdout.trim() ? JSON.parse(proc.stdout) : null, stderr: proc.stderr }
}

const mkdirTemp = () => mkdtempSync(path.join(os.tmpdir(), 'cc-tiers-integrity-'))
const recorded = (data) => readFileSync(path.join(data, 'hook-errors.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))

test('taskOf reads the slug from the delegation prompt, the report, or nothing', () => {
  assert.equal(integrity.taskOf({ tool_input: { prompt: PROMPT } }), 'fix-login')
  assert.equal(integrity.taskOf({ last_assistant_message: 'done\nCC_TIERS_TASK: other-task\n' }), 'other-task')
  assert.equal(integrity.taskOf({ tool_response: { content: [{ type: 'text', text: 'done\nCC_TIERS_TASK: from-result\nCC_TIERS_STATUS: pass' }] } }), 'from-result')
  // The same slug the rest of cc-tiers tracks for the header (slug() in base.mjs).
  assert.equal(integrity.taskOf({ tool_input: { prompt: 'CC_TIERS_TASK: Fix_Login\nx' } }), 'fix-login')
  assert.equal(integrity.taskOf({ tool_input: { prompt: 'CC_TIERS_TASK: fix login\nx' } }), 'fix-login')
  assert.equal(integrity.taskOf({ tool_input: { prompt: 'no header here' } }), '')
  assert.equal(integrity.taskOf({}), '')
})

test('recordHookError appends a redacted line per failure and never throws', async () => {
  await withDir(async (dir) => {
    const data = path.join(dir, 'data')
    assert.equal(integrity.recordHookError(data, { session: 's1', hook: 'stop', task: 'a', error: new TypeError('password=hunter2 broke') }, 0), true)
    assert.equal(integrity.recordHookError(data, { session: 's2', hook: 'stop', task: '', error: 'plain' }, 0), true)
    const rows = recorded(data)
    assert.deepEqual(rows[0], { ts: '1970-01-01T00:00:00.000Z', session: 's1', hook: 'stop', task: 'a', error: 'TypeError: password=[redacted] broke' })
    assert.equal(rows[1].error, 'Error: plain')
    const file = path.join(dir, 'file')
    writeFileSync(file, 'x')
    assert.equal(integrity.recordHookError(file, { session: 's1', hook: 'stop', error: new Error('x') }), false)
    assert.equal(integrity.recordHookError('', { session: 's1', hook: 'stop', error: new Error('x') }), false)
  })
})

test('readHookErrors keeps one session, oldest first, and skips a torn line', async () => {
  await withDir(async (dir) => {
    const line = (session, task) => JSON.stringify({ ts: 't', session, hook: 'stop', task, error: 'Error: x' })
    writeFileSync(path.join(dir, 'hook-errors.jsonl'), `${line('s1', 'a')}\n{torn\n${line('s2', 'b')}\n${line('s1', 'c')}\n`)
    assert.deepEqual(integrity.readHookErrors(dir, 's1').map((row) => row.task), ['a', 'c'])
    assert.deepEqual(integrity.readHookErrors(path.join(dir, 'none'), 's1'), [])
  })
})

test('a failed check refuses a cc-tiers delegation, records it, and exits 0', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const run = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt: PROMPT } }, data)
    assert.equal(run.status, 0)
    const output = run.output.hookSpecificOutput
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /^cc-tiers internal error in the before_agent hook \(\w*Error: .+\)\. .*task fix-login is not validated: do not report it as passed or verified/)
    assert.deepEqual(recorded(data).map((row) => [row.session, row.hook, row.task]), [['s1', 'before_agent', 'fix-login']])
  })
})

test('a failed check lets another agent through, with the note', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const run = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'look around' } }, data)
    assert.equal(run.status, 0)
    assert.equal(run.output.hookSpecificOutput.permissionDecision, undefined)
    assert.match(run.output.hookSpecificOutput.additionalContext, /cc-tiers internal error in the before_agent hook/)
  })
})

test('the note still goes out when the failure cannot be recorded', async () => {
  await withDir(async (dir) => {
    const data = path.join(dir, 'not-a-dir')
    writeFileSync(data, 'x')
    const run = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:worker', prompt: PROMPT } }, data)
    assert.equal(run.status, 0)
    assert.equal(run.output.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(run.output.hookSpecificOutput.permissionDecisionReason, /It could not be recorded either, so tell the user\.$/)
  })
})

test('a failed count after an agent tells the orchestrator the task is not validated', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      const run = runHook('after_agent.mjs', {
        session_id: 's1',
        hook_event_name: event,
        tool_name: 'Agent',
        tool_use_id: `t-${event}`,
        tool_input: { subagent_type: 'cc-tiers:implementer', prompt: PROMPT },
        tool_response: { content: [{ type: 'text', text: 'CC_TIERS_TASK: fix-login\nCC_TIERS_STATUS: pass' }] },
      }, data)
      assert.equal(run.status, 0)
      assert.equal(run.output.hookSpecificOutput.hookEventName, event)
      assert.match(run.output.hookSpecificOutput.additionalContext, /after_agent hook \(.+\)\. The report was not counted and its gate did not run, so task fix-login is not validated: do not report it as passed/)
    }
    assert.equal(recorded(data).length, 2)
  })
})

test('a failed Stop blocks once, then only warns; a failed prompt hook only adds the note', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const stop = runHook('stop.mjs', { session_id: 's1', hook_event_name: 'Stop' }, data)
    assert.equal(stop.status, 0)
    assert.equal(stop.output.decision, 'block')
    assert.match(stop.output.reason, /cc-tiers internal error in the stop hook .*the current work is not validated/)
    const again = runHook('stop.mjs', { session_id: 's1', hook_event_name: 'Stop', stop_hook_active: true }, data)
    assert.equal(again.output.decision, undefined)
    assert.match(again.output.systemMessage, /stop hook/)
    const prompt = runHook('stop.mjs', { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'fix the typo' }, data)
    assert.equal(prompt.output.decision, undefined)
    assert.equal(prompt.output.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
    assert.match(prompt.output.hookSpecificOutput.additionalContext, /stop hook/)
  })
})

test('a failed SubagentStop records the task and only warns, so the subagent is not kept running', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const run = runHook('subagent_stop.mjs', { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'a1', last_assistant_message: 'CC_TIERS_TASK: fix-login\nCC_TIERS_STATUS: pass' }, data)
    assert.equal(run.status, 0)
    assert.equal(run.output.decision, undefined)
    assert.match(run.output.systemMessage, /subagent_stop hook \(.+\)\. The background report was not counted and its gate did not run, so task fix-login is not validated/)
    assert.deepEqual(recorded(data).map((row) => [row.hook, row.task]), [['subagent_stop', 'fix-login']])
  })
})

test('the next hook that works marks the named tasks and tells the orchestrator once', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt: PROMPT } }, data)
    runHook('stop.mjs', { session_id: 's1', hook_event_name: 'Stop' }, data)
    const state = tiers.emptyState('s1')
    tiers.absorbHookErrors(state, data)
    assert.equal(state.log['fix-login'].hookErrors, 1)
    assert.equal(state.hookErrorsSeen, 2)
    const note = tiers.takePending(state)
    assert.match(note, /^cc-tiers recorded 2 internal hook errors \(before_agent, stop\): .* fix-login is not validated\. Do not report that work as verified/)
    tiers.absorbHookErrors(state, data)
    assert.equal(tiers.takePending(state), '', 'told once')
    assert.equal(state.log['fix-login'].hookErrors, 1)
  })
})

test('absorbing works for a slug named like an Object.prototype key, and with no data dir', async () => {
  await withDir(async (dir) => {
    writeFileSync(path.join(dir, 'hook-errors.jsonl'), `${JSON.stringify({ ts: 't', session: 's1', hook: 'stop', task: 'constructor', error: 'Error: x' })}\n`)
    const state = tiers.emptyState('s1')
    tiers.absorbHookErrors(state, dir)
    assert.equal(state.log.constructor.hookErrors, 1)
    assert.equal(Object.getPrototypeOf(state.log), Object.prototype)
    const empty = tiers.emptyState('s1')
    tiers.absorbHookErrors(empty, '')
    assert.equal(empty.hookErrorsSeen, undefined)
  })
})

test('the report marks a task with a hook error and counts the failures', () => {
  assert.equal(report.verifyCell({ verified: ['npm test'], flaky: [], unverified: [] }, 1), 'hook error')
  assert.equal(report.verifyCell({ verified: ['npm test'], flaky: [], unverified: [] }), 'ok')
  const state = { log: { 'fix-login': { tiers: ['sonnet'], attempts: 1, status: 'done', finished: 'sonnet', verify: { verified: ['npm test'], flaky: [], unverified: [] }, hookErrors: 1 } }, cost: {}, spend: {}, hookErrorsSeen: 2 }
  const text = report.renderReport([state])
  assert.match(text, /\| fix-login \| sonnet \| 1 \| 0 \| — \| — \| hook error \|/)
  assert.match(text, /cc-tiers hooks failed 2 times: a task marked hook error is not validated\./)
})

test('the PreToolUse command hook blocks on a failure it cannot catch', () => {
  const hooks = JSON.parse(readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
  assert.equal(hooks.PreToolUse[0].hooks[0].onFailure, 'block')
  assert.ok(existsSync(path.join(ROOT, 'hooks', 'integrity.mjs')))
})

test('a cc_tiers.mjs that fails to load is caught by every hook, recorded, and told', async () => {
  await withDir(async (dir) => {
    const root = path.join(dir, 'plugin')
    for (const name of ['hooks', 'config']) cpSync(path.join(ROOT, name), path.join(root, name), { recursive: true })
    appendFileSync(path.join(root, 'hooks', 'cc_tiers.mjs'), '\nexport const = broken\n')
    const data = path.join(dir, 'data')
    const agent = { tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt: PROMPT } }
    const before = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', ...agent }, data, { root })
    assert.equal(before.status, 0)
    assert.equal(before.output.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(before.output.hookSpecificOutput.permissionDecisionReason, /\(SyntaxError: /)
    const after = runHook('after_agent.mjs', { session_id: 's1', hook_event_name: 'PostToolUse', tool_use_id: 't1', ...agent }, data, { root })
    assert.match(after.output.hookSpecificOutput.additionalContext, /SyntaxError: .*The report was not counted/)
    const sub = runHook('subagent_stop.mjs', { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'a1' }, data, { root })
    assert.match(sub.output.systemMessage, /subagent_stop hook \(SyntaxError: /)
    const stop = runHook('stop.mjs', { session_id: 's1', hook_event_name: 'Stop' }, data, { root })
    assert.equal(stop.output.decision, 'block')
    assert.deepEqual(recorded(data).map((row) => [row.hook, row.task, row.error.split(':')[0]]), [
      ['before_agent', 'fix-login', 'SyntaxError'],
      ['after_agent', 'fix-login', 'SyntaxError'],
      ['subagent_stop', '', 'SyntaxError'],
      ['stop', '', 'SyntaxError'],
    ])
  })
})

test('the failure is recorded with telemetry off', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const run = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt: PROMPT } }, data, { env: { CLAUDE_PLUGIN_OPTION_TELEMETRY: 'off' } })
    assert.equal(run.output.hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(recorded(data).length, 1)
  })
})

test('a working hook absorbs the recorded failures into the session state and tells them once', async () => {
  await withDir(async (dir) => {
    const data = path.join(dir, 'data')
    mkdirSync(data, { recursive: true })
    integrity.recordHookError(data, { session: 's1', hook: 'after_agent', task: 'fix-login', error: new Error('boom') })
    const prompt = { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'carry on' }
    const first = runHook('stop.mjs', prompt, data)
    assert.equal(first.status, 0)
    assert.match(first.output.hookSpecificOutput.additionalContext, /cc-tiers recorded 1 internal hook error \(after_agent\): .* fix-login is not validated\./)
    const state = JSON.parse(readFileSync(path.join(data, 'session-s1.json'), 'utf8'))
    assert.equal(state.log['fix-login'].hookErrors, 1)
    assert.equal(state.hookErrorsSeen, 1)
    const second = runHook('stop.mjs', prompt, data)
    assert.doesNotMatch(JSON.stringify(second.output ?? {}), /internal hook error/)
  })
})

test('absorbing a failure on a task that already completed takes back the verified status', () => {
  const state = tiers.emptyState('s1')
  state.log.done = { tiers: ['sonnet'], attempts: 1, failures: 0, escalations: 0, reviews: [], effort: {}, status: 'done', finished: 'sonnet', completion: 'verified', confidence: 'high' }
  const dir = mkdirTemp()
  try {
    integrity.recordHookError(dir, { session: 's1', hook: 'after_agent', task: 'done', error: new Error('late') })
    tiers.absorbHookErrors(state, dir)
    assert.equal(state.log.done.completion, 'partial')
    assert.equal(state.log.done.confidence, 'low')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the deny covers a cc-tiers agent type with spaces or capitals', async () => {
  await withDir(async (dir) => {
    const data = brokenData(dir)
    const run = runHook('before_agent.mjs', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: ' CC-Tiers:Worker ', prompt: PROMPT } }, data)
    assert.equal(run.output.hookSpecificOutput.permissionDecision, 'deny')
  })
})
