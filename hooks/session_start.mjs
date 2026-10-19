#!/usr/bin/env node
/** SessionStart hook: inject the effective cc-tiers routing summary. */

import {
  formatSessionContext,
  historyPath,
  hookOutput,
  loadHistory,
  openContext,
  parsePayload,
  readStdin,
  readTodayTotal,
  takePending,
  withSession,
} from './cc_tiers.mjs'

function fallback(error) {
  return hookOutput(
    'SessionStart',
    'cc-tiers is enabled. The routing summary could not be built ' +
      `(${error?.name || 'Error'}). Defaults still apply: max attempts per tier is 2, ` +
      'review policy is cheap, escalation is haiku then sonnet then opus.',
  )
}

function main() {
  const payload = parsePayload(readStdin())
  const ctx = openContext(payload)
  const { routing, ccCost: installed } = ctx
  const history = routing.learn && ctx.projectDir ? loadHistory(historyPath(ctx.projectDir)) : null
  const { text, pending } = withSession(ctx, payload, (state, { budget }) => ({
    pending: takePending(state),
    text: formatSessionContext(routing, ctx.projectNote, {
      budget,
      history: routing.learn ? history : null,
      ccCost: { installed },
      spend: installed ? state.spend || {} : null,
      today: installed ? readTodayTotal(ctx.env) : null,
      cost: state.cost || {},
    }),
  }))
  const body = pending ? `${text}\n\n${pending}` : text
  process.stdout.write(`${JSON.stringify(hookOutput('SessionStart', body))}\n`)
}

try {
  main()
} catch (error) {
  process.stdout.write(`${JSON.stringify(fallback(error))}\n`)
  process.exit(0)
}
