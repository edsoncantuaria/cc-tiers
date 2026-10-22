#!/usr/bin/env node
/**
 * SubagentStop hook. Counts the report of a cc-tiers agent that ran in the
 * background, using the agent id the PostToolUse launch recorded. Foreground
 * runs are counted by PostToolUse instead. The message waits in the session
 * state until the next hook that can reach the orchestrator.
 */

import { runHook } from './integrity.mjs'

async function main(payload) {
  const {
    agentHandbackReport,
    agentTranscriptUsage,
    matchRole,
    openContext,
    parseHeaders,
    peekFor,
    prepareReport,
    processReport,
    queueMessage,
    withSession,
  } = await import('./cc_tiers.mjs')
  const agentId = String(payload.agent_id || '')
  if (!agentId) return
  const ctx = openContext(payload)

  // Read the launch first, run the gate with no lock held, then count under the lock.
  const { launched, peek } = withSession(ctx, payload, (state) => {
    const found = state.background?.[agentId]
    return { launched: found, peek: found ? peekFor(state, { prompt: found.prompt || '' }) : null }
  })
  if (!launched) return
  const role = launched.role || matchRole(payload.agent_type)
  // A background agent delivers its report through the SubagentHandback tool, so the last message is not the trailer.
  let text = String(payload.last_assistant_message || '')
  if (!parseHeaders(text).STATUS) text = agentHandbackReport(payload.agent_transcript_path) || text
  const event = role
    ? prepareReport(
        ctx,
        {
          kind: 'report',
          id: `agent:${agentId}`,
          role,
          prompt: launched.prompt || '',
          launchedAt: launched.at,
          text,
          error: '',
        },
        payload,
        { peek },
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

// Blocking a SubagentStop would keep the subagent running; the next hook that works tells the orchestrator.
runHook('subagent_stop', main, (note) => ({ systemMessage: note }), { effect: 'The background report was not counted and its gate did not run' })
