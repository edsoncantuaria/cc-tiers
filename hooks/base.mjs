/**
 * Primitives shared by cc_tiers.mjs and the modules it imports (risk, budget,
 * memory, parallel, workspace), kept here so none of them imports cc_tiers.mjs
 * back. cc_tiers.mjs re-exports each one, so its public API is unchanged.
 */

import { mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const TIERS = ['haiku', 'sonnet', 'opus']

/** A CC_TIERS_TASK value as cc-tiers tracks it: lowercase, runs of other characters as one hyphen, at most 64. */
export function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function dollars(value) {
  const number = Number(value) || 0
  if (number >= 1) return `$${number.toFixed(2)}`
  if (number >= 0.01) return `$${number.toFixed(3)}`
  return `$${number.toFixed(4)}`
}

/** Write to a sibling temp file and rename, so a reader never sees half a file. */
export function writeAtomic(file, body) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, body)
  try {
    renameSync(temp, file)
  } catch {
    // Windows refuses to replace a file another process has open. Write in place instead.
    writeFileSync(file, body)
    try {
      unlinkSync(temp)
    } catch {
      // Left for the next prune.
    }
  }
}

/** A file path named in prose: optional dirs (/ or \), a name that may hold dots, a known extension. */
const FILE_RE =
  /(?:^|[\s`'"(])(\/?(?:[\w.-]+[/\\])*[\w-][\w.-]*\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|cs|cpp|hpp|c|h|php|vue|svelte|css|scss|html|json|ya?ml|toml|md|sql|sh|lock))(?=$|[\s`'"),:;.])/gi

/** A path with its symlinks resolved as far as it exists, so a missing file still compares by its real parent. */
function realPath(file) {
  const rest = []
  for (let current = file; ; current = path.dirname(current)) {
    try {
      return path.join(realpathSync(current), ...rest)
    } catch {
      if (current === path.dirname(current)) return file
      rest.unshift(path.basename(current))
    }
  }
}

/** The path of an absolute file under projectDir, relative to it ('' for the dir itself); null when it lies outside. */
function insideProject(file, projectDir) {
  const root = path.resolve(projectDir)
  for (const [from, to] of [[root, file], [realPath(root), realPath(file)]]) {
    const rel = path.relative(from, to)
    if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return rel.split(path.sep).join('/')
  }
  return null
}

/**
 * One relative path with forward slashes and no ./ prefix; '' for one that climbs out with ../.
 * An absolute path becomes its path under projectDir, and is '' when it lies outside it or there is no projectDir.
 */
export function normalizeFile(file, projectDir = '') {
  let text = String(file || '').trim().replace(/\\/g, '/')
  if (text.startsWith('/') && projectDir) text = insideProject(text, projectDir) ?? text
  text = text.replace(/^\.\//, '')
  if (!text || text.startsWith('/') || /^[a-z]:\//i.test(text) || text.split('/').includes('..')) return ''
  return path.posix.normalize(text)
}

/** The distinct relative file paths a text names, in order, at most max; absolute ones only inside projectDir. */
export function extractFiles(text, max = 40, projectDir = '') {
  const files = []
  for (const match of String(text || '').matchAll(FILE_RE)) {
    const file = normalizeFile(match[1], projectDir)
    if (file && !files.includes(file)) files.push(file)
    if (files.length >= max) break
  }
  return files
}
