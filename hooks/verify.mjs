/**
 * Verification gate: parse the CC_TIERS_VERIFY lines of a report and run them without a shell.
 * Pure parsing plus one runner, injectable so the tests never spawn the real commands.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const VERIFY_RE = /^CC_TIERS_VERIFY:\s*(.*?)\s*$/
const NONE_RE = /^none\s*-\s*(\S.*)$/
const CD_RE = /^cd\s+(\S+)\s+&&\s+(.*)$/
/** Any of these could chain, redirect or substitute under a shell, so the line is refused outright. */
const META_RE = /[;|&><`$()\n\r]/
const ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
/** Env keys that change which program runs, which would bypass the allow list. */
const BLOCKED_ENV_RE = /^(PATH|LD_\w*|DYLD_\w*)$/i
const TAIL_LINES = 40
const MAX_BUFFER = 32 * 1024 * 1024

/** Splits on whitespace, honoring '...' and "..." with no escapes; null on an unclosed quote. */
function tokenize(text) {
  const tokens = []
  let current = null
  let quote = null
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      current ??= ''
    } else if (/\s/.test(char)) {
      if (current !== null) tokens.push(current)
      current = null
    } else {
      current = (current ?? '') + char
    }
  }
  if (quote) return null
  if (current !== null) tokens.push(current)
  return tokens
}

function parseLine(raw) {
  const none = NONE_RE.exec(raw)
  if (none) return { raw, kind: 'none', reason: none[1] }
  const invalid = (reason) => ({ raw, kind: 'invalid', reason: `${reason}: ${raw}` })
  if (/^none\b/.test(raw)) return invalid('none without a reason')
  let rest = raw
  let cwd = ''
  const cd = CD_RE.exec(raw)
  if (cd) {
    const dir = tokenize(cd[1])
    if (!dir || dir.length !== 1 || META_RE.test(cd[1])) return invalid('refused cd dir')
    if (path.isAbsolute(dir[0]) || path.win32.isAbsolute(dir[0])) return invalid('cd dir must be relative')
    cwd = dir[0]
    rest = cd[2]
  }
  if (META_RE.test(rest)) return invalid('refused shell metacharacter')
  const tokens = tokenize(rest)
  if (!tokens) return invalid('unclosed quote')
  const env = {}
  while (tokens.length && ENV_RE.test(tokens[0])) {
    const [, key, value] = ENV_RE.exec(tokens.shift())
    if (BLOCKED_ENV_RE.test(key)) return invalid(`refused env ${key}`)
    env[key] = value
  }
  if (!tokens.length) return invalid('empty command')
  return { raw, kind: 'command', argv: tokens, env, cwd }
}

/** Every CC_TIERS_VERIFY line of the report text, in order. */
export function parseVerify(text) {
  const lines = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = VERIFY_RE.exec(line.trim())
    if (match) lines.push(parseLine(match[1]))
  }
  return lines
}

export function parseAllow(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length)
}

/** True when some entry is a whole-token prefix of argv. */
export function isAllowed(argv, allow) {
  return allow.some((entry) => entry.length <= argv.length && entry.every((token, i) => token === argv[i]))
}

function insideProject(projectDir, cwd) {
  const root = path.resolve(projectDir)
  const rel = path.relative(root, path.resolve(root, cwd || '.'))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function lastLines(text, count) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/)
  return lines.slice(-count).join('\n')
}

/** Runs one parsed command as argv; on win32 a shell is needed for .cmd shims, safe since metacharacters were refused. */
export function runCommand(cmd, { projectDir, timeoutS }) {
  const win = process.platform === 'win32'
  const [file, ...args] = win ? cmd.argv.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : cmd.argv
  const started = Date.now()
  const result = spawnSync(file, args, {
    cwd: path.resolve(projectDir, cmd.cwd || '.'),
    env: { ...process.env, ...(cmd.env || {}) },
    timeout: timeoutS * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    shell: win,
  })
  const timedOut = result.error?.code === 'ETIMEDOUT'
  const output = [result.stdout, result.stderr, result.error && !timedOut ? String(result.error.message) : '']
    .filter(Boolean)
    .join('\n')
  return { code: timedOut ? null : result.status, timedOut, tail: lastLines(output, TAIL_LINES), ms: Date.now() - started }
}

export function runGate(text, { projectDir, allow, timeoutS, budgetS, run = runCommand }) {
  const gate = { status: 'unverified', verified: [], flaky: [], unverified: [], failure: null }
  const lines = parseVerify(text)
  if (!lines.length) return { ...gate, status: 'missing' }
  let remaining = budgetS
  const skip = (raw, reason) => gate.unverified.push({ raw, reason })
  const exhausted = (raw) => skip(raw, `budget exhausted: ${raw}`)
  const attempt = (cmd) => {
    const seconds = Math.min(timeoutS, remaining)
    const result = run(cmd, { projectDir, timeoutS: seconds })
    remaining -= (result.ms || 0) / 1000
    return { ...result, seconds }
  }
  for (const line of lines) {
    if (gate.failure) break
    if (line.kind === 'none' || line.kind === 'invalid') {
      skip(line.raw, line.reason)
      continue
    }
    if (!insideProject(projectDir, line.cwd)) {
      skip(line.raw, `cd dir outside the project: ${line.raw}`)
      continue
    }
    if (!isAllowed(line.argv, allow)) {
      skip(line.raw, `outside verify_allow: ${line.raw} (add its prefix in /config)`)
      continue
    }
    if (remaining <= 0) {
      exhausted(line.raw)
      continue
    }
    let result = attempt(line)
    let retried = false
    if (!result.timedOut && result.code !== 0) {
      if (remaining <= 0) {
        exhausted(line.raw)
        continue
      }
      result = attempt(line)
      retried = true
    }
    if (result.timedOut && result.seconds < timeoutS) {
      exhausted(line.raw)
    } else if (result.timedOut || result.code !== 0) {
      gate.failure = { raw: line.raw, code: result.code, timedOut: result.timedOut, tail: result.tail, seconds: result.seconds }
    } else {
      gate.verified.push(line.raw)
      if (retried) gate.flaky.push(line.raw)
    }
  }
  if (gate.failure) gate.status = 'fail'
  else if (gate.verified.length) gate.status = 'pass'
  return gate
}

/** The gate lines the benchmark greps, one per fact; commands join with '; ' since a command never holds one. */
export function gateMessage(task, gate) {
  const prefix = `cc-tiers gate: ${task}`
  if (gate.status === 'missing') return `${prefix} reported pass without CC_TIERS_VERIFY`
  const lines = []
  if (gate.verified.length) lines.push(`${prefix} verified: ${gate.verified.join('; ')}`)
  for (const raw of gate.flaky) lines.push(`${prefix} flaky: ${raw}`)
  for (const item of gate.unverified) lines.push(`${prefix} not validated: ${item.reason}`)
  const failure = gate.failure
  if (failure?.timedOut) lines.push(`${prefix} timed out: ${failure.raw} after ${failure.seconds} s`)
  else if (failure) lines.push(`${prefix} failed: ${failure.raw} (exit ${failure.code ?? 'none'})`)
  return lines.join('\n')
}

const FINDING_BEGIN = 'CC_TIERS_FINDING_BEGIN'
const FINDING_END = 'CC_TIERS_FINDING_END'
const FIELD_RE = /^([A-Za-z_]+)\s*:\s*(.*)$/
const FIELD_KEYS = ['category', 'severity', 'evidence', 'command', 'expected', 'observed', 'where', 'criterion']
const CATEGORIES = ['correctness', 'regression', 'security', 'state', 'scope']
const SEVERITIES = ['blocking', 'note']
const EVIDENCES = ['command', 'trace', 'coverage']
const REQUIRED = {
  command: ['command', 'expected', 'observed', 'where'],
  trace: ['expected', 'observed', 'where'],
  coverage: ['criterion', 'where'],
}
const MAX_NOTES = 8

/** Lowercase and drop diacritics, so "Migração" and "migracao" compare equal. */
export function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function foldFlat(text) {
  return fold(text).replace(/\s+/g, ' ').trim()
}

function buildFinding(lines, closed) {
  const finding = {}
  for (const line of lines) {
    const match = FIELD_RE.exec(line.trim())
    const key = match?.[1].toLowerCase()
    if (key && FIELD_KEYS.includes(key)) finding[key] = match[2].trim()
  }
  const problem = findingProblem(finding, closed)
  return problem ? { ...finding, valid: false, problem } : { ...finding, valid: true }
}

function findingProblem(finding, closed) {
  if (!closed) return 'unclosed finding block'
  if (!CATEGORIES.includes(finding.category)) return `unknown category: ${finding.category || ''}`
  if (!SEVERITIES.includes(finding.severity)) return `unknown severity: ${finding.severity || ''}`
  if (!EVIDENCES.includes(finding.evidence)) return `unknown evidence: ${finding.evidence || ''}`
  const missing = REQUIRED[finding.evidence].filter((key) => !finding[key])
  return missing.length ? `missing ${missing.join(', ')}` : ''
}

/** Every finding block of the report text; a block never closed is kept as an invalid finding. */
export function parseFindings(text) {
  const findings = []
  let open = null
  for (const line of String(text || '').split(/\r?\n/)) {
    const mark = line.trim()
    if (mark === FINDING_BEGIN) {
      if (open) findings.push(buildFinding(open, false))
      open = []
    } else if (mark === FINDING_END && open) {
      findings.push(buildFinding(open, true))
      open = null
    } else if (open) {
      open.push(line)
    }
  }
  if (open) findings.push(buildFinding(open, false))
  return findings
}

/** Runs a blocking command finding once: true when it failed (still blocks), false when it passed, null when it could not run. */
function commandFails(finding, { allow, projectDir, timeoutS }, budget, run) {
  const line = parseLine(finding.command)
  if (line.kind !== 'command' || !insideProject(projectDir, line.cwd) || !isAllowed(line.argv, allow) || budget.remaining <= 0) return null
  const seconds = Math.min(timeoutS, budget.remaining)
  const result = run(line, { projectDir, timeoutS: seconds })
  budget.remaining -= (result.ms || 0) / 1000
  if (result.timedOut && seconds < timeoutS) return null
  return result.timedOut || result.code !== 0
}

/** Splits findings by what the hook can check; only blocking ones with evidence that holds stay blocking. */
export function judgeFindings(findings, { specText, allow, projectDir, timeoutS, budgetS, run = runCommand }) {
  const judged = { blocking: [], discarded: [], notes: [], invalid: [] }
  const budget = { remaining: budgetS }
  const spec = foldFlat(specText)
  for (const finding of findings) {
    if (!finding.valid) judged.invalid.push(finding)
    else if (finding.severity === 'note') judged.notes.push(finding)
    else if (finding.evidence === 'coverage') {
      const listed = spec && spec.includes(foldFlat(finding.criterion))
      if (listed) judged.blocking.push(finding)
      else judged.invalid.push({ ...finding, valid: false, problem: spec ? 'criterion not in the spec block' : 'no spec block to cover' })
    } else if (finding.evidence === 'command') {
      const fails = commandFails(finding, { allow, projectDir, timeoutS }, budget, run)
      if (fails === false) judged.discarded.push(finding)
      else judged.blocking.push(finding)
    } else judged.blocking.push(finding)
  }
  return judged
}

/** The two review lines the benchmark greps, plus the notes list. */
export function reviewMessage(task, judged, { failed = false } = {}) {
  const prefix = `cc-tiers review: ${task}`
  const lines = []
  if (judged.discarded.length) lines.push(`${prefix} discarded ${judged.discarded.length} finding(s): the evidence command passed`)
  const demoted = judged.invalid.length + judged.discarded.length + judged.notes.length
  if (failed && !judged.blocking.length) lines.push(`${prefix} rejected without evidence; ${demoted} finding(s) became notes`)
  if (judged.notes.length) {
    lines.push('Notes:')
    for (const note of judged.notes.slice(0, MAX_NOTES)) lines.push(`- ${note.category} @ ${note.where}`)
  }
  return lines.join('\n')
}

/** What the writer gets back: blocking findings only. */
export function findingsNote(judged) {
  return judged.blocking
    .map((f) => (f.evidence === 'coverage' ? `${f.category} @ ${f.where}: ${f.criterion}` : `${f.category} @ ${f.where}: ${f.expected} / ${f.observed}`))
    .join('\n')
}
