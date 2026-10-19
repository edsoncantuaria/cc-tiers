#!/usr/bin/env node
/**
 * PreToolUse hook for Agent calls. Refuses a cc-tiers delegation that passes a
 * model override, has no CC_TIERS_TASK header, or goes back below the tier the
 * counter already escalated to. Sets the effort the attempt runs at, and delivers
 * reports counted since the last hook.
 */

import {
  checkDelegation,
  historyPath,
  loadHistory,
  openContext,
  parsePayload,
  preToolOutput,
  readStdin,
  takePending,
  withSession,
} from './cc_tiers.mjs'

function main() {
  const payload = parsePayload(readStdin())
  if (!Object.keys(payload).length) return
  if (payload.tool_name != null && payload.tool_name !== '' && payload.tool_name !== 'Agent') return
  const ctx = openContext(payload)
  const history = ctx.routing.learn && ctx.projectDir ? loadHistory(historyPath(ctx.projectDir)) : null

  const { deny, context, input } = withSession(ctx, payload, (state) => {
    const checked = checkDelegation(state, payload.tool_input, ctx.routing, { history })
    const pending = takePending(state)
    return { deny: checked.deny, input: checked.input, context: [pending, checked.context].filter(Boolean).join('\n\n') }
  })

  if (!deny && !context && !input) return
  process.stdout.write(`${JSON.stringify(preToolOutput(deny, context, input))}\n`)
}

try {
  main()
} catch {
  process.exit(0)
}
