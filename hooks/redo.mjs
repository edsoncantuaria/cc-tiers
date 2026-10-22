#!/usr/bin/env node
/**
 * `/cc-tiers:redo` helper: marks a finished task as sent back by the user, or removes the mark.
 * Usage: redo.mjs <dataDir> <sessionId> [--telemetry <level>] [--project <dir>] <slug> [reason...]
 *    or: redo.mjs <dataDir> <sessionId> [--telemetry <level>] [--project <dir>] --undo <slug>.
 */

import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slug, writeAtomic } from './base.mjs'
import { flushEvents, loadState, markRedo, openContext, own, saveState, sessionPath, undoRedo, withLock } from './cc_tiers.mjs'

const USAGE = ['Usage: redo.mjs <dataDir> <sessionId> <slug> [reason...]', '       redo.mjs <dataDir> <sessionId> --undo <slug>'].join('\n')

// A command's bash line has no CLAUDE_PLUGIN_OPTION_* or CLAUDE_PROJECT_DIR, so redo.md passes them as arguments.
const SETTINGS = new Map([
  ['--telemetry', 'CLAUDE_PLUGIN_OPTION_TELEMETRY'],
  ['--project', 'CLAUDE_PROJECT_DIR'],
])
const PLACEHOLDER_RE = /\$\{[^}]*\}/

/** Splits the leading --telemetry/--project pairs off the arguments; an empty value or an unsubstituted placeholder is dropped. */
function takeSettings(args) {
  const env = {}
  let index = 0
  while (SETTINGS.has(args[index])) {
    const value = String(args[index + 1] ?? '').trim()
    if (value && !PLACEHOLDER_RE.test(value)) env[SETTINGS.get(args[index])] = value
    index += 2
  }
  return { env, rest: args.slice(index) }
}

function readRaw(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** A session file pruned while this runs reads as null instead of throwing. */
function statOf(file) {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

/** Session files that record the task: this session first, then the others, newest first, each with the times it had before this read. */
function sessionsWith(dataDir, sessionId, task) {
  const current = sessionPath(dataDir, sessionId)
  const others = existsSync(dataDir)
    ? readdirSync(dataDir)
        .filter((name) => name.startsWith('session-') && name.endsWith('.json'))
        .map((name) => path.join(dataDir, name))
        .filter((file) => file !== current)
        .map((file) => ({ file, stat: statOf(file) }))
        .filter((item) => item.stat)
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    : []
  return [{ file: current, stat: null }, ...others].flatMap(({ file, stat }) => {
    const raw = existsSync(file) ? readRaw(file) : null
    const entry = own(raw?.log, task)
    if (!entry || typeof entry !== 'object') return []
    return [{ file, stat, id: typeof raw.session_id === 'string' ? raw.session_id : sessionId, redo: Number(entry.redo) || 0 }]
  })
}

/** Another session's file is saved without latest.json (the report stays on the current session) and keeps its times (pruning order and "newest" do not move). */
function saveOther(file, state, stat) {
  writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
  utimesSync(file, stat.atime, stat.mtime)
}

/** Runs one action and returns the text to print; the mark is saved under the lock of the session file that holds the task. */
export function run(argv, { now = Date.now(), env = process.env } = {}) {
  const [dataDir, sessionId, ...args] = argv
  const { env: settings, rest } = takeSettings(args)
  const undo = rest[0] === '--undo'
  const [name, ...words] = undo ? rest.slice(1) : rest
  const task = slug(name)
  if (!dataDir || !sessionId || !task) return { code: 2, out: `${USAGE}\n` }
  const holders = sessionsWith(dataDir, sessionId, task)
  const holder = undo ? holders.find((item) => item.redo > 0) : holders[0]
  if (!holder) return { code: 1, out: holders.length ? `${task} has no re-ask mark to undo.\n` : `No such task is recorded: ${task}.\n` }
  const ctx = openContext({ session_id: holder.id }, { ...env, ...settings, CLAUDE_PLUGIN_DATA: dataDir })
  return withLock(holder.file, () => {
    const state = loadState(holder.file, holder.id)
    const entry = undo ? undoRedo(state, task) : markRedo(state, task, { source: 'command', reason: words.join(' '), now })
    if (!entry) return { code: 1, out: `No such task is recorded: ${task}.\n` }
    flushEvents(ctx, state)
    if (holder.file === sessionPath(dataDir, sessionId)) saveState(holder.file, state)
    else saveOther(holder.file, state, holder.stat)
    return { code: 0, out: undo ? `Removed one re-ask mark from ${task}; ${entry.redo || 'none'} left.\n` : `Marked ${task} as sent back by the user (${entry.redo}).\n` }
  })
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const result = run(process.argv.slice(2))
  process.stdout.write(result.out)
  process.exitCode = result.code
}
