#!/usr/bin/env node
/**
 * Stop and UserPromptSubmit hook. Catches up on the transcript (which counts an
 * Opus ceiling trailer) and delivers reports that are still waiting. On
 * UserPromptSubmit it also adds the light-path note for a one-task trivial request
 * and titles the session for a /cc-tiers:study prompt.
 * On Stop it also runs the verification gate of ceiling and dispatcher passes
 * parked by the scan, and the judgment of a background agent's hand-back row
 * (outside the session lock, the commands can take minutes)
 * and asks the orchestrator to continue once, so a retry or an escalation is
 * not dropped at the end of the turn. A review that still waits for its verdict
 * keeps blocking, naming its agent, for up to 3 consecutive Stops.
 */

import { runHook } from './integrity.mjs'

async function main(payload) {
  const {
    historyPath,
    hookOutput,
    lightHint,
    loadHistory,
    openContext,
    countParked,
    dropAwaiting,
    peekAwaiting,
    peekParked,
    prepareParked,
    redoFromPrompt,
    releaseIdleWriters,
    reviewVerdictAsks,
    studyTitle,
    takePending,
    withSession,
  } = await import('./cc_tiers.mjs')
  if (!Object.keys(payload).length) return
  const eventName = String(payload.hook_event_name || 'Stop')
  const ctx = openContext(payload)
  const prompting = eventName === 'UserPromptSubmit'
  const history = prompting && ctx.routing.learn && ctx.projectDir ? loadHistory(historyPath(ctx.projectDir)) : null
  if (prompting) {
    const message = withSession(ctx, payload, (state) => {
      const pending = takePending(state)
      const hint = lightHint(payload.prompt, ctx.routing, { history, conserve: ctx.routing.conserve === true, projectDir: ctx.projectDir })
      return [pending, ...redoFromPrompt(state, payload.prompt, payload.origin), hint].filter(Boolean).join('\n\n')
    })
    const title = studyTitle(payload.prompt)
    if (message || title) process.stdout.write(`${JSON.stringify(hookOutput('UserPromptSubmit', message, title))}\n`)
    return
  }
  const { asks, awaiting, given, peeks, pending } = withSession(ctx, payload, (state) => {
    releaseIdleWriters(state)
    const parked = peekAwaiting(state)
    return { ...reviewVerdictAsks(state), awaiting: parked, peeks: peekParked(state, parked), pending: takePending(state) }
  })
  const prepared = prepareParked(ctx, awaiting, payload, { peeks })
  // The second scan may count a new trailer; its message goes out with the gated ones. Only the counted ids leave the parked list.
  const gated = prepared.length
    ? withSession(ctx, payload, (state) => {
        const messages = prepared.map((event) => countParked(ctx, state, event))
        dropAwaiting(state, prepared.map((event) => event.id))
        return [takePending(state), ...messages]
      })
    : []
  const message = [pending, ...gated, ...asks, ...given].filter(Boolean).join('\n\n')
  if (!message) return
  // A review waiting for its verdict blocks even while a stop hook already continues Claude: the ask count, not stop_hook_active, bounds it.
  // An ask that ran out, with nothing else to say, only tells the user.
  const quiet = payload.stop_hook_active === true || ![pending, ...gated].some(Boolean)
  const output = !asks.length && quiet ? { systemMessage: message } : { decision: 'block', reason: message }
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

runHook('stop', main, (note, payload) => {
  if (String(payload.hook_event_name || 'Stop') === 'UserPromptSubmit') return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note } }
  // Blocked once; when Claude is already continuing from a stop hook, only the user is told.
  return payload.stop_hook_active === true ? { systemMessage: note } : { decision: 'block', reason: note }
})
