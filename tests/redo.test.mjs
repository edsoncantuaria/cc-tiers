import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const redo = await import(pathToFileURL(path.join(ROOT, 'hooks', 'redo.mjs')).href)
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const telemetry = await import(pathToFileURL(path.join(ROOT, 'hooks', 'telemetry.mjs')).href)

const NOW = Date.parse('2026-10-22T12:00:00Z')

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-tiers-redo-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function entry(extra = {}) {
  return { tiers: ['sonnet'], attempts: 1, failures: 0, escalations: 0, reviews: [], effort: {}, status: 'done', finished: 'sonnet', ...extra }
}

function writeSession(dir, id, log, mtime) {
  const state = { ...tiers.emptyState(id), log }
  const file = tiers.sessionPath(dir, id)
  writeFileSync(file, JSON.stringify(state))
  if (mtime) utimesSync(file, mtime, mtime)
  return file
}

const readLog = (file) => JSON.parse(readFileSync(file, 'utf8')).log
const readEvents = (dir) => telemetry.readEvents(telemetry.telemetryPath(dir))

test('redo marks the task in this session, queues task.redone and keeps the reason redacted', (t) => {
  const dir = tempDir(t)
  const file = writeSession(dir, 's1', { 'fix-login': entry() })
  const result = redo.run([dir, 's1', 'Fix_Login', 'still', 'broken', 'token=abc123'], { now: NOW, env: {} })
  assert.deepEqual(result, { code: 0, out: 'Marked fix-login as sent back by the user (1).\n' })
  const log = readLog(file)
  assert.equal(log['fix-login'].redo, 1)
  assert.equal(log['fix-login'].redoneAt, '2026-10-22T12:00:00.000Z')
  const [event] = readEvents(dir)
  assert.deepEqual([event.type, event.task, event.tier, event.source], ['task.redone', 'fix-login', 'sonnet', 'command'])
  assert.equal(event.reason, 'still broken token=[redacted]')
  redo.run([dir, 's1', 'fix-login'], { now: NOW, env: {} })
  assert.equal(readLog(file)['fix-login'].redo, 2)
})

test('redo finds the task in the newest other session when this one lacks it', (t) => {
  const dir = tempDir(t)
  writeSession(dir, 'current', {})
  const old = writeSession(dir, 'old', { 'fix-login': entry({ finished: 'haiku' }) }, new Date('2026-10-01'))
  const recent = writeSession(dir, 'recent', { 'fix-login': entry() }, new Date('2026-10-20'))
  const result = redo.run([dir, 'current', 'fix-login'], { now: NOW, env: {} })
  assert.equal(result.code, 0)
  assert.equal(readLog(recent)['fix-login'].redo, 1)
  assert.equal(readLog(old)['fix-login'].redo, undefined)
  assert.equal(readEvents(dir)[0].session, 'recent')
  assert.ok(!existsSync(path.join(dir, 'latest.json')), 'another session does not take over latest.json')
})

test('redo on an unknown slug prints so, returns 1 and changes nothing', (t) => {
  const dir = tempDir(t)
  const file = writeSession(dir, 's1', { 'fix-login': entry() })
  const before = readFileSync(file, 'utf8')
  const result = redo.run([dir, 's1', 'nope'], { env: {} })
  assert.equal(result.code, 1)
  assert.match(result.out, /No such task is recorded: nope/)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(readEvents(dir).length, 0)
  assert.equal(redo.run([dir, 's1'], { env: {} }).code, 2)
  assert.equal(redo.run([dir, 's1', '--undo'], { env: {} }).code, 2)
})

test('redo --undo removes one mark and queues task.redo.undone', (t) => {
  const dir = tempDir(t)
  const file = writeSession(dir, 's1', { 'fix-login': entry({ redo: 2, redoneAt: 'x' }), plain: entry() })
  assert.equal(redo.run([dir, 's1', '--undo', 'fix-login'], { env: {} }).code, 0)
  assert.equal(readLog(file)['fix-login'].redo, 1)
  assert.equal(redo.run([dir, 's1', '--undo', 'fix-login'], { env: {} }).code, 0)
  assert.equal(readLog(file)['fix-login'].redo, 0)
  assert.equal(readLog(file)['fix-login'].redoneAt, undefined)
  const none = redo.run([dir, 's1', '--undo', 'fix-login'], { env: {} })
  assert.equal(none.code, 1)
  assert.match(none.out, /no re-ask mark/)
  assert.equal(redo.run([dir, 's1', '--undo', 'plain'], { env: {} }).code, 1)
  assert.deepEqual(readEvents(dir).map((event) => event.type), ['task.redo.undone', 'task.redo.undone'])
})

