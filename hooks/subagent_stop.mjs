#!/usr/bin/env node
/**
 * SubagentStop hook. Counts the report of a cc-tiers agent that ran in the
 * background, using the agent id the PostToolUse launch recorded. Foreground
 * runs are counted by PostToolUse instead. The message waits in the session
 * state until the next hook that can reach the orchestrator.
 */

import {
  agentTranscriptSpend,
  matchRole,
  openContext,
  parsePayload,
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

  withSession(ctx, payload, (state) => {
    const launched = state.background?.[agentId]
    if (!launched) return
    delete state.background[agentId]
    const role = launched.role || matchRole(payload.agent_type)
    if (!role) return
    const event = {
      kind: 'report',
      id: `agent:${agentId}`,
      role,
      prompt: launched.prompt || '',
      text: String(payload.last_assistant_message || ''),
      error: '',
    }
    const totals = agentTranscriptSpend(payload.agent_transcript_path)
    const message = processReport(ctx, state, event, { key: agentId, totals })
    if (message) queueMessage(state, message)
  })
}

try {
  main()
} catch {
  process.exit(0)
}
