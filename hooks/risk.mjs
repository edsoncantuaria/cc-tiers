/**
 * Risk assessment: scores a task on five 0..3 dimensions and maps them to a level.
 * Pure text and path matching, so it can be imported by cc_tiers.mjs without a cycle.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fold } from './verify.mjs'

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']
/** A risk keyword in the task text while every file it names is ordinary: high risk, Sonnet writes it, Opus must review it. */
export const TEXT_KEYWORD_FACTOR = 'risk keyword, no sensitive file named'
/** A risk keyword with no proof the files are ordinary: still only high risk, since critical needs a sensitive path. */
export const KEYWORD_FACTOR = 'risk keyword'

// Whole words of a path, so docs/author.md or src/tokenizer.js are not sensitive; `.env` is matched as a file name.
const SENSITIVE_WORDS = new Set([
  'auth', 'oauth', 'authn', 'authz', 'authenticate', 'authenticated', 'authentication', 'authorize', 'authorized',
  'authorization', 'login', 'logout', 'signin', 'session', 'sessions', 'permission', 'permissions', 'acl', 'rbac',
  'payment', 'payments', 'billing', 'invoice', 'invoices', 'checkout', 'migrate', 'migration', 'migrations', 'schema',
  'schemas', 'security', 'crypto', 'cryptography', 'encrypt', 'encryption', 'decrypt', 'decryption', 'secret', 'secrets',
  'credential', 'credentials', 'token', 'jwt', 'password', 'passwords', 'passwd',
])
const ENV_FILE_RE = /^\.env(?:\.|$)/
const MANIFEST_RE = /^(?:package(?:-lock)?\.json|composer\.(?:json|lock)|requirements[^/]*\.txt|pyproject\.toml|go\.(?:mod|sum)|cargo\.(?:toml|lock)|yarn\.lock|pnpm-lock\.yaml|gemfile(?:\.lock)?)$/
const DATA_WORDS = ['database', 'sql*', 'persist*', 'delete data', 'drop', 'banco de dados', 'dados persistidos', 'storage format']
const CONTRACT_WORDS = [
  'public api', 'exported', 'endpoint', 'public interface', 'contract', 'breaking', 'signature', 'cli flag', 'config format',
  'api publica', 'contrato',
]
const DEPENDENCY_WORDS = [
  'upgrade*', 'bump*', 'dependenc*', 'version*', 'versao*', 'package.json', 'composer.json', 'requirements.txt', 'pyproject',
  'go.mod', 'cargo.toml', 'lockfile', 'lock file',
]
const HEDGES = [
  'maybe', 'somehow', 'something like', 'or something', 'etc', 'not sure', 'figure out', 'should we', 'talvez', 'algo como',
  'nao sei', 'descobrir', 'de alguma forma',
]
const TEST_DIRS = ['test', 'tests', '__tests__', 'spec']
const TEST_FILES = ['pytest.ini', 'phpunit.xml', 'phpunit.xml.dist', 'go.mod', 'Cargo.toml']
const NPM_PLACEHOLDER = 'echo "Error: no test specified" && exit 1'
export const MAKEFILES = ['GNUmakefile', 'makefile', 'Makefile']

export function riskRank(level) {
  return RISK_LEVELS.indexOf(level)
}

/** A term ending in `*` matches any word that starts with it; any other term is a whole word, plural or -ed/-ing allowed. */
function termRegex(term) {
  const open = term.endsWith('*')
  const body = (open ? term.slice(0, -1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  // A doubled last consonant covers dropped/dropping.
  const doubled = open ? '' : `${body.slice(-1)}?`
  return new RegExp(`(^|[^a-z0-9])${body}${open ? '' : `${doubled}(?:s|es|ed|ing)?(?![a-z0-9])`}`)
}

const compile = (terms) => terms.map((term) => ({ term: term.replace(/\*$/, ''), re: termRegex(term) }))
const DATA_RES = compile(DATA_WORDS)
const CONTRACT_RES = compile(CONTRACT_WORDS)
const DEPENDENCY_RES = compile(DEPENDENCY_WORDS)
const HEDGE_RES = compile(HEDGES)

const anyMatch = (hay, compiled) => compiled.some(({ re }) => re.test(hay))

const baseName = (file) => file.slice(file.lastIndexOf('/') + 1).toLowerCase()

function pathWords(file) {
  const spaced = file.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z])(\d)/gi, '$1 $2')
  return fold(spaced).split(/[^a-z0-9]+/)
}

export const isSensitivePath = (file) => ENV_FILE_RE.test(baseName(file)) || pathWords(file).some((word) => SENSITIVE_WORDS.has(word))

function topLevelDirs(files) {
  const dirs = new Set()
  for (const file of files) {
    const parts = file.replace(/^[a-z]:/i, '').split('/').filter((part) => part && part !== '.')
    if (parts.length > 1) dirs.add(parts[0])
  }
  return dirs.size
}

function complexityLevel(score) {
  if (!(score >= 1)) return 0
  if (score < 2) return 1
  return score < 4 ? 2 : 3
}

