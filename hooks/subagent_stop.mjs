#!/usr/bin/env node
/**
 * SubagentStop hook. Counts the report of a cc-tiers agent that ran in the
 * background, using the agent id the PostToolUse launch recorded. Foreground
 * runs are counted by PostToolUse instead. The message waits in the session
 * state until the next hook that can reach the orchestrator.
 */

import {
  agentTranscriptUsage,
  matchRole,
  openContext,
  parsePayload,
  prepareReport,
  processReport,
  queueMessage,
  readStdin,
  withSession,
} from './cc_tiers.mjs'

function main() {
  const payload = parsePayload(readStdin())
  const agentId = String(payload.agent_id || '')
  if (!agentId) return
  const ctx = openContext(payload)

  // Read the launch first, run the gate with no lock held, then count under the lock.
  const launched = withSession(ctx, payload, (state) => state.background?.[agentId])
  if (!launched) return
  const role = launched.role || matchRole(payload.agent_type)
  const event = role
    ? prepareReport(
        ctx,
        {
          kind: 'report',
          id: `agent:${agentId}`,
          role,
          prompt: launched.prompt || '',
          text: String(payload.last_assistant_message || ''),
          error: '',
        },
        payload,
      )
    : null

  withSession(ctx, payload, (state) => {
    // Another SubagentStop for the same agent may have counted it while the gate ran.
    if (!state.background?.[agentId]) return
    delete state.background[agentId]
    if (!event) return
    const { totals, cost } = agentTranscriptUsage(payload.agent_transcript_path, ctx.routing)
    const message = processReport(ctx, state, event, { key: agentId, totals, cost })
    if (message) queueMessage(state, message)
  })
}

try {
  main()
} catch {
  process.exit(0)
}
