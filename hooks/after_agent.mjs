#!/usr/bin/env node
/** PostToolUse / PostToolUseFailure hook for Agent calls from cc-tiers. */

import {
  applyEvent,
  attributeTranscript,
  budgetDecision,
  collectLimits,
  ensureHistoryGitignore,
  findCcCost,
  formatTaskSpend,
  historyPath,
  hookOutput,
  loadHistory,
  loadJson,
  loadState,
  mergeRouting,
  mergeTranscriptSpend,
  normalizeEvent,
  noteHaikuFailure,
  parsePayload,
  pluginRoot,
  readProjectFile,
  readStdin,
  readTranscript,
  saveHistory,
  saveState,
  sessionPath,
  usageFromToolResponse,
  userFromEnv,
} from './cc_tiers.mjs'

function main() {
  const raw = readStdin()
  const payload = parsePayload(raw)
  if (!Object.keys(payload).length) return
  const event = normalizeEvent(payload)
  if (!event) return

  const env = process.env
  const root = pluginRoot(env)
  const defaults = loadJson(`${root}/config/routing.default.json`)
  const projectDir = env.CLAUDE_PROJECT_DIR || ''
  const { project } = readProjectFile(projectDir || null)
  const routing = mergeRouting(defaults, project, userFromEnv(env))
  const transcript = readTranscript(payload.transcript_path)
  const budget = budgetDecision(collectLimits({ payload, transcript, env }), routing)
  routing.conserve = budget.conserve

  const dataDir = env.CLAUDE_PLUGIN_DATA || ''
  const sessionId = event.session_id || 'unknown'
  const file = dataDir ? sessionPath(dataDir, sessionId) : null
  let state = file ? loadState(file, sessionId) : { session_id: sessionId, seen: [], tasks: {}, spend: {} }

  const applied = applyEvent(state, event, routing)
  state = applied.state
  let message = applied.message
  const installed = findCcCost(env)
  if (installed) {
    const transcriptSpend = transcript ? attributeTranscript(transcript) : null
    const extraUsage = usageFromToolResponse(payload.tool_response, event.role)
    mergeTranscriptSpend(
      state,
      transcriptSpend,
      extraUsage && applied.meta.task
        ? { task: applied.meta.task, tier: extraUsage.tier, tokens: extraUsage.tokens }
        : null,
    )
  }

  if (applied.meta.haikuFailure && routing.learn && projectDir) {
    const history = noteHaikuFailure(loadHistory(historyPath(projectDir)), {
      task: applied.meta.task,
      prompt: applied.meta.prompt,
      reason: applied.meta.reason,
    })
    saveHistory(historyPath(projectDir), history)
    ensureHistoryGitignore(projectDir)
    message += `\ncc-tiers recorded a Haiku failure for ${applied.meta.task}. Similar tasks will start on Sonnet.`
  }

  if (installed && applied.meta.task && state.spend?.[applied.meta.task]) {
    const line = formatTaskSpend(applied.meta.task, state.spend[applied.meta.task])
    if (line) message = message ? `${message}\n${line}` : line
  }

  if (file) saveState(file, state)
  if (!message) return
  const eventName = String(payload.hook_event_name || 'PostToolUse')
  process.stdout.write(`${JSON.stringify(hookOutput(eventName, message))}\n`)
}

try {
  main()
} catch {
  process.exit(0)
}
