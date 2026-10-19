#!/usr/bin/env node
/** PostToolUse / PostToolUseFailure hook for Agent calls from cc-tiers. */

import {
  hookOutput,
  normalizeEvent,
  openContext,
  parsePayload,
  processReport,
  readStdin,
  takePending,
  usageFromToolResponse,
  withSession,
} from './cc_tiers.mjs'

function main() {
  const payload = parsePayload(readStdin())
  if (!Object.keys(payload).length) return
  const event = normalizeEvent(payload)
  if (!event) return
  const ctx = openContext(payload)

  const message = withSession(ctx, payload, (state) => {
    let text
    if (event.kind === 'background') {
      // Registers the agent id so SubagentStop can count the report later.
      text = processReport(ctx, state, event)
    } else {
      const usage = usageFromToolResponse(payload.tool_response, event.role, ctx.routing)
      const key = event.agent_id || event.tool_use_id
      text = processReport(ctx, state, event, usage ? { key, ...usage } : null)
    }
    const pending = takePending(state)
    return [pending, text].filter(Boolean).join('\n\n')
  })

  if (!message) return
  const eventName = String(payload.hook_event_name || 'PostToolUse')
  process.stdout.write(`${JSON.stringify(hookOutput(eventName, message))}\n`)
}

try {
  main()
} catch {
  process.exit(0)
}