test('redo works for a slug named like an Object.prototype key, and with telemetry off it only marks the log', (t) => {
  const dir = tempDir(t)
  const file = writeSession(dir, 's1', JSON.parse('{"constructor":{"status":"done","finished":"haiku","tiers":["haiku"]}}'))
  assert.equal(redo.run([dir, 's1', 'toString'], { env: {} }).code, 1)
  const result = redo.run([dir, 's1', 'constructor'], { env: { CLAUDE_PLUGIN_OPTION_TELEMETRY: 'off' } })
  assert.equal(result.code, 0)
  assert.equal(Object.getOwnPropertyDescriptor(readLog(file), 'constructor').value.redo, 1)
  assert.equal(readEvents(dir).length, 0)
})

test('the script runs from the command line', (t) => {
  const dir = tempDir(t)
  writeSession(dir, 's1', { 'fix-login': entry() })
  const proc = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'redo.mjs'), dir, 's1', 'fix-login'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT } })
  assert.equal(proc.status, 0)
  assert.match(proc.stdout, /Marked fix-login/)
  const missing = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'redo.mjs'), dir, 's1', 'nope'], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT } })
  assert.equal(missing.status, 1)
})

function stateWith(log) {
  return { ...tiers.emptyState('s1'), log }
}

test('redoFromPrompt counts a prompt that names a done task and complains', () => {
  const state = stateWith({ 'fix-login': entry() })
  const lines = tiers.redoFromPrompt(state, 'O Fix-Login ainda não funciona')
  assert.deepEqual(lines, ['cc-tiers counted this as a re-ask of fix-login; if it is not, run /cc-tiers:redo --undo fix-login.'])
  assert.equal(state.log['fix-login'].redo, 1)
  assert.ok(state.log['fix-login'].redoneAt)
  const [event] = state.events
  assert.deepEqual([event.type, event.task, event.tier, event.source], ['task.redone', 'fix-login', 'sonnet', 'prompt'])
  assert.ok(!JSON.stringify(state).includes('ainda'), 'the prompt text is never stored')
  for (const prompt of ['fix-login is still broken', "fix-login doesn't work", 'fix-login regressed again', 'fix-login deu erro', 'fix-login quebrou de novo']) {
    assert.equal(tiers.redoFromPrompt(state, prompt).length, 1, prompt)
  }
})

test('redoFromPrompt ignores a missing complaint word, a task not done, a substring and a slash command', () => {
  const state = stateWith({ fix: entry(), 'fix-login': entry({ status: 'open' }), constructor: entry() })
  assert.deepEqual(tiers.redoFromPrompt(state, 'thanks, fix looks good'), [])
  assert.deepEqual(tiers.redoFromPrompt(state, 'fix-login still broken'), [])
  assert.deepEqual(tiers.redoFromPrompt(state, 'the prefix is still broken, and fixes too'), [])
  assert.deepEqual(tiers.redoFromPrompt(state, 'fix-login-more is still broken'), [])
  assert.deepEqual(tiers.redoFromPrompt(state, '/cc-tiers:redo fix still broken'), [])
  assert.equal(state.events.length, 0)
  assert.equal(tiers.redoFromPrompt(state, 'constructor is broken').length, 1)
})

test('the UserPromptSubmit hook adds the re-ask line and marks the session', (t) => {
  const dir = tempDir(t)
  const file = writeSession(dir, 's1', { 'fix-login': entry() })
  const run = (prompt) =>
    spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'stop.mjs')], {
      input: JSON.stringify({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: dir, CLAUDE_PROJECT_DIR: '' },
    })
  const slash = run('/cc-tiers:redo fix-login still broken')
  assert.equal(slash.stdout, '')
  assert.equal(readLog(file)['fix-login'].redo, undefined)
  const long = run(`${'please look at this carefully '.repeat(12)}fix-login is still broken`)
  assert.equal(long.status, 0)
  const output = JSON.parse(long.stdout)
  assert.match(output.hookSpecificOutput.additionalContext, /cc-tiers counted this as a re-ask of fix-login; if it is not, run \/cc-tiers:redo --undo fix-login\./)
  assert.equal(readLog(file)['fix-login'].redo, 1)
  const events = readEvents(dir)
  assert.equal(events.length, 1)
  assert.equal(events[0].source, 'prompt')
  assert.ok(!readFileSync(telemetry.telemetryPath(dir), 'utf8').includes('carefully'))
})
