#!/usr/bin/env node
/**
 * `/cc-tiers:memory` helper: list, add, invalidate, delete, prune or clear the
 * project's engineering memory. Usage: memory_cli.mjs <projectDir> <action> [args].
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withLock } from './cc_tiers.mjs'
import {
  MEMORY_CATEGORIES,
  sanitize,
  addRecord,
  emptyMemory,
  invalidateRecord,
  loadMemory,
  memoryPath,
  pruneMemory,
  removeRecord,
  saveMemory,
  staleReason,
} from './memory.mjs'

const USAGE = [
  'Usage: memory_cli.mjs <projectDir> <action>',
  '  list [--all]                     live records (--all adds stale ones)',
  `  add <category> <text...>         category: ${MEMORY_CATEGORIES.join(', ')}`,
  '  invalidate <id> <reason...>      keep the record but never recall it',
  '  delete <id>                      remove one record',
  '  prune                            remove expired, invalidated and stale records',
  '  clear --yes                      remove every record',
].join('\n')

/** Every cell is sanitized again, so nothing read from the file can print a line of its own or a secret. */
function cell(value) {
  return sanitize(value, 300).replace(/\|/g, '\\|') || '—'
}

export function renderList(memory, { all = false, now = Date.now(), projectDir = '' } = {}) {
  const rows = memory.records
    .map((record) => ({ record, stale: staleReason(record, { now, projectDir }) }))
    .filter((row) => all || !row.stale)
  if (!rows.length) return 'cc-tiers memory is empty for this project.\n'
  const lines = ['| Id | Category | Status | Confidence | Content | Evidence | Valid |', '| --- | --- | --- | --- | --- | --- | --- |']
  for (const { record, stale } of rows) {
    const valid = stale || (record.validUntil ? `until ${record.validUntil.slice(0, 10)}` : 'until invalidated')
    lines.push(`| ${cell(record.id)} | ${cell(record.category)} | ${cell(record.status)} | ${cell(record.confidence)} | ${cell(record.content)} | ${cell(record.evidence)} | ${cell(valid)} |`)
  }
  return `${lines.join('\n')}\n`
}

/** Runs one action and returns the text to print; changes are saved under the file's lock. */
export function run(argv, { now = Date.now() } = {}) {
  const [projectDir, action = 'list', ...rest] = argv
  if (!projectDir || !existsSync(projectDir)) return { code: 2, out: `${USAGE}\n` }
  const file = memoryPath(projectDir)
  const change = (fn) =>
    withLock(file, () => {
      const result = fn(loadMemory(file))
      if (result.memory) saveMemory(file, result.memory)
      return result
    })
  if (action === 'list') return { code: 0, out: renderList(loadMemory(file), { all: rest.includes('--all'), now, projectDir }) }
  if (action === 'add') {
    const [category, ...words] = rest
    const result = change((memory) => addRecord(memory, { category, content: words.join(' '), source: 'user', confidence: 'high', status: 'confirmed' }, { now, projectDir }))
    return result.record ? { code: 0, out: `Added ${result.record.id}.\n` } : { code: 1, out: `Nothing added. ${USAGE}\n` }
  }
  if (action === 'invalidate' && rest[0]) {
    const result = change((memory) => invalidateRecord(memory, rest[0], rest.slice(1).join(' ') || 'invalidated by the user', { now }))
    return result.found ? { code: 0, out: `Invalidated ${rest[0]}.\n` } : { code: 1, out: `No record ${rest[0]}.\n` }
  }
  if (action === 'delete' && rest[0]) {
    const result = change((memory) => removeRecord(memory, rest[0]))
    return result.found ? { code: 0, out: `Deleted ${rest[0]}.\n` } : { code: 1, out: `No record ${rest[0]}.\n` }
  }
  if (action === 'prune') {
    const result = change((memory) => pruneMemory(memory, { now, projectDir }))
    return { code: 0, out: `Pruned ${result.removed} record(s).\n` }
  }
  if (action === 'clear') {
    if (!rest.includes('--yes')) return { code: 1, out: 'clear removes every record; run it again with --yes.\n' }
    change(() => ({ memory: emptyMemory() }))
    return { code: 0, out: 'Cleared the cc-tiers memory of this project.\n' }
  }
  return { code: 2, out: `${USAGE}\n` }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const result = run(process.argv.slice(2))
  process.stdout.write(result.out)
  process.exitCode = result.code
}
