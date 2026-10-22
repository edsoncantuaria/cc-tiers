/**
 * Verification gate: parse the CC_TIERS_VERIFY lines of a report and run them without a shell.
 * Pure parsing plus one runner, injectable so the tests never spawn the real commands.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { attemptChanges } from './workspace.mjs'

const VERIFY_RE = /^CC_TIERS_VERIFY:\s*(.*?)\s*$/
const NONE_RE = /^none\s*-\s*(\S.*)$/
const CD_RE = /^cd\s+(\S+)\s+&&\s+(.*)$/
/** Any of these could chain, redirect or substitute under a shell, so the line is refused outright. */
const META_RE = /[;|&><`$()\n\r]/
/** cmd.exe also expands %VAR%, !VAR! and escapes with ^. */
const WIN_META_RE = /[;|&><`$()\n\r%!^]/
const ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
/** Env keys that change which program runs or load code before the tests, which would bypass the allow list. */
const BLOCKED_ENV_RE =
  /^(PATH|PATHEXT|LD_\w*|DYLD_\w*|NODE_OPTIONS|NODE_PATH|npm_config_\w*|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|BASH_ENV|ENV|PERL5OPT|PERL5LIB|RUBYOPT|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|PHPRC|PHP_INI_SCAN_DIR)$/i
/** A URL that carries the code itself, as node --import=data:... does. */
const INLINE_RE = /data:|javascript:/i
/** Flags that load or evaluate code named on the line, not a repo test; long ones are also refused abbreviated, as npm expands them. */
const CODE_FLAGS = ['--import', '--require', '--loader', '--experimental-loader', '--eval', '--print', '--script-shell', '--node-options', '--userconfig', '--globalconfig']
const CODE_SHORT_FLAGS = ['-r', '-e', '-p', '-pe']
const TAIL_LINES = 40
const MAX_BUFFER = 32 * 1024 * 1024
const MAX_CHANGED = 5

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

export function metaRe(platform = process.platform) {
  return platform === 'win32' ? WIN_META_RE : META_RE
}

function isCodeFlag(token) {
  const name = token.split('=')[0].toLowerCase()
  if (CODE_SHORT_FLAGS.includes(name)) return true
  return name.startsWith('--') && name.length > 2 && CODE_FLAGS.some((flag) => flag.startsWith(name))
}

function parseLine(raw, platform = process.platform) {
  const meta = metaRe(platform)
  const none = NONE_RE.exec(raw)
  if (none) return { raw, kind: 'none', reason: none[1] }
  const invalid = (reason) => ({ raw, kind: 'invalid', reason: `${reason}: ${raw}` })
  if (/^none\b/.test(raw)) return invalid('none without a reason')
  let rest = raw
  let cwd = ''
  const cd = CD_RE.exec(raw)
  if (cd) {
    const dir = tokenize(cd[1])
    if (!dir || dir.length !== 1 || meta.test(cd[1])) return invalid('refused cd dir')
    if (path.isAbsolute(dir[0]) || path.win32.isAbsolute(dir[0])) return invalid('cd dir must be relative')
    cwd = dir[0]
    rest = cd[2]
  }
  if (meta.test(rest)) return invalid('refused shell metacharacter')
  const tokens = tokenize(rest)
  if (!tokens) return invalid('unclosed quote')
  if (tokens.some((token) => INLINE_RE.test(token))) return invalid('refused inline code URL')
  const env = {}
  while (tokens.length && ENV_RE.test(tokens[0])) {
    const [, key, value] = ENV_RE.exec(tokens.shift())
    if (BLOCKED_ENV_RE.test(key)) return invalid(`refused env ${key}`)
    env[key] = value
  }
  if (!tokens.length) return invalid('empty command')
  const flag = tokens.slice(1).find(isCodeFlag)
  if (flag) return invalid(`refused flag ${flag.split('=')[0]}`)
  return { raw, kind: 'command', argv: tokens, env, cwd }
}

