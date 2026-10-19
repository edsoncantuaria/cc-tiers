#!/usr/bin/env node
/**
 * Stop and UserPromptSubmit hook. Catches up on the transcript (which counts an
 * Opus ceiling trailer) and delivers reports that are still waiting.
 * On Stop it asks the orchestrator to continue once, so a retry or an
 * escalation is not dropped at the end of the turn.
 */

import { hookOutput, openContext, parsePayload, readStdin, takePending, withSession } from './cc_tiers.mjs'

function main() {
  const payload = parsePayload(readStdin())
  if (!Object.keys(payload).length) return
  const eventName = String(payload.hook_event_name || 'Stop')
  const ctx = openContext(payload)
  const message = withSession(ctx, payload, (state) => takePending(state))
  if (!message) return
  if (eventName === 'UserPromptSubmit') {
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
