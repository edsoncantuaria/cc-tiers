#!/usr/bin/env node
/** SessionStart hook: inject the effective cc-tiers routing summary. */

import {
  budgetDecision,
  collectLimits,
  findCcCost,
  formatSessionContext,
  hookOutput,
  loadHistory,
  loadJson,
  loadState,
  mergeRouting,
  parsePayload,
  pluginRoot,
  readProjectFile,
  readTodayTotal,
  readTranscript,
  saveState,
  sessionPath,
  userFromEnv,
  readStdin,
  historyPath,
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
  const env = process.env
  const root = pluginRoot(env)
  const defaults = loadJson(`${root}/config/routing.default.json`)
  const projectDir = env.CLAUDE_PROJECT_DIR || ''
  const { project, note } = readProjectFile(projectDir || null)
  const routing = mergeRouting(defaults, project, userFromEnv(env))
  const transcript = readTranscript(payload.transcript_path)
  const limits = collectLimits({ payload, transcript, env })
  const budget = budgetDecision(limits, routing)
  routing.conserve = budget.conserve
  const installed = findCcCost(env)
  const history = routing.learn && projectDir ? loadHistory(historyPath(projectDir)) : null
  const dataDir = env.CLAUDE_PLUGIN_DATA || ''
  const sessionId = String(payload.session_id || 'unknown')
  let spend = {}
  if (dataDir) {
    const file = sessionPath(dataDir, sessionId)
    const state = loadState(file, sessionId)
    saveState(file, state)
    spend = state.spend || {}
  }
  const text = formatSessionContext(routing, note, {
    budget,
    history: routing.learn ? history : null,
    ccCost: { installed },
    spend: installed ? spend : null,
    today: installed ? readTodayTotal(env) : null,
  })
  process.stdout.write(`${JSON.stringify(hookOutput('SessionStart', text))}\n`)
}

try {
  main()
} catch (error) {
  process.stdout.write(`${JSON.stringify(fallback(error))}\n`)
  process.exit(0)
}