/** Every CC_TIERS_VERIFY line of the report text, in order. */
export function parseVerify(text, { platform = process.platform } = {}) {
  const lines = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = VERIFY_RE.exec(line.trim())
    if (match) lines.push(parseLine(match[1], platform))
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

/**
 * The container wrappers the gate looks through, with the only options it accepts before the container.
 * Anything else (-e, --env-file, --privileged, -d, an unknown option) makes the line a plain command again.
 */
const WRAPPERS = [
  // --user is left out: the code-flag check reads it as an abbreviation of --userconfig, so only -u gets here.
  { prefix: ['docker', 'exec'], flags: ['-i', '--interactive', '-t', '--tty', '-it', '-ti'], values: ['-w', '--workdir', '-u'] },
  { prefix: ['docker', 'compose', 'exec'], flags: ['-T', '--no-tty'], values: ['-w', '--workdir', '-u', '--index'] },
  { prefix: ['docker-compose', 'exec'], flags: ['-T', '--no-tty'], values: ['-w', '--workdir', '-u', '--index'] },
]

/** The command a docker exec or compose exec line runs in its container, or null when argv is not such a line. */
export function wrappedCommand(argv) {
  const wrapper = WRAPPERS.find(({ prefix }) => prefix.every((token, i) => argv[i] === token))
  if (!wrapper) return null
  let i = wrapper.prefix.length
  while (i < argv.length && argv[i].startsWith('-')) {
    const token = argv[i]
    if (wrapper.flags.includes(token)) {
      i += 1
      continue
    }
    const eq = token.indexOf('=')
    // Only the long form takes =value; a short option takes the next token.
    if (eq > 0 && token.startsWith('--') && wrapper.values.includes(token.slice(0, eq)) && eq < token.length - 1) i += 1
    else if (wrapper.values.includes(token) && i + 1 < argv.length) i += 2
    else return null
  }
  // argv[i] is the container or the service; the command follows it.
  return i + 1 < argv.length ? argv.slice(i + 1) : null
}

/**
 * True when the gate may run argv: the allow list covers it, it is one of the commands cc-tiers
 * detected in the project (exactly, not as a prefix), or it is a wrapper around such a command.
 * A wrapped line with leading env is refused: DOCKER_CONFIG, DOCKER_HOST and the like choose what docker runs.
 */
export function gateAllows(argv, allow, detected = [], env = {}) {
  const covered = (tokens) => isAllowed(tokens, allow) || detected.some((entry) => entry.length === tokens.length && entry.every((token, i) => token === tokens[i]))
  if (covered(argv)) return true
  const inner = Object.keys(env || {}).length ? null : wrappedCommand(argv)
  return Boolean(inner) && covered(inner)
}

/** Programs that run whatever code follows them (bash -c, python -c): an entry of the bare name would allow anything. */
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish', 'python', 'python3', 'node', 'php', 'ruby', 'perl', 'deno', 'bun', 'pwsh', 'powershell'])

/** The narrowest verify_allow entry that covers this command on other files: it without the paths it ends with. */
export function allowPrefix(argv) {
  const tokens = wrappedCommand(argv) || argv
  // An interpreter keeps its script or subcommand, so the entry never allows its -c.
  const keep = INTERPRETERS.has(String(tokens[0]).toLowerCase()) ? 2 : 1
  let end = tokens.length
  while (end > keep && /[\\/]|\.\w+$|^\.+$/.test(tokens[end - 1])) end -= 1
  return tokens.slice(0, end).join(' ')
}

/** Real paths when the dir exists, so a symlink cannot lead out; a missing dir is judged by its path. */
function insideProject(projectDir, cwd) {
  const resolved = path.resolve(projectDir)
  const wanted = path.resolve(resolved, cwd || '.')
  const real = existsSync(resolved) && existsSync(wanted)
  const rel = real ? path.relative(realpathSync(resolved), realpathSync(wanted)) : path.relative(resolved, wanted)
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
    // SIGTERM can be trapped, and spawnSync would then wait forever.
    killSignal: 'SIGKILL',
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
  // A command that never started (not installed, not found) proves nothing about the code.
  const spawnError = Boolean(result.error) && !timedOut && result.status == null
  return { code: timedOut ? null : result.status, timedOut, spawnError, tail: lastLines(output, TAIL_LINES), ms: Date.now() - started }
}

/**
 * cached(raw) is true when the same command already passed on this exact tree
 * (same HEAD and dirty files): the result is reused instead of run again.
 * snapshot() returns the tree state (null outside git): a command that changes it, retry included, is not evidence.
 * preexisting is the raw command the writer declared failing without its change: its failure is kept apart
 * in gate.preexisting and the other commands still run; any other failure is gate.failure and stops the gate.
 */
export function runGate(text, { projectDir, allow, detected = [], timeoutS, budgetS, run = runCommand, cached = null, snapshot = null, preexisting = '' }) {
  const gate = { status: 'unverified', verified: [], flaky: [], unverified: [], failure: null, cached: [] }
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
    if (!gateAllows(line.argv, allow, detected, line.env)) {
      if (Object.keys(line.env).length && wrappedCommand(line.argv)) {
        skip(line.raw, `refused env on a docker exec line, which can choose what docker runs: ${line.raw}`)
        continue
      }
      skip(line.raw, `outside verify_allow: ${line.raw} (add \`${allowPrefix(line.argv)}\` to verify_allow in /config, keeping the entries already there)`)
      continue
    }
    if (cached && cached(line.raw)) {
      gate.verified.push(line.raw)
      gate.cached.push(line.raw)
      continue
    }
    if (remaining <= 0) {
      exhausted(line.raw)
      continue
    }
    const before = snapshot?.() ?? null
    let result = attempt(line)
    if (result.spawnError) {
      skip(line.raw, `could not start: ${line.raw} (${String(result.tail || '').trim().split(/\r?\n/).pop() || 'not found'})`)
      continue
    }
    let retried = false
    if (!result.timedOut && result.code !== 0 && remaining > 0) {
      const retry = attempt(line)
      // A retry cut short by the budget proves nothing, so the first failure stands; so does one with no budget left.
      if (!(retry.timedOut && retry.seconds < timeoutS)) [result, retried] = [retry, true]
    }
    if (result.timedOut && result.seconds < timeoutS) {
      exhausted(line.raw)
    } else if (result.timedOut || result.code !== 0) {
      const failure = { raw: line.raw, code: result.code, timedOut: result.timedOut, tail: result.tail, seconds: result.seconds }
      if (preexisting && line.raw === preexisting) gate.preexisting = gate.preexisting || failure
      else gate.failure = failure
    } else {
      const changed = before ? attemptChanges(before, snapshot()) : []
      if (changed.length) {
        skip(line.raw, `changed the tree: ${changed.slice(0, MAX_CHANGED).join(', ')}`)
      } else {
        gate.verified.push(line.raw)
        if (retried) gate.flaky.push(line.raw)
      }
    }
  }
  if (gateFailure(gate)) gate.status = 'fail'
  else if (gate.verified.length) gate.status = 'pass'
  return gate
}

