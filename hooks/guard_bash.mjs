#!/usr/bin/env node
/**
 * PreToolUse hook for Bash calls. The researcher declares Bash in its tools, and a plugin agent
 * cannot limit it, so this denies any researcher command that is not one read-only command.
 * Any other agent, another plugin's researcher included, and the main session pass untouched with no output.
 */

import { pathToFileURL } from 'node:url'
import { readPayload } from './integrity.mjs'

// Claude Code names a plugin agent <plugin>:<agent>; only cc-tiers's own researcher is held to the list.
const RESEARCHER = 'cc-tiers:researcher'
const GLOB_CHARACTERS = new Set(['*', '?', '[', '^', '#', '~'])

const READ_ONLY = new Set(['cat', 'head', 'tail', 'grep', 'ls', 'wc', 'find', 'git'])
// diff and blame stay out: a worktree diff or a blame with no revision runs core.fsmonitor and clean filters, and no option turns those off.
const GIT_READ_ONLY = new Set(['log', 'show'])
// A repository's config can make log and show run a program (diff.<driver>.textconv, diff.external, gpg.program with
// log.showSignature), so these come right after the subcommand, where no earlier option can take them as its value.
const GIT_REQUIRED = ['--no-textconv', '--no-ext-diff', '--no-show-signature']
const FIND_WRITES = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'])
// The only other options log and show may take: git has many that read the repository's config to run a program
// (--format=%G? runs gpg.program, --remerge-diff runs merge drivers, --output writes), so the list is closed.
const GIT_FLAGS = new Set(['-p', '--patch', '-u', '--stat', '--name-only', '--name-status', '--oneline', '--follow', '--pickaxe-regex', '--pickaxe-all', '-i', '--regexp-ignore-case', '--all', '--reverse', '--no-merges', '--first-parent', '--abbrev-commit', '--graph', '--decorate', '--no-decorate', '--no-color'])
// These take a value, as the next word or after `=`; git reads that value as data.
const GIT_VALUE = new Set(['-S', '-G', '-n', '--author', '--grep', '--since', '--until', '--after', '--before', '--max-count'])
// The shell expands, splits and chains after this hook looks, so only characters with no such effect are allowed, quoted or not.
const SAFE_CHARACTERS = /^[A-Za-z0-9 _.,/:=@+%*?[\]^#~'"-]+$/

export const DENY_REASON =
  'cc-tiers: the researcher may run one read-only command: cat, head, tail, grep, ls, wc, find without -exec/-delete, or git log/show starting with --no-textconv --no-ext-diff --no-show-signature (git diff and git blame are not allowed). ' +
  'After those, git takes only -p, --stat, --name-only, --name-status, --oneline, --follow, -S, -G, -n, -<N>, --author, --grep, --since, --until, --all, --reverse, --no-merges, --first-parent and paths after --; no --format, no -c, and no revision that starts with ":". ' +
  'No shell syntax such as ; & | > < ` $ ( ) { } ! or a backslash, and no unquoted * ? [ ^ # ~ (quote a pattern or a revision such as "HEAD^:file"). Use Read, Grep and Glob for the rest.'

/** The words the shell passes on: quotes group and are removed, unquoted spaces split; null for an unclosed quote. No backslash reaches here. */
function words(command) {
  const out = []
  let word = null
  let quote = ''
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      word ??= ''
    } else if (/\s/.test(char)) {
      if (word !== null) out.push(word)
      word = null
    } else word = (word ?? '') + char
  }
  if (quote) return null
  if (word !== null) out.push(word)
  return out
}

/** True when a glob character stands outside quotes: the shell would expand it to file names (a planted `-delete`) after this check; zsh's extendedglob adds ^ # ~. */
function unquotedGlob(command) {
  let quote = ''
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === "'" || char === '"') quote = char
    else if (GLOB_CHARACTERS.has(char)) return true
  }
  return false
}

/** True when the command is one read-only command from the researcher's allowlist. */
export function isReadOnlyCommand(command) {
  if (typeof command !== 'string' || !SAFE_CHARACTERS.test(command) || unquotedGlob(command)) return false
  const split = words(command)
  if (!split) return false
  const [program, ...args] = split
  if (!READ_ONLY.has(program)) return false
  if (program === 'find') return !args.some((arg) => FIND_WRITES.has(arg))
  if (program !== 'git') return true
  if (!GIT_READ_ONLY.has(args[0])) return false
  const head = new Set(args.slice(1, 1 + GIT_REQUIRED.length))
  if (head.size !== GIT_REQUIRED.length || !GIT_REQUIRED.every((flag) => head.has(flag))) return false
  return gitArgsSafe(args.slice(1 + GIT_REQUIRED.length))
}

/** True when every word after the required flags is an allowed option, its value, a revision that does not read the index, or a path after `--`. */
function gitArgsSafe(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return true
    if (GIT_FLAGS.has(arg) || /^-\d+$/.test(arg) || /^-n\d+$/.test(arg)) continue
    if (GIT_VALUE.has(arg)) {
      i += 1
      if (i >= args.length) return false
      continue
    }
    if ((arg.includes('=') && GIT_VALUE.has(arg.slice(0, arg.indexOf('=')))) || /^-[SG]./.test(arg)) continue
    if (arg.startsWith('-')) return false
    // A `:path` revision reads the index, and refreshing it runs core.fsmonitor.
    if (arg.startsWith(':')) return false
  }
  return true
}

async function main(payload) {
  if (String(payload.agent_type || '').toLowerCase() !== RESEARCHER) return
  if (isReadOnlyCommand(payload.tool_input?.command)) return
  const output = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: output })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(readPayload())
