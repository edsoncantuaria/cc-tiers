/**
 * The working tree around an attempt: a fingerprint that ties a verification to
 * one version of the files, the files an attempt changed, sensitive or
 * out-of-scope edits, and validation of the session state on load.
 * git runs without a shell and read-only; outside a repo everything is empty.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { TIERS } from './base.mjs'

const GIT_TIMEOUT_MS = 5000
export const MAX_FILES = 400
/** Files larger than this are fingerprinted by size and mtime instead of content. */
const HASH_LIMIT = 5 * 1024 * 1024

/** Patterns of files a task should not touch without saying so: secrets, CI, lockfiles, agent config. */
const SENSITIVE = [
  [/(^|\/)\.env($|\.)/i, 'environment file'],
  [/\.(pem|key|p12|pfx|jks|keystore)$/i, 'key material'],
  [/(^|\/)(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$/i, 'ssh key'],
  [/(^|\/)(credentials|secrets?)(\.[a-z]+)?$/i, 'credentials file'],
  [/(^|\/)\.npmrc$|(^|\/)\.pypirc$|(^|\/)\.netrc$/i, 'registry credentials'],
  [/^\.github\/workflows\//i, 'CI workflow'],
  [/(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$/i, 'CI pipeline'],
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i, 'lockfile'],
  [/(^|\/)\.claude\/(settings[^/]*\.json|hooks\/)/i, 'Claude Code settings'],
  [/(^|\/)\.git\//, 'git internals'],
  [/(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml)$/i, 'container config'],
]

function git(dir, args) {
  if (!dir) return null
  try {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    return result.status === 0 ? result.stdout : null
  } catch {
    return null
  }
}

/**
 * Paths in `git status --porcelain=v1 -z` output: NUL separated, never quoted,
 * spaces kept; a rename or copy entry is followed by its old path, which is skipped.
 */
export function parsePorcelainZ(text) {
  const files = []
  let truncated = false
  const parts = String(text || '').split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]
    if (entry.length < 4) continue
    if (/^[RC]/.test(entry)) index += 1
    const file = entry.slice(3)
    if (files.includes(file)) continue
    if (files.length >= MAX_FILES) {
      truncated = true
      break
    }
    files.push(file)
  }
  return { files, truncated }
}

/** Content hash of one working-tree file: 'gone' when deleted, size and mtime above HASH_LIMIT. */
function contentHash(dir, file) {
  try {
    const full = path.join(dir, file)
    const stat = statSync(full)
    if (!stat.isFile()) return 'not-a-file'
    if (stat.size > HASH_LIMIT) return `size:${stat.size}:${stat.mtimeMs}`
    return createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16)
  } catch {
    return 'gone'
  }
}

/**
 * { files, hashes, truncated } for every file that differs from HEAD or is untracked,
 * hashing the working-tree content, so a second edit to an already dirty file
 * (tracked or not) shows up. null outside a git repo.
 */
export function workspaceSnapshot(dir, run = git) {
  const status = run(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status == null) return null
  // Porcelain paths are relative to the repo root, whatever the cwd inside the repo.
  const root = String(run(dir, ['rev-parse', '--show-toplevel']) ?? '').trim() || dir
  const { files, truncated } = parsePorcelainZ(status)
  const hashes = {}
  for (const file of files) hashes[file] = contentHash(root, file)
  return { files, hashes, truncated }
}

/** HEAD plus the snapshot of every dirty file; '' outside a git repo. */
export function treeFingerprint(dir, run = git) {
  const head = run(dir, ['rev-parse', 'HEAD'])
  if (head == null) return ''
  const snap = workspaceSnapshot(dir, run)
  // A truncated list cannot vouch for every file, so no fingerprint means no reuse of a result.
  if (!snap || snap.truncated) return ''
  const body = snap.files.map((file) => `${file}\0${snap.hashes[file]}`).join('\n')
  return createHash('sha256').update(`${head.trim()}\0${body}\0${snap.truncated}`).digest('hex').slice(0, 20)
}

/** Files that changed between two snapshots: newly dirty, edited again, or reverted to HEAD. */
export function attemptChanges(before, after) {
  if (!after) return []
  const prior = before?.hashes || {}
  const changed = after.files.filter((file) => !Object.hasOwn(prior, file) || prior[file] !== after.hashes[file])
  for (const file of before?.files || []) if (!Object.hasOwn(after.hashes, file) && !changed.includes(file)) changed.push(file)
  return changed
}

/** [{ file, why }] for each sensitive file in the list. */
export function sensitiveFiles(files) {
  const found = []
  for (const file of files || []) {
    const normal = String(file).replace(/\\/g, '/')
    const hit = SENSITIVE.find(([pattern]) => pattern.test(normal))
    if (hit) found.push({ file: normal, why: hit[1] })
  }
  return found
}

const TEST_FILE_RE = /(?:^|\/)(?:test_([^/]+)|([^/]+?)(?:[._-](?:test|spec)s?))\.[a-z0-9]+$/i

/** The name a test file covers: users.test.mjs, users.spec.ts, users_test.go, test_users.py all give 'users'. */
function testedName(file) {
  const match = TEST_FILE_RE.exec(file)
  return match ? match[1] || match[2] : ''
}

function stem(file) {
  return path.posix.basename(file).replace(/\.[^.]+$/, '')
}

/**
 * Changed files outside the declared scope; [] when no scope was declared.
 * A test file counts as in scope only when it tests a declared file by name, or sits under a declared dir.
 * Paths compare case-sensitively, as git does.
 */
export function outOfScope(changed, declared) {
  if (!declared?.length) return []
  const clean = (item) => path.posix.normalize(String(item).replace(/\\/g, '/'))
  const scope = declared.map(clean)
  const stems = new Set(scope.filter((item) => !item.endsWith('/')).map(stem))
  return (changed || []).filter((file) => {
    const normal = clean(file)
    if (scope.some((item) => normal === item || normal.startsWith(`${item.replace(/\/$/, '')}/`))) return false
    const tested = testedName(normal)
    return !(tested && stems.has(tested))
  })
}

/**
 * Drop task entries that cannot be trusted: an unknown tier, failures that are
 * not a list of strings, or more failures than the attempt limit allows below Opus.
 * Returns the problems found, so the caller can audit them instead of resuming.
 */
export function validateState(state, { maxAttempts = 5 } = {}) {
  const problems = []
  const tasks = state?.tasks
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return problems
  for (const [task, entry] of Object.entries(tasks)) {
    let problem = ''
    if (!/^[a-z0-9-]{1,64}$/.test(task)) problem = 'bad slug'
    else if (!entry || typeof entry !== 'object') problem = 'not an object'
    else if (!TIERS.includes(entry.tier)) problem = `unknown tier ${String(entry.tier).slice(0, 20)}`
    else if (!Array.isArray(entry.failures) || entry.failures.some((note) => typeof note !== 'string')) problem = 'failures is not a list of notes'
    // Opus is the last tier: its stopped entry keeps every later failure, so only lower tiers have a ceiling.
    else if (entry.tier !== 'opus' && entry.failures.length > maxAttempts) problem = `${entry.failures.length} failures over the limit ${maxAttempts}`
    else if (entry.carried != null && (!Array.isArray(entry.carried) || entry.carried.some((note) => typeof note !== 'string'))) problem = 'carried is not a list of notes'
    if (problem) {
      problems.push(`${task.slice(0, 64)}: ${problem}`)
      delete tasks[task]
    }
  }
  return problems
}