/** The failure a gate reports: a counted one, else the one the writer declared pre-existing. */
export function gateFailure(gate) {
  return gate.failure || gate.preexisting || null
}

/** The gate lines, one per fact; commands join with '; ' since a command never holds one. */
export function gateMessage(task, gate) {
  const prefix = `cc-tiers gate: ${task}`
  if (gate.status === 'missing') return `${prefix} reported pass without CC_TIERS_VERIFY`
  const lines = []
  if (gate.verified.length) lines.push(`${prefix} verified: ${gate.verified.join('; ')}`)
  if (gate.cached?.length) lines.push(`${prefix} reused for the same tree: ${gate.cached.join('; ')}`)
  for (const raw of gate.flaky) lines.push(`${prefix} flaky: ${raw}`)
  for (const item of gate.unverified) lines.push(`${prefix} not validated: ${item.reason}`)
  if (gate.treeCheck) lines.push(`${prefix} tree check ${gate.treeCheck} in this tree`)
  const failure = gateFailure(gate)
  if (failure?.timedOut) lines.push(`${prefix} timed out: ${failure.raw} after ${failure.seconds} s`)
  else if (failure) lines.push(`${prefix} failed: ${failure.raw} (exit ${failure.code ?? 'none'})`)
  return lines.join('\n')
}

const FINDING_BEGIN = 'CC_TIERS_FINDING_BEGIN'
const FINDING_END = 'CC_TIERS_FINDING_END'
const FIELD_RE = /^([A-Za-z_]+)\s*:\s*(.*)$/
const FIELD_KEYS = ['category', 'severity', 'evidence', 'command', 'expected', 'observed', 'where', 'criterion', 'scenario', 'confidence', 'justification']
const CATEGORIES = [
  'correctness',
  'regression',
  'security',
  'state',
  'scope',
  'access-control',
  'input-validation',
  'data-exposure',
  'error-handling',
  'concurrency',
  'api-usage',
  'compatibility',
]
/** blocking and note are the original pair; blocker, high, medium, low and suggestion grade a finding more finely. */
const SEVERITIES = ['blocking', 'note', 'blocker', 'high', 'medium', 'low', 'suggestion']
const BLOCKING_SEVERITIES = new Set(['blocking', 'blocker', 'high'])
const GRADED = new Set(['blocker', 'high'])
const CONFIDENCES = ['low', 'medium', 'high']
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

