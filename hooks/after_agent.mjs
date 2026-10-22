#!/usr/bin/env node
/** PostToolUse / PostToolUseFailure hook for Agent calls from cc-tiers. */

import { runHook } from './integrity.mjs'

async function main(payload) {
  const {
    hookOutput,
    normalizeEvent,
    openContext,
    peekFor,
    prepareReport,
    processReport,
    takePending,
    usageFromToolResponse,
    withSession,
  } = await import('./cc_tiers.mjs')
  if (!Object.keys(payload).length) return
  const normalized = normalizeEvent(payload)
  if (!normalized) return
  const ctx = openContext(payload)
  const measured = Number(payload.tool_response?.totalDurationMs ?? payload.duration_ms)
  if (Number.isFinite(measured) && measured > 0 && normalized.kind !== 'background') normalized.durationMs = measured
  // The tree before the attempt and the reusable gate results, read before the gate runs outside the lock.
  const peek = normalized.kind === 'report' ? withSession(ctx, payload, (state) => peekFor(state, normalized)) : null
  const event = prepareReport(ctx, normalized, payload, { peek })

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

runHook(
  'after_agent',
  main,
  (note, payload) => ({ hookSpecificOutput: { hookEventName: String(payload.hook_event_name || 'PostToolUse'), additionalContext: note } }),
  { effect: 'The report was not counted and its gate did not run' },
)
