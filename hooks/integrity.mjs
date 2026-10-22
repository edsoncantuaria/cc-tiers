/**
 * Hook failures. An internal error in a cc-tiers hook is recorded and told, never
 * swallowed as a success: the work it should have checked is not validated.
 * This module only uses Node built-ins, base.mjs and redact.mjs, so it still
 * loads when cc_tiers.mjs does not.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { slug } from './base.mjs'
import { clip } from './redact.mjs'

export function hookErrorsPath(dataDir) {
  return path.join(dataDir, 'hook-errors.jsonl')
}

/** The hook input: stdin parsed as an object, or {} when it is empty or not JSON. */
export function readPayload(read = () => readFileSync(0, 'utf8')) {
  try {
    const data = JSON.parse(read())
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function* strings(value, depth = 0) {
  if (typeof value === 'string') yield value
  else if (value && typeof value === 'object' && depth < 6) for (const item of Object.values(value)) yield* strings(item, depth + 1)
}

/** The CC_TIERS_TASK the hook input names (the delegation prompt first), as slug() tracks it, or ''. */
export function taskOf(payload) {
  for (const source of [payload?.tool_input?.prompt, payload?.last_assistant_message, payload?.tool_response]) {
    for (const text of strings(source)) {
      const found = slug(/^\s*CC_TIERS_TASK:[ \t]*(.*?)\s*$/m.exec(text)?.[1])
      if (found) return found
    }
  }
  return ''
}

export function describe(error) {
  return clip(`${error?.name || 'Error'}: ${error?.message ?? String(error)}`, 160)
}

/** Appends one failure; true when it wrote. Never throws: the warning must go out even when this cannot. */
export function recordHookError(dataDir, { session, hook, task, error }, now = Date.now()) {
  try {
    if (!dataDir) return false
    const file = hookErrorsPath(dataDir)
    mkdirSync(path.dirname(file), { recursive: true })
    const line = { ts: new Date(now).toISOString(), session: String(session || 'unknown'), hook, task: task || '', error: describe(error) }
    appendFileSync(file, `${JSON.stringify(line)}\n`)
    return true
  } catch {
    return false
  }
}

/** The recorded failures of one session, oldest first; a torn line is skipped. */
export function readHookErrors(dataDir, session) {
  let text
  try {
    text = readFileSync(hookErrorsPath(dataDir), 'utf8')
  } catch {
    return []
  }
  const found = []
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line)
      if (row && typeof row === 'object' && row.session === String(session)) found.push(row)
    } catch {
      // A torn or hand-edited line is skipped.
    }
  }
  return found
}

/** What the orchestrator is told when a hook fails: the work it should have checked is not validated. */
export function failureNote(hook, task, error, recorded, effect = 'Its checks did not run') {
  const what = task ? `task ${task}` : 'the current work'
  const kept = recorded ? '' : ' It could not be recorded either, so tell the user.'
  return (
    `cc-tiers internal error in the ${hook} hook (${describe(error)}). ${effect}, so ${what} is not validated: ` +
    `do not report it as passed or verified. It stays at most partial in this session; run its checks yourself, and tell the user what you verified and whether the error repeats.${kept}`
  )
}

/**
 * Runs a hook. On an internal error it records it, prints what onError returns, and exits 0 so the output is read.
 * effect says what the failure skipped, in the note.
 */
export async function runHook(hook, main, onError, { effect } = {}) {
  const payload = readPayload()
  try {
    await main(payload)
  } catch (error) {
    const task = taskOf(payload)
    const recorded = recordHookError(process.env.CLAUDE_PLUGIN_DATA || '', { session: payload.session_id, hook, task, error })
    const note = failureNote(hook, task, error, recorded, effect)
    let output = null
    try {
      output = onError(note, payload)
    } catch {
      output = { systemMessage: note }
    }
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
    process.exit(0)
  }
}
