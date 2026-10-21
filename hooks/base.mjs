/**
 * Primitives shared by cc_tiers.mjs and the modules it imports (risk, budget,
 * memory, parallel, workspace), kept here so none of them imports cc_tiers.mjs
 * back. cc_tiers.mjs re-exports each one, so its public API is unchanged.
 */

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const TIERS = ['haiku', 'sonnet', 'opus']

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
  /(?:^|[\s`'"(])((?:[\w.-]+[/\\])*[\w-][\w.-]*\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|cs|cpp|hpp|c|h|php|vue|svelte|css|scss|html|json|ya?ml|toml|md|sql|sh|lock))(?=$|[\s`'"),:;.])/gi

/** One relative path with forward slashes and no ./ prefix; '' for an absolute path or one that climbs out with ../. */
export function normalizeFile(file) {
  const text = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!text || text.startsWith('/') || /^[a-z]:\//i.test(text) || text.split('/').includes('..')) return ''
  return path.posix.normalize(text)
}

/** The distinct relative file paths a text names, in order, at most max. */
export function extractFiles(text, max = 40) {
  const files = []
  for (const match of String(text || '').matchAll(FILE_RE)) {
    const file = normalizeFile(match[1])
    if (file && !files.includes(file)) files.push(file)
    if (files.length >= max) break
  }
  return files
}
