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
const FLAGS = '--no-textconv --no-ext-diff --no-show-signature'
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
    `git log ${FLAGS} --oneline -5`,
    `git log ${FLAGS} -S matchRole -- hooks`,
    `git show ${FLAGS} HEAD:README.md`,
    'git log --no-show-signature --no-ext-diff --no-textconv --stat -p -- .',
    `git log ${FLAGS} -S "x --textconv" -- a`,
    "find . -name '*.md'",
    'grep -rn foo hooks',
    `git log ${FLAGS} -- path`,
    `git show ${FLAGS} 'HEAD^:README.md'`,
    `git log "--no-textconv" '--no-ext-diff' --no-show-signature`,
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
    `git diff ${FLAGS}`,
    `git blame ${FLAGS} hooks/cc_tiers.mjs`,
  ]) assert.equal(isReadOnlyCommand(command), false, String(command))
})

test('the allowlist refuses what the shell expands after the hook looks, quoted or not', () => {
  for (const command of [
    'find . -name x {-exec,rm} {} +',
    'find . -name x -{delete,print}',
    `git log ${FLAGS} --{output=/tmp/x,stat}`,
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

test('an unquoted * ? [ ^ # or ~ is refused, a quoted pattern or revision passes', () => {
  for (const command of [`git log ${FLAGS} *`, 'find *', 'find . -[d]elete', 'ls ?', 'cat a*', "find . -name '*.md' -[d]elete", 'find . -delete#', 'find ^keep.txt', 'find . -delete~x', 'find . -delet^x', `git show ${FLAGS} HEAD^:README.md`, `git log ${FLAGS} HEAD~1`]) {
    assert.equal(isReadOnlyCommand(command), false, command)
  }
  for (const command of ["find . -name '*.md'", 'grep -rn "a?b" hooks', "grep --include='*.js' -rn foo ."]) {
    assert.equal(isReadOnlyCommand(command), true, command)
  }
})

test('git refuses global options, --output, --exec-path, --ext-diff, --textconv and their abbreviations', () => {
  for (const command of [
    `git -c core.pager=sh log ${FLAGS}`,
    `git -C other log ${FLAGS}`,
    `git --git-dir=x log ${FLAGS}`,
    `git log ${FLAGS} --output=out.txt`,
    `git log ${FLAGS} --output out.txt`,
    `git show ${FLAGS} --out=out.txt`,
    `git show ${FLAGS} --o=x`,
    `git log ${FLAGS} --exec-path=/tmp`,
    `git show ${FLAGS} --exec-path`,
    `git log ${FLAGS} --ext-diff`,
    `git log ${FLAGS} --ext`,
    `git show --ext-diff ${FLAGS}`,
    `git log ${FLAGS} --textconv`,
    `git show --textconv ${FLAGS}`,
    `git log ${FLAGS} "--textconv"`,
    `git log ${FLAGS} '--output=x'`,
  ]) assert.equal(isReadOnlyCommand(command), false, command)
  assert.equal(isReadOnlyCommand(`git log ${FLAGS} --oneline -- hooks`), true)
})

test('git log and show need the three flags right after the subcommand', () => {
  for (const subcommand of ['log', 'show']) {
    for (const command of [
      `git ${subcommand}`,
      `git ${subcommand} --oneline -- hooks`,
      `git ${subcommand} --no-textconv --no-ext-diff`,
      `git ${subcommand} --no-textconv --no-ext-diff --oneline`,
      `git ${subcommand} --no-textc --no-ext-d --no-show-sig`,
      `git ${subcommand} --no-textconv=1 --no-ext-diff --no-show-signature`,
      `git ${subcommand} -p ${FLAGS}`,
      `git ${subcommand} -p -S ${FLAGS}`,
      `git ${subcommand} -G ${FLAGS}`,
      `git ${subcommand} --no-ext-diff -S "x --no-textconv" --no-show-signature`,
      `git ${subcommand} "${FLAGS}"`,
      `git ${subcommand} ${FLAGS} --show-signature`,
      `git ${subcommand} ${FLAGS} --textconv`,
      `git ${subcommand} ${FLAGS} --ext-diff`,
      `git ${subcommand} ${FLAGS} 'unclosed`,
    ]) assert.equal(isReadOnlyCommand(command), false, command)
    for (const command of [
      `git ${subcommand} ${FLAGS}`,
      `git ${subcommand} --no-show-signature --no-ext-diff --no-textconv -p`,
      `git ${subcommand} ${FLAGS} -p HEAD -- hooks`,
    ]) assert.equal(isReadOnlyCommand(command), true, command)
  }
})

test('after the flags git takes only listed options, their values, revisions that skip the index and paths after --', () => {
  for (const subcommand of ['log', 'show']) {
    for (const command of [
      `git ${subcommand} ${FLAGS} --format=%GS`,
      `git ${subcommand} ${FLAGS} --pretty=%G?`,
      `git ${subcommand} ${FLAGS} --remerge-diff`,
      `git ${subcommand} ${FLAGS} --cc`,
      `git ${subcommand} ${FLAGS} -m`,
      `git ${subcommand} ${FLAGS} --output=x`,
      `git ${subcommand} ${FLAGS} :f.dat`,
      `git ${subcommand} ${FLAGS} ':0:f.dat'`,
      `git ${subcommand} ${FLAGS} -n`,
      `git ${subcommand} ${FLAGS} -S`,
    ]) assert.equal(isReadOnlyCommand(command), false, command)
    for (const command of [
      `git ${subcommand} ${FLAGS} -S --remerge-diff`,
      `git ${subcommand} ${FLAGS} -Sfoo -G bar`,
      `git ${subcommand} ${FLAGS} --grep=fix --author someone -n 3 -5`,
      `git ${subcommand} ${FLAGS} --since=2026-01-01 --until 2026-02-01 --no-merges --first-parent`,
      `git ${subcommand} ${FLAGS} --stat -p 'HEAD~1' -- hooks`,
      `git ${subcommand} ${FLAGS} -p -- :f.dat`,
    ]) assert.equal(isReadOnlyCommand(command), true, command)
  }
})

test('git diff and git blame are refused, with or without the flags', () => {
  for (const subcommand of ['diff', 'blame']) {
    for (const command of [`git ${subcommand}`, `git ${subcommand} ${FLAGS}`, `git ${subcommand} ${FLAGS} hooks/guard_bash.mjs`, `git ${subcommand} --no-textconv HEAD`, `git ${subcommand} ${FLAGS} 'HEAD~1' -- hooks`]) {
      assert.equal(isReadOnlyCommand(command), false, command)
    }
  }
})

test('DENY_REASON names the flags git log and show need and refuses diff and blame', () => {
  assert.match(DENY_REASON, /git log\/show starting with --no-textconv --no-ext-diff --no-show-signature/)
  assert.match(DENY_REASON, /git diff and git blame are not allowed/)
})

test('the hook denies a cc-tiers researcher command outside the allowlist, in any case', () => {
  for (const agent of ['cc-tiers:researcher', 'CC-Tiers:Researcher']) {
    const { status, stdout } = run(call(agent, 'rm -rf x'))
    assert.equal(status, 0)
    const out = JSON.parse(stdout).hookSpecificOutput
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.equal(out.permissionDecisionReason, DENY_REASON)
  }
})

test('the hook passes a researcher read-only command with no output', () => {
  for (const agent of ['cc-tiers:researcher']) {
    assert.deepEqual(run(call(agent, `git log ${FLAGS} --oneline -3`)), { status: 0, stdout: '', stderr: '' })
  }
})

test('any other agent, another plugin researcher included, and the main session pass untouched with no output', () => {
  for (const agent of ['cc-tiers:implementer', 'implementer', 'Explore', 'cc-tiers:researcher-x', 'researcher', 'acme:researcher', '', undefined]) {
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
  const { stdout } = run(JSON.stringify({ tool_name: 'Bash', agent_type: 'cc-tiers:researcher', tool_input: {} }))
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
