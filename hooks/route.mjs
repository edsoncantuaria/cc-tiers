#!/usr/bin/env node
/**
 * `/cc-tiers:route` helper. Reads a task description from the arguments or stdin
 * and prints the heuristic tier as JSON. The command applies judgment on top.
 */

import path from 'node:path'
import {
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
const review = selectReviewer({ policy: routing.reviewPolicy, writerTier: decision.tier, risky, conserve: budget.conserve })
process.stdout.write(
  `${JSON.stringify({ ...decision, risky, review: review || 'no', conserve: budget.conserve, reviewPolicy: routing.reviewPolicy }, null, 2)}\n`,
)
