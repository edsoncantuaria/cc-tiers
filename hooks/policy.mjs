/**
 * Policy: the quality profiles and which project checks a task of a given risk should run.
 * Pure data plus file reads; it never runs a command, the verify gate does.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isAllowed } from './verify.mjs'

export const PROFILE_NAMES = ['balanced', 'quality', 'budget', 'fast']

/** effortBoost raises the first attempt of a Sonnet or Opus writer, strictFrom is the first risk that needs standard evidence, reviewFloor the first that needs review. */
export const PROFILES = Object.freeze({
  balanced: Object.freeze({ effortBoost: 0, strictFrom: 'medium', reviewFloor: 'critical', maxParallel: 4, memoryItems: 5, checkDepth: 0 }),
  quality: Object.freeze({ effortBoost: 1, strictFrom: 'low', reviewFloor: 'high', maxParallel: 3, memoryItems: 8, checkDepth: 1 }),
  budget: Object.freeze({ effortBoost: 0, strictFrom: 'medium', reviewFloor: 'critical', maxParallel: 2, memoryItems: 3, checkDepth: 0 }),
  fast: Object.freeze({ effortBoost: 0, strictFrom: 'high', reviewFloor: 'critical', maxParallel: 6, memoryItems: 3, checkDepth: -1 }),
})

const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 }
const MAX_DEPTH = 3
const DEPTH_KINDS = [['test'], ['test'], ['test', 'typecheck', 'lint'], null]
const NPM_PLACEHOLDER = 'echo "Error: no test specified" && exit 1'
const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']

export function parseProfile(value, fallback = 'balanced') {
  const name = String(value ?? '').trim().toLowerCase()
  return PROFILE_NAMES.includes(name) ? name : fallback
}

export function profileSettings(name) {
  return Object.freeze({ ...PROFILES[parseProfile(name)] })
}

/** An unknown risk counts as medium. */
function riskRank(risk) {
  return RISK_RANK[String(risk ?? '').trim().toLowerCase()] ?? RISK_RANK.medium
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readScripts(projectDir) {
  try {
    const scripts = JSON.parse(readText(path.join(projectDir, 'package.json'))).scripts
    return scripts && typeof scripts === 'object' ? scripts : {}
  } catch {
    return {}
  }
}

/** The checks the project's manifests declare, read from files only. */
export function availableChecks(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir) return []
  const has = (name) => existsSync(path.join(projectDir, name))
  const found = []
  const add = (kind, command) => {
    if (!found.some((check) => check.command === command)) found.push({ kind, command })
  }
  const scripts = readScripts(projectDir)
  if (typeof scripts.test === 'string' && scripts.test.trim() !== NPM_PLACEHOLDER) add('test', 'npm test')
  if (scripts.lint) add('lint', 'npm run lint')
  if (scripts.typecheck) add('typecheck', 'npm run typecheck')
  if (scripts['type-check']) add('typecheck', 'npm run type-check')
  if (has('tsconfig.json')) add('typecheck', 'npx tsc --noEmit')
  if (!scripts.lint && ESLINT_CONFIGS.some(has)) add('lint', 'npx eslint .')
  if (has('phpunit.xml') || has('phpunit.xml.dist')) add('test', 'vendor/bin/phpunit')
  if (has('phpstan.neon') || has('phpstan.neon.dist')) add('static', 'vendor/bin/phpstan analyse')
  if (has('pytest.ini') || readText(path.join(projectDir, 'pyproject.toml')).includes('[tool.pytest')) add('test', 'pytest')
  if (has('go.mod')) {
    add('test', 'go test ./...')
    add('static', 'go vet ./...')
  }
  if (has('Cargo.toml')) add('test', 'cargo test')
  if (has('package-lock.json')) add('security', 'npm audit --omit=dev')
  return found
}

/** Checks to run for the risk: deeper for higher risk, shifted by the profile, and critical never below the top depth. */
export function selectChecks(risk, available, { profile = 'balanced', allow = [] } = {}) {
  const rank = riskRank(risk)
  const level = Object.keys(RISK_RANK).find((name) => RISK_RANK[name] === rank)
  const shifted = rank + profileSettings(profile).checkDepth
  const depth = rank === RISK_RANK.critical ? MAX_DEPTH : Math.min(MAX_DEPTH, Math.max(0, shifted))
  const kinds = DEPTH_KINDS[depth]
  const scope = depth === 0 ? 'targeted: the tests that cover the change' : kinds ? kinds.join(', ') : 'all checks'
  return (available || [])
    .filter((check) => !kinds || kinds.includes(check.kind))
    .map(({ kind, command }) => ({
      kind,
      command,
      allowed: isAllowed(command.split(/\s+/), allow),
      why: `${level} risk, depth ${depth}: ${scope}`,
    }))
}

/** How much evidence the report needs: light below the profile's strictFrom, strong for high and critical. */
export function evidenceRule(risk, profile) {
  const rank = riskRank(risk)
  if (rank < riskRank(profileSettings(profile).strictFrom)) return 'light'
  return rank >= RISK_RANK.high ? 'strong' : 'standard'
}

export function reviewRequired(risk, profile) {
  return riskRank(risk) >= riskRank(profileSettings(profile).reviewFloor)
}
