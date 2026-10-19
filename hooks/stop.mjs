#!/usr/bin/env node
/**
 * Stop and UserPromptSubmit hook. Catches up on the transcript (which counts an
 * Opus ceiling trailer) and delivers reports that are still waiting. On
 * UserPromptSubmit it also adds the light-path note for a one-task trivial request.
 * On Stop it asks the orchestrator to continue once, so a retry or an
 * escalation is not dropped at the end of the turn.
 */

import {
  historyPath,
  hookOutput,
  lightHint,
  loadHistory,
  openContext,
  parsePayload,
  readStdin,
  takePending,
  withSession,
} from './cc_tiers.mjs'

function main() {
  const payload = parsePayload(readStdin())
  if (!Object.keys(payload).length) return
  const eventName = String(payload.hook_event_name || 'Stop')
  const ctx = openContext(payload)
  const prompting = eventName === 'UserPromptSubmit'
  const history = prompting && ctx.routing.learn && ctx.projectDir ? loadHistory(historyPath(ctx.projectDir)) : null
  const message = withSession(ctx, payload, (state) => {
    const pending = takePending(state)
    if (!prompting) return pending
    const hint = lightHint(payload.prompt, ctx.routing, { history, conserve: ctx.routing.conserve === true, projectDir: ctx.projectDir })
    return [pending, hint].filter(Boolean).join('\n\n')
  })
  if (!message) return
  if (prompting) {
    process.stdout.write(`${JSON.stringify(hookOutput('UserPromptSubmit', message))}\n`)
    return
  }
  if (payload.stop_hook_active === true) {
    process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: message })}\n`)
}

try {
  main()
} catch {
  process.exit(0)
}