const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+/
const ORIGIN_RE = /\s*\((?:request|user|repo|docs|decided)(?::.*)?\)\s*$/i

/** A spec line or a criterion without its bullet and origin tag, folded and on one spacing. */
export function criterionKey(text) {
  return fold(String(text || '').replace(BULLET_RE, '').replace(ORIGIN_RE, '')).replace(/\s+/g, ' ').trim()
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
  if (missing.length) return `missing ${missing.join(', ')}`
  // A graded blocker says how sure it is and why it blocks; the original 'blocking' keeps its old contract.
  if (GRADED.has(finding.severity)) {
    if (!CONFIDENCES.includes(finding.confidence)) return `missing confidence (${CONFIDENCES.join(', ')})`
    if (!finding.justification) return 'missing justification'
  }
  return ''
}

/** True for a severity that can fail a review. */
export function isBlocking(severity) {
  return BLOCKING_SEVERITIES.has(severity)
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
function commandFails(finding, { allow, detected, projectDir, timeoutS }, budget, run) {
  const line = parseLine(finding.command)
  if (line.kind !== 'command' || !insideProject(projectDir, line.cwd) || !gateAllows(line.argv, allow, detected, line.env) || budget.remaining <= 0) return null
  const seconds = Math.min(timeoutS, budget.remaining)
  const result = run(line, { projectDir, timeoutS: seconds })
  budget.remaining -= (result.ms || 0) / 1000
  if (result.timedOut && seconds < timeoutS) return null
  return result.timedOut || result.code !== 0
}

/** Splits findings by what the hook can check; only blocking ones with evidence that holds stay blocking. */
export function judgeFindings(findings, { specText, allow, detected = [], projectDir, timeoutS, budgetS, run = runCommand }) {
  const judged = { blocking: [], discarded: [], notes: [], invalid: [] }
  const budget = { remaining: budgetS }
  const spec = new Set(String(specText || '').split(/\r?\n/).map(criterionKey).filter(Boolean))
  for (const finding of findings) {
    if (!finding.valid) judged.invalid.push(finding)
    else if (!isBlocking(finding.severity)) judged.notes.push(finding)
    // A blocker its own author rates low-confidence is a lead to check, not a reason to reject.
    else if (finding.confidence === 'low') judged.notes.push({ ...finding, problem: 'low confidence' })
    else if (finding.evidence === 'coverage') {
      if (spec.has(criterionKey(finding.criterion))) judged.blocking.push(finding)
      else judged.invalid.push({ ...finding, valid: false, problem: spec.size ? 'criterion not in the spec block' : 'no spec block to cover' })
    } else if (finding.evidence === 'command') {
      const fails = commandFails(finding, { allow, detected, projectDir, timeoutS }, budget, run)
      if (fails === false) judged.discarded.push(finding)
      else judged.blocking.push(finding)
    } else judged.blocking.push(finding)
  }
  return judged
}

/** The two review lines, plus the notes list. */
export function reviewMessage(task, judged, { failed = false } = {}) {
  const prefix = `cc-tiers review: ${task}`
  const lines = []
  if (judged.discarded.length) lines.push(`${prefix} discarded ${judged.discarded.length} finding(s): the evidence command passed`)
  const demoted = judged.invalid.length + judged.discarded.length + judged.notes.length
  if (failed && !judged.blocking.length) lines.push(`${prefix} rejected without evidence; ${demoted} finding(s) became notes`)
  if (judged.notes.length) {
    lines.push('Notes:')
    for (const note of judged.notes.slice(0, MAX_NOTES)) {
      const grade = note.severity && note.severity !== 'note' ? ` [${note.severity}${note.problem ? `, ${note.problem}` : ''}]` : ''
      lines.push(`- ${note.category} @ ${note.where}${grade}`)
    }
  }
  return lines.join('\n')
}

/** What the writer gets back: blocking findings only. */
export function findingsNote(judged) {
  return judged.blocking
    .map((f) => (f.evidence === 'coverage' ? `${f.category} @ ${f.where}: ${f.criterion}` : `${f.category} @ ${f.where}: ${f.expected} / ${f.observed}`))
    .join('\n')
}
