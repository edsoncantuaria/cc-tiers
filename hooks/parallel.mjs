/**
 * Controlled parallelism: a registry of writer agents that are running, so two
 * of them never edit the same files in one working tree, plus a concurrency cap
 * and task dependencies. Pure functions over the session state.
 */

import { extractFiles, normalizeFile } from './base.mjs'

export const STALE_MS = 2 * 60 * 60 * 1000
export const DEFAULT_MAX_PARALLEL = 4
const MAX_FILES = 40
const MAX_DEPENDS = 200

/**
 * Files a delegation touches: the CC_TIERS_FILES header when present, else the paths named in the prompt.
 * A list too long to keep becomes the whole project ('.'), so nothing past the cap escapes the overlap check.
 */
export function declaredFiles(headers, body) {
  const listed = String(headers?.FILES || '').trim()
  if (!listed) {
    const named = extractFiles(body, MAX_FILES + 1)
    return { files: named.length > MAX_FILES ? ['.'] : named, declared: false }
  }
  const files = []
  for (const item of listed.split(',')) {
    if (!item.trim()) continue
    const file = scopeEntry(item)
    if (!files.includes(file)) files.push(file)
  }
  return { files: files.length > MAX_FILES || files.includes('.') ? ['.'] : files, declared: true }
}

/**
 * One CC_TIERS_FILES entry as a path the guard can compare: '.' is the whole project,
 * and a glob becomes the fixed directory before its first wildcard (src/*.js -> src/, **\/x -> .).
 */
function scopeEntry(item) {
  const text = String(item || '').trim().replace(/\\/g, '/')
  const wild = text.search(/[*?[\]{}]/)
  // An absolute path or one with ../ cannot be compared with project paths, so it covers everything.
  if (wild < 0) return text === '.' || text === './' ? '.' : normalizeFile(text) || '.'
  const fixed = text.slice(0, wild)
  const dir = fixed.slice(0, fixed.lastIndexOf('/') + 1)
  return dir ? normalizeFile(dir) || '.' : '.'
}

/** A file and a directory entry overlap when one is the other or contains it; a glob-free prefix match. */
function overlaps(a, b) {
  if (a === '.' || b === '.') return true
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x === y || x.startsWith(`${y.replace(/\/$/, '')}/`) || y.startsWith(`${x.replace(/\/$/, '')}/`)
}

export function pruneActive(state, now = Date.now()) {
  const active = state.active && typeof state.active === 'object' && !Array.isArray(state.active) ? state.active : {}
  const stale = []
  for (const [task, entry] of Object.entries(active)) {
    if (!entry || typeof entry !== 'object' || !(now - Number(entry.since) < STALE_MS)) {
      stale.push(task)
      delete active[task]
    }
  }
  state.active = active
  return stale
}

/**
 * Keeps the dependencies each task declared (state.depends), the latest declaration per task, so a later
 * call can see a cycle. Entries of finished tasks are dropped and the oldest go past MAX_DEPENDS.
 */
function rememberDepends(state, task, deps, done) {
  const kept = state.depends && typeof state.depends === 'object' && !Array.isArray(state.depends) ? state.depends : {}
  delete kept[task]
  if (deps.length) kept[task] = deps
  for (const [name, list] of Object.entries(kept)) {
    if (!Array.isArray(list) || done(name)) delete kept[name]
  }
  for (const name of Object.keys(kept).slice(0, Math.max(0, Object.keys(kept).length - MAX_DEPENDS))) delete kept[name]
  state.depends = kept
}

/** The path task -> ... -> task that follows the declared dependencies from `from`, or null when none leads back. */
function cyclePath(depends, task, from) {
  const seen = new Set()
  const walk = (name, trail) => {
    if (name === task) return [...trail, task]
    if (seen.has(name)) return null
    seen.add(name)
    for (const next of Array.isArray(depends[name]) ? depends[name] : []) {
      const found = walk(next, [...trail, name])
      if (found) return found
    }
    return null
  }
  return walk(from, [task])
}

/**
 * Whether a writer may start now. Returns { ok, reason, conflicts }.
 * isolated writers (isolation: worktree) never conflict on files, but still count toward the cap.
 * known(name) tells whether a slug was ever delegated or logged; a dependency it rejects can never pass.
 */
export function checkParallel(state, { task, files, isolated = false, depends = [], maxParallel = DEFAULT_MAX_PARALLEL, done = () => false, known = () => true, now = Date.now() }) {
  pruneActive(state, now)
  const others = Object.entries(state.active).filter(([name]) => name !== task)
  const deps = depends.filter((name) => name !== task)
  rememberDepends(state, task, deps, done)
  const unknown = deps.find((name) => !known(name))
  if (unknown) {
    return { ok: false, conflicts: [], reason: `${task} depends on ${unknown}, which no delegation in this session has. Check the slug, or drop it from CC_TIERS_DEPENDS.` }
  }
  const waiting = deps.filter((name) => !done(name))
  for (const name of waiting) {
    const loop = cyclePath(state.depends, task, name)
    if (loop) return { ok: false, conflicts: [], reason: `${task} and ${name} depend on each other (${loop.join(' -> ')}). Remove one of the CC_TIERS_DEPENDS lines.` }
  }
  if (waiting.length) {
    return { ok: false, conflicts: [], reason: `${task} depends on ${waiting.join(', ')}, which has not passed yet. Finish it first, or drop it from CC_TIERS_DEPENDS.` }
  }
  if (maxParallel > 0 && others.length >= maxParallel) {
    return {
      ok: false,
      conflicts: others.map(([name]) => name),
      reason: `${others.length} writer(s) already running (${others.map(([name]) => name).join(', ')}); max_parallel is ${maxParallel}. Wait for one to finish.`,
    }
  }
  if (isolated) return { ok: true, conflicts: [], reason: '' }
  const conflicts = []
  for (const [name, entry] of others) {
    if (entry.isolated) continue
    const theirs = Array.isArray(entry.files) ? entry.files : []
    // A side that named no files cannot be shown to stay apart from the other.
    if (!files.length || !theirs.length) conflicts.push({ task: name, files: ['(unknown scope)'] })
    else {
      const shared = files.filter((file) => theirs.some((other) => overlaps(file, other)))
      if (shared.length) conflicts.push({ task: name, files: shared })
    }
  }
  if (!conflicts.length) return { ok: true, conflicts, reason: '' }
  const list = conflicts.map((item) => `${item.task} (${item.files.join(', ')})`).join('; ')
  return {
    ok: false,
    conflicts,
    reason:
      `${task} may edit the same files as a running writer: ${list}. Run it after that one finishes, name its files in CC_TIERS_FILES, ` +
      'or call it with isolation: "worktree" and merge the result yourself. If that writer is no longer running, add CC_TIERS_RELEASE: <its slug>.',
  }
}

export function registerActive(state, { task, role, files, isolated = false, now = Date.now() }) {
  if (!state.active || typeof state.active !== 'object' || Array.isArray(state.active)) state.active = {}
  state.active[task] = { role, files: files.length > MAX_FILES ? ['.'] : [...files], isolated: Boolean(isolated), since: now }
}

export function releaseActive(state, task) {
  if (state.active && Object.hasOwn(state.active, task)) {
    delete state.active[task]
    return true
  }
  return false
}
