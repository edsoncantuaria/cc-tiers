import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(ROOT, 'hooks', 'guard_bash.mjs')
const { DENY_REASON, isReadOnlyCommand } = await import(pathToFileURL(HOOK).href)

function run(input) {
  const result = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
const call = (agent_type, command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_type, tool_input: { command } })

test('the allowlist accepts one read-only command', () => {
  for (const command of [
    'cat package.json',
    'head -n 20 hooks/cc_tiers.mjs',
    'tail -5 README.md',
    'grep -rn matchRole hooks',
    'grep -S foo file',
    'ls -la hooks',
    'wc -l README.md',
    'find . -name "*.mjs" -type f',
    'git log --oneline -5',
    'git log -S matchRole -- hooks',
    'git show HEAD:README.md',
    'git diff HEAD~1 -- hooks',
    'git blame hooks/cc_tiers.mjs',
    'git log --stat -- .',
    'git log -S foo -- a',
    "find . -name '*.md'",
    'grep -rn foo hooks',
    'git log -- path',
    'git show HEAD^:README.md',
  ]) assert.equal(isReadOnlyCommand(command), true, command)
})

test('the allowlist refuses other programs, chaining, redirection and substitution', () => {
  for (const command of [
    '',
    '   ',
    undefined,
    null,
    42,
    'rm -rf x',
    'npm test',
    'node -e 1',
    'sed -i s/a/b/ file',
    '/bin/cat file',
    'FOO=1 cat file',
    'cat a; rm b',
    'cat a && rm b',
    'cat a || rm b',
    'cat a | sh',
    'cat a & rm b',
    'cat a > b',
    'cat a >> b',
    'cat < a',
    'cat `rm b`',
    'cat $(rm b)',
    'cat <(rm b)',
    'cat a\nrm b',
    'cat a\r\nrm b',
    'git push',
    'git commit -m x',
    'git branch -D x',
    'git config user.name x',
    'git status',
    'git status --short',
    'git',
  ]) assert.equal(isReadOnlyCommand(command), false, String(command))
})

test('the allowlist refuses what the shell expands after the hook looks, quoted or not', () => {
  for (const command of [
    'find . -name x {-exec,rm} {} +',
    'find . -name x -{delete,print}',
    'git log --{output=/tmp/x,stat}',
    'find . -${X:-delete}',
    'find . -de$\'l\'ete',
    "ls *(e:'touch pwned':)",
    'cat $HOME/x',
    'cat "$HOME/x"',
    "cat '$(rm b)'",
    'cat "a`rm b`"',
    'cat a\tb',
    'cat a\u00a0b',
    'cat a!',
    'cat a\\b',
    'cat (a)',
    'cat {a,b}',
  ]) assert.equal(isReadOnlyCommand(command), false, command)
})

test('find refuses its writing and executing actions, even quoted', () => {
  for (const action of ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls']) {
    assert.equal(isReadOnlyCommand(`find . ${action} x`), false, action)
  }
  assert.equal(isReadOnlyCommand('find . -"exec" rm'), false)
  assert.equal(isReadOnlyCommand('find . -\\delete'), false)
})

test('git refuses global options, --output, --exec-path and their abbreviations', () => {
  for (const command of [
    'git -c core.pager=sh log',
    'git -C other log',
    'git --git-dir=x log',
    'git log --output=out.txt',
    'git log --output out.txt',
    'git diff --out=out.txt',
    'git show --o=x',
    'git log --exec-path=/tmp',
    'git diff --exec-path',
    'git diff --ext-diff',
    "git log '--output=x'",
  ]) assert.equal(isReadOnlyCommand(command), false, command)
  assert.equal(isReadOnlyCommand('git log --oneline -- hooks'), true)
})

test('the hook denies a researcher command outside the allowlist, as cc-tiers:researcher and as researcher', () => {
  for (const agent of ['cc-tiers:researcher', 'researcher', 'CC-Tiers:Researcher']) {
    const { status, stdout } = run(call(agent, 'rm -rf x'))
    assert.equal(status, 0)
    const out = JSON.parse(stdout).hookSpecificOutput
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.equal(out.permissionDecisionReason, DENY_REASON)
  }
})

test('the hook passes a researcher read-only command with no output', () => {
  for (const agent of ['cc-tiers:researcher', 'researcher']) {
    assert.deepEqual(run(call(agent, 'git log --oneline -3')), { status: 0, stdout: '', stderr: '' })
  }
})

test('any other agent, and the main session, pass untouched with no output', () => {
  for (const agent of ['cc-tiers:implementer', 'implementer', 'Explore', 'cc-tiers:researcher-x', '', undefined]) {
    assert.deepEqual(run(call(agent, 'rm -rf x; cat a | sh')), { status: 0, stdout: '', stderr: '' }, String(agent))
  }
  const main = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf x' } })
  assert.deepEqual(run(main), { status: 0, stdout: '', stderr: '' })
})

test('malformed or empty hook input exits 0 with no output', () => {
  for (const input of ['', '   ', 'not json', '{"agent_type":', '[]', 'null', '"researcher"', '42']) {
    assert.deepEqual(run(input), { status: 0, stdout: '', stderr: '' }, JSON.stringify(input))
  }
})

test('a researcher call with no command is denied', () => {
  const { stdout } = run(JSON.stringify({ tool_name: 'Bash', agent_type: 'researcher', tool_input: {} }))
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'deny')
})

test('hooks.json wires the guard on Bash as a command hook that fails open', () => {
  const entries = JSON.parse(readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse.filter((entry) => entry.matcher === 'Bash')
  assert.equal(entries.length, 1)
  const [hook] = entries[0].hooks
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard_bash.mjs"')
  assert.ok(hook.timeout <= 10)
  assert.equal(hook.onFailure, undefined)
})
