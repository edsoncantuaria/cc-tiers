#!/usr/bin/env node
/**
 * PreToolUse hook for Bash calls. The researcher declares Bash in its tools, and a plugin agent
 * cannot limit it, so this denies any researcher command that is not one read-only command.
 * Any other agent, and the main session, pass untouched with no output.
 */

import { pathToFileURL } from 'node:url'
import { readPayload } from './integrity.mjs'

const READ_ONLY = new Set(['cat', 'head', 'tail', 'grep', 'ls', 'wc', 'find', 'git'])
const GIT_READ_ONLY = new Set(['log', 'show', 'diff', 'blame'])
const FIND_WRITES = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'])
// git accepts any unique prefix of a long option, so these are matched by prefix.
const GIT_RISKY = ['output', 'exec-path', 'ext-diff']
// The shell expands, splits and chains after this hook looks, so only characters with no such effect are allowed, quoted or not.
const SAFE_CHARACTERS = /^[A-Za-z0-9 _.,/:=@+%*?[\]^#~'"-]+$/

export const DENY_REASON =
  'cc-tiers: the researcher may run one read-only command: cat, head, tail, grep, ls, wc, find without -exec/-delete, or git log/show/diff/blame. ' +
  'No shell syntax such as ; & | > < ` $ ( ) { } ! or a backslash, and no git -c or --output. Use Read, Grep and Glob for the rest.'

/** The words of a command with quotes removed, so a quoted option is checked as git would read it. */
function words(command) {
  return command.replace(/['"]/g, '').split(/\s+/).filter(Boolean)
}

/** True when the command is one read-only command from the researcher's allowlist. */
export function isReadOnlyCommand(command) {
  if (typeof command !== 'string' || !SAFE_CHARACTERS.test(command)) return false
  const [program, ...args] = words(command)
  if (!READ_ONLY.has(program)) return false
  if (program === 'find') return !args.some((arg) => FIND_WRITES.has(arg))
  if (program !== 'git') return true
  if (!GIT_READ_ONLY.has(args[0])) return false
  return !args.some((arg) => {
    const name = /^--([^=]*)/.exec(arg)?.[1]
    return name && GIT_RISKY.some((risky) => risky.startsWith(name))
  })
}

async function main(payload) {
  if (!payload.agent_type) return
  const { matchRole } = await import('./cc_tiers.mjs')
  if (matchRole(payload.agent_type) !== 'researcher') return
  if (isReadOnlyCommand(payload.tool_input?.command)) return
  const output = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: output })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(readPayload())