/** Scores a task on complexity, regression, sensitivity, ambiguity and evidence, and derives the risk level from them. */
export function assessRisk(input) {
  const {
    text = '',
    files = [],
    keywordRisk = false,
    complexity = { score: 0, signals: [] },
    history = { haiku: false, sonnet: false },
    testsAvailable = null,
  } = input && typeof input === 'object' ? input : {}
  return scoreRisk({ text, files, keywordRisk, complexity, history, testsAvailable })
}

function scoreRisk({ text, files, keywordRisk, complexity, history, testsAvailable }) {
  const hay = fold(typeof text === 'string' ? text : '')
  const paths = (Array.isArray(files) ? files : []).filter((file) => typeof file === 'string').map((file) => file.replace(/\\/g, '/'))
  const factors = []

  const rawScore = Number(complexity?.score)
  const complexityScore = complexityLevel(rawScore)
  if (complexityScore) factors.push(`complexity score ${rawScore}`)

  let sensitivity = 0
  if (keywordRisk) {
    sensitivity = 2
    factors.push(keywordRisk === 'text' ? TEXT_KEYWORD_FACTOR : KEYWORD_FACTOR)
  }
  for (const file of paths) {
    if (!isSensitivePath(file)) continue
    sensitivity = 3
    factors.push(`sensitive path: ${file}`)
  }
  if (sensitivity < 2 && anyMatch(hay, DATA_RES)) {
    sensitivity = 2
    factors.push('persistent data')
  }

  let regression = 0
  if (anyMatch(hay, CONTRACT_RES)) {
    regression += 2
    factors.push('public contract')
  }
  if (anyMatch(hay, DEPENDENCY_RES) || paths.some((file) => MANIFEST_RE.test(baseName(file)))) {
    regression += 1
    factors.push('dependency or version')
  }
  const dirs = topLevelDirs(paths)
  if (dirs >= 3) {
    regression += 1
    factors.push(`files in ${dirs} top-level directories`)
  }
  if (history?.sonnet) {
    regression += 1
    factors.push('earlier sonnet attempt failed')
  }
  regression = Math.min(regression, 3)

  const hedges = HEDGE_RES.filter(({ re }) => re.test(hay))
  let ambiguity = hedges.length
  for (const { term } of hedges) factors.push(`hedge: ${term}`)
  if ((hay.match(/\?/g) || []).length >= 2) {
    ambiguity += 1
    factors.push('several questions')
  }
  ambiguity = Math.min(ambiguity, 3)

  let evidence = testsAvailable === false ? 2 : testsAvailable === true ? 0 : 1
  if (testsAvailable === false) factors.push('no tests')
  else if (testsAvailable !== true) factors.push('tests unknown')
  if (history?.haiku) {
    evidence += 1
    factors.push('earlier haiku attempt failed')
  }
  evidence = Math.min(evidence, 3)

  const sum = complexityScore + regression + ambiguity + evidence
  let level = 'low'
  if (sensitivity === 3) level = 'critical'
  else if (sensitivity === 2 || (regression >= 2 && complexityScore >= 2) || sum >= 6) level = 'high'
  else if (sum >= 2 || regression >= 1 || sensitivity >= 1) level = 'medium'

  return { level, dimensions: { complexity: complexityScore, regression, sensitivity, ambiguity, evidence }, factors }
}

/** package.json or composer.json: a real `scripts.test`, a command string or a composer list of commands. */
function hasTestScript(manifestPath) {
  try {
    const script = JSON.parse(readFileSync(manifestPath, 'utf8'))?.scripts?.test
    if (Array.isArray(script)) return script.length > 0
    return typeof script === 'string' && script.trim() !== '' && script.trim() !== NPM_PLACEHOLDER
  } catch {
    return false
  }
}

/** A `<target>:` rule line, not `.PHONY: test`, a `test := x` or `test ::= x` assignment, or a recipe line. */
export function hasMakeRule(makefilePath, target) {
  try {
    return new RegExp(`^${target}\\s*:(?!:?=)`, 'm').test(readFileSync(makefilePath, 'utf8'))
  } catch {
    return false
  }
}

/** true when the project has a test directory (any letter case), test script, Makefile test rule or test runner config; null when the directory is unknown. */
export function testsAvailableIn(projectDir) {
  try {
    if (!projectDir || typeof projectDir !== 'string' || !statSync(projectDir).isDirectory()) return null
    const isDir = (name) => existsSync(path.join(projectDir, name)) && statSync(path.join(projectDir, name)).isDirectory()
    if (readdirSync(projectDir).some((name) => TEST_DIRS.includes(name.toLowerCase()) && isDir(name))) return true
    if (TEST_FILES.some((name) => existsSync(path.join(projectDir, name)))) return true
    return hasTestScript(path.join(projectDir, 'package.json')) || hasTestScript(path.join(projectDir, 'composer.json')) || MAKEFILES.some((name) => hasMakeRule(path.join(projectDir, name), 'test'))
  } catch {
    return null
  }
}
