#!/usr/bin/env node
/**
 * `/cc-tiers:route` helper. Reads a task description from the arguments or stdin
 * and prints the heuristic tier, its first effort, and the complexity score as
 * JSON. The command applies judgment on top.
 */

import path from 'node:path'
import {
  assessComplexity,
  budgetDecision,
  collectLimits,
  decideTier,
  historyPath,
  isRisky,
  loadHistory,
  loadJson,
  mergeRouting,
  pluginRoot,
  readProjectFile,
  readStdin,
  selectReviewer,
  userFromEnv,
} from './cc_tiers.mjs'

const env = process.env
const text = process.argv.slice(2).join(' ').trim() || readStdin().trim()
const projectDir = env.CLAUDE_PROJECT_DIR || process.cwd()
const { project } = readProjectFile(projectDir)
const routing = mergeRouting(loadJson(path.join(pluginRoot(env), 'config', 'routing.default.json')), project, userFromEnv(env))
const budget = budgetDecision(collectLimits({ env }), routing)
const history = routing.learn ? loadHistory(historyPath(projectDir)) : null
const decision = decideTier(text, routing, { history, conserve: budget.conserve })
const risky = isRisky(text, routing)
const complexity = assessComplexity(text, routing)
const review = selectReviewer({ policy: routing.reviewPolicy, writerTier: decision.tier, risky, conserve: budget.conserve })
const result = {
  ...decision,
  risky,
  complexity: complexity.score,
  signals: complexity.signals,
  review: review || 'no',
  conserve: budget.conserve,
  reviewPolicy: routing.reviewPolicy,
  classifier: routing.classifier,
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
