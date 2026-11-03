#!/usr/bin/env node
/**
 * SubagentStop hook. Counts the report of a cc-tiers agent that ran in the
 * background, using the agent id the PostToolUse launch recorded, including a
 * later stop of the same agent after SendMessage. The hand-back row in the main
 * transcript is the fallback: research it counts at once, any other verdict waits
 * for Stop unless this hook counts the report first (and drops the row), and a report
 * the row already counted only has its spend charged here. Foreground runs are
 * counted by PostToolUse instead. The message waits in the session state until
 * the next hook that can reach the orchestrator.
 */

import { runHook } from './integrity.mjs'

async function main(payload) {
  const {
    agentEntry,
    agentHandbackReport,
    agentReport,
    agentTranscriptUsage,
    chargeAgentSpend,
    claimTwin,
    dropAwaitingAgent,
    matchRole,
    openContext,
    parseHeaders,
    peekFor,
    prepareReport,
    processAgentReport,
    queueMessage,
    withSession,
  } = await import('./cc_tiers.mjs')
  const agentId = String(payload.agent_id || '')
  if (!agentId) return
  const ctx = openContext(payload)
  // A background agent delivers its report through the SubagentHandback tool, so the last message is not the trailer.
  let text = String(payload.last_assistant_message || '')
  if (!parseHeaders(text).STATUS) text = agentHandbackReport(payload.agent_transcript_path) || text

  // Read the launch first, run the gate with no lock held, then count under the lock.
  const { launched, peek, twin } = withSession(ctx, payload, (state) => {
    const found = agentEntry(state, agentId)
    return { launched: found, peek: found ? peekFor(state, { prompt: found.prompt || '' }) : null, twin: found ? claimTwin(state, agentId, 'stop', text) : false }
  })
  if (!launched) return
  const role = launched.role || matchRole(payload.agent_type)
  // The main-transcript row already brought this report: it is not judged or counted again.
  const event = role && !twin ? prepareReport(ctx, agentReport(agentId, { ...launched, role }, text), payload, { peek }) : null

  withSession(ctx, payload, (state) => {
    if (!event && !twin) {
      delete state.background[agentId]
      return
    }
    const { totals, cost } = agentTranscriptUsage(payload.agent_transcript_path, ctx.routing)
    const usage = { key: agentId, totals, cost }
    const current = agentEntry(state, agentId)
    // Another SubagentStop, or the row, may have counted it while the gate ran.
    if (event && current && (current.stops || 0) === (launched.stops || 0)) {
      const message = processAgentReport(ctx, state, event, usage)
      dropAwaitingAgent(state, agentId)
      if (message) queueMessage(state, message)
    } else if (twin || claimTwin(state, agentId, 'stop', text)) {
      chargeAgentSpend(ctx, state, launched, text, usage)
    }
  })
}

// Blocking a SubagentStop would keep the subagent running; the next hook that works tells the orchestrator.
runHook('subagent_stop', main, (note) => ({ systemMessage: note }), { effect: 'The background report was not counted and its gate did not run' })
