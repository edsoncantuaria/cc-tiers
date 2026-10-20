#!/usr/bin/env node
/**
 * cc-tiers benchmark. Runs every task in tasks-login.json under each configuration with
 * `claude -p`, in a fresh git copy of fixture-login/, and grades each step the way
 * SWE-bench does: FAIL_TO_PASS is the task's hidden check, run alone;
 * PASS_TO_PASS re-runs every test file that passed before the step, in its
 * before-form (minus the files the task changes on purpose). A task is resolved
 * when both pass. A hidden-check test whose name starts with `reuse: ` checks
 * that existing code was reused; a run that fails one recreated existing code.
 * Records pass@1, pass^k, regressions, recreated code, fresh tokens per model,
 * turns, wall time, subagents by type, and the escalations cc-tiers announced in
 * its hook messages. The raw JSON keeps the cost Claude Code reports.
 *
 *   node bench/run.mjs [--configs opus,sonnet,cc-tiers,cc-tiers-light] [--tasks traversal,race]
 *                      [--repeat 1] [--parallel 3] [--out bench/results/latest.json]
 *                      [--plugin <frozen copy of the plugin>] [--tag 0.4] [--session]
 *                      [--tasks-file bench/tasks-hard.json] [--fixture <dir>] [--checks <dir>]
 *                      [--timeout 15]
 *   node bench/run.mjs --table bench/results/a.json [bench/results/b.json ...]
 *
 * --tasks-file picks another task list (default bench/tasks-login.json). Its fixture
 * and checks default to the matching names: tasks-hard.json runs on fixture-hard/
 * with checks-hard/.
 *
 * --plugin points the cc-tiers configurations at a copy (a git worktree of a
 * release), so editing this checkout mid-run cannot change what is measured.
 * --tag names those configurations, e.g. cc-tiers@0.4.
 * --session sends every task, in order, to one session per configuration
 * (`--resume`), and checks each task right after its own step.
 *
 * Every run spends real tokens on the account `claude` is logged in with.
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(BENCH, '..')

export const CONFIGS = {
  opus: { label: 'Opus only', args: () => ['--model', 'opus'] },
  sonnet: { label: 'Sonnet only', args: () => ['--model', 'sonnet'] },
  'cc-tiers': { label: 'cc-tiers (Opus orchestrator)', args: (plugin) => ['--plugin-dir', plugin] },
  'cc-tiers-light': { label: 'cc-tiers light (Sonnet dispatcher)', args: (plugin) => ['--plugin-dir', plugin, '--agent', 'cc-tiers:dispatcher'] },
}

export function label(config) {
  const [base, tag] = String(config).split('@')
  const name = CONFIGS[base]?.label || base
  return tag ? `${name} ${tag}` : name
}

const PASS_ENV = /^(PATH|HOME|USER|LANG|LC_ALL|TERM|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|GLOBAL_AGENT_[A-Z_]+)$/

/** A clean environment, so a run started from inside Claude Code does not join that session. */
function cleanEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) if (PASS_ENV.test(key)) env[key] = value
  env.IS_SANDBOX = '1'
  return env
}

function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
}

function workspace(fixture) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-tiers-bench-'))
  cpSync(fixture, dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'fixture')
  return dir
}

/**
 * The tree id of the workspace as it is now, tracked and untracked files alike.
 * It stages into its own index file, so the model never sees staged changes.
 */
export function workspaceTree(dir) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, '.git', 'bench-snapshot-index') }
  if (spawnSync('git', ['add', '-A'], { cwd: dir, env }).status !== 0) return ''
  const tree = spawnSync('git', ['write-tree'], { cwd: dir, encoding: 'utf8', env })
  return tree.status === 0 ? tree.stdout.trim() : ''
}

const SCAN_SKIP = new Set(['node_modules', '.git'])

/** Every file under dir as a relative path -> content map, without node_modules and .git. */
export function readTree(dir, base = dir, files = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SCAN_SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) readTree(full, base, files)
    else if (entry.isFile()) files.set(path.relative(base, full).split(path.sep).join('/'), readFileSync(full).toString('latin1'))
  }
  return files
}

/** The paths a unified diff writes to (the `+++ b/<path>` lines). */
export function patchFiles(patch) {
  return [...String(patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1])
}

/**
 * The files a task may touch: those its reference solution touches (a patch named
 * after the task, or every file under a solutions dir with no patch) plus scopeExtra.
 * Test files and .bench-check/ are always in scope (see outOfScopeFiles).
 */
export function scopeOf(task, solutions) {
  const scope = new Set(task.scopeExtra || [])
  const patch = path.join(solutions, `${task.id}.patch`)
  if (existsSync(patch)) for (const file of patchFiles(readFileSync(patch, 'utf8'))) scope.add(file)
  else if (existsSync(solutions)) {
    for (const file of readTree(solutions).keys()) if (!file.endsWith('.txt') && !file.endsWith('.patch')) scope.add(file)
  }
  return [...scope]
}

/** Files added, modified or deleted between two path -> content maps that are not in scope, sorted. */
export function outOfScopeFiles(before, after, scope) {
  const allowed = new Set(scope)
  const changed = new Set()
  for (const [file, content] of after) if (before.get(file) !== content) changed.add(file)
  for (const file of before.keys()) if (!after.has(file)) changed.add(file)
  return [...changed].filter((file) => !allowed.has(file) && !/^(test|\.bench-check)\//.test(file)).sort()
}

export function claudeArgs(config, plugin, prompt, resume = '') {
  // project and local only: the user's own CLAUDE.md, agents, plugins, and hooks would change what is measured.
  // No AskUserQuestion for any config: a headless run denies it, and nobody would answer.
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--setting-sources', 'project,local', '--disallowedTools', 'AskUserQuestion', ...config.args(plugin)]
  if (resume) args.push('--resume', resume)
  return args
}

export function sessionRefusal(tasks, tasksFile, session) {
  const oneShot = tasks.find((task) => task.oneShot)
  if (!session || !oneShot) return
  const why = typeof oneShot.oneShot === 'string' ? oneShot.oneShot : 'this task must run in a clean tree'
  throw new Error(`${tasksFile}: --session cannot run task "${oneShot.id}": ${why}. Run it one-shot.`)
}

function runClaude(dir, config, prompt, timeoutMs, plugin, resume = '') {
  const args = claudeArgs(config, plugin, prompt, resume)
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn('claude', args, { cwd: dir, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      let json = null
      try {
        json = JSON.parse(stdout.trim().split('\n').pop())
      } catch {
        json = null
      }
      resolve({ code, json, stderr: stderr.slice(-2000), seconds: Math.round((Date.now() - started) / 1000) })
    })
  })
}

function runTests(dir, files, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  delete env.NODE_TEST_CONTEXT
  const proc = spawnSync(process.execPath, ['--test', ...files], { cwd: dir, encoding: 'utf8', env, timeout: 120000 })
  return { pass: proc.status === 0, output: `${proc.stdout}\n${proc.stderr}` }
}

/** Names of the failed tests in node:test output: `✖ name (1.2ms)` (spec) or `not ok 1 - name` (TAP). */
export function failedTests(output) {
  const names = []
  for (const match of String(output).matchAll(/^\s*(?:✖ (.+) \([\d.]+m?s\)|not ok \d+ - (.+))$/gm)) names.push(match[1] ?? match[2])
  return [...new Set(names)]
}

/** The test/*.test.mjs files that pass on their own right now, path -> content. */
export function passingTests(dir) {
  const passing = new Map()
  const folder = path.join(dir, 'test')
  if (!existsSync(folder)) return passing
  for (const name of readdirSync(folder).sort()) {
    const file = `test/${name}`
    if (name.endsWith('.test.mjs') && runTests(dir, [file]).pass) passing.set(file, readFileSync(path.join(dir, file), 'utf8'))
  }
  return passing
}

/**
 * FAIL_TO_PASS: the hidden check alone. PASS_TO_PASS: each file in `before`
 * that the task does not change on purpose, written back in its before-form and
 * run alone, as `before` was measured; the model's version (or its absence) is
 * put back afterwards. ownTests: the test files as the model left them.
 */
export function grade(dir, task, result, checks, before) {
  const target = path.join(dir, '.bench-check')
  mkdirSync(target, { recursive: true })
  cpSync(path.join(checks, `${task.id}.test.mjs`), path.join(target, `${task.id}.test.mjs`))
  const hidden = runTests(dir, [`.bench-check/${task.id}.test.mjs`], { BENCH_RESULT: String(result || '') })
  const reuseChecked = /\btest\(\s*['"`]reuse: /.test(readFileSync(path.join(target, `${task.id}.test.mjs`), 'utf8'))
  const recreated = failedTests(hidden.output).some((name) => name.startsWith('reuse: '))
  const outputs = hidden.pass ? [] : [hidden.output]

  const changes = new Set(task.changesTests || [])
  const regressions = []
  for (const [file, content] of before) {
    if (changes.has(file)) continue
    const full = path.join(dir, file)
    const left = existsSync(full) ? readFileSync(full, 'utf8') : null
    try {
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content)
      const run = runTests(dir, [file])
      if (!run.pass) {
        regressions.push(file)
        outputs.push(run.output)
      }
    } finally {
      if (left === null) rmSync(full, { force: true })
      else writeFileSync(full, left)
    }
  }

  const listed = spawnSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'test'], { cwd: dir, encoding: 'utf8' })
  const own = String(listed.stdout || '').split('\n').filter((file) => /\.test\.m?js$/.test(file))
  const ownRun = own.length ? runTests(dir, own) : { pass: true, output: '' }
  if (!ownRun.pass) outputs.push(ownRun.output)

  const f2p = hidden.pass
  const p2p = regressions.length === 0
  return { f2p, p2p, ownTests: ownRun.pass, resolved: f2p && p2p, regressions, reuseChecked, recreated, output: outputs.join('\n').slice(-1500) }
}

const ESCALATIONS = [
  { kind: 'limit', pattern: /Tier (haiku|sonnet|opus) has \d+ failure\(s\); max attempts is \d+\.\s+The next tier is (haiku|sonnet|opus)/g },
  { kind: 'early', pattern: /cc-tiers moved \S+ from (haiku|sonnet|opus) to (haiku|sonnet|opus) before the attempt limit/g },
]

/** The session transcript Claude Code wrote for this run, found by its id. */
export function transcriptFile(sessionId, home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) {
  const root = path.join(home, 'projects')
  if (!sessionId || !existsSync(root)) return ''
  for (const project of readdirSync(root)) {
    const file = path.join(root, project, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  return ''
}

/**
 * Escalations cc-tiers announced, read from the transcript lines after `from`.
 * Only hook output counts (hook attachments and system messages), never the
 * model's own text, which may quote a hook message.
 */
export function escalationsIn(lines, from = 0) {
  const found = []
  for (const text of hookTexts(lines, from)) {
    for (const { kind, pattern } of ESCALATIONS) {
      for (const match of text.matchAll(pattern)) found.push(`${match[1]}->${match[2]} (${kind})`)
    }
  }
  return found
}

/** Text of each hook output (hook attachments and system messages) after `from`, with `\n` unescaped. */
function* hookTexts(lines, from) {
  for (const line of lines.slice(from)) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const fromHook = (row.type === 'attachment' && String(row.attachment?.type || '').startsWith('hook')) || row.type === 'system'
    if (fromHook) yield JSON.stringify(row.attachment ?? row).replace(/\\n/g, '\n')
  }
}

const count = (text, pattern) => [...text.matchAll(pattern)].length

/** How often the gate and the evidence review spoke in hook output after `from`; the model's own text never counts. */
export function qualityIn(lines, from = 0) {
  const quality = { gateBlocked: 0, flaky: 0, notValidated: 0, discarded: 0, noEvidence: 0 }
  for (const text of hookTexts(lines, from)) {
    quality.gateBlocked += count(text, /cc-tiers gate: \S+ (?:failed: |timed out: |reported pass without CC_TIERS_VERIFY)/g)
    quality.flaky += count(text, /cc-tiers gate: \S+ flaky: /g)
    quality.notValidated += count(text, /cc-tiers gate: \S+ not validated: /g)
    quality.noEvidence += count(text, /cc-tiers review: \S+ rejected without evidence/g)
    for (const match of text.matchAll(/cc-tiers review: \S+ discarded (\d+) finding\(s\)/g)) quality.discarded += Number(match[1])
  }
  return quality
}

const ROLE_TIER = {
  'cc-tiers:worker': 'haiku',
  'cc-tiers:implementer': 'sonnet',
  'cc-tiers:architect': 'opus',
  'cc-tiers:checker': 'sonnet',
  'cc-tiers:reviewer': 'opus',
  'cc-tiers:planner': 'opus',
  'cc-tiers:orchestrator': 'opus',
}
const WRITERS = new Set(['cc-tiers:worker', 'cc-tiers:implementer', 'cc-tiers:architect'])
const READ_ONLY = new Set(['cc-tiers:reviewer', 'cc-tiers:checker', 'cc-tiers:researcher', 'cc-tiers:planner', 'Explore', 'Plan'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/**
 * Who did the work in these transcript lines, in order: each Agent call the
 * session made (type and CC_TIERS_TASK slug) and each file edit it made itself.
 */
export function routeIn(lines, from = 0) {
  const steps = []
  for (const line of lines.slice(from)) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'assistant' || row.isSidechain || !Array.isArray(row.message?.content)) continue
    for (const part of row.message.content) {
      if (part.type !== 'tool_use') continue
      if (part.name === 'Agent' || part.name === 'Task') {
        const task = /^CC_TIERS_TASK:\s*(\S+)/m.exec(String(part.input?.prompt || ''))?.[1] || ''
        steps.push({ agent: String(part.input?.subagent_type || 'general-purpose'), task })
      } else if (EDIT_TOOLS.has(part.name)) {
        steps.push({ agent: 'inline', task: '' })
      }
    }
  }
  return steps
}

/**
 * Files changed with no writer delegation and no Edit/Write step: someone wrote them through Bash.
 * The last delegation that is not read-only gets the credit (`by`); with none, the session did.
 */
export function inlineSteps(steps, changed) {
  if (!changed || steps.some((step) => step.agent === 'inline' || WRITERS.has(step.agent))) return steps
  const by = steps.findLast((step) => step.agent !== 'inline' && !READ_ONLY.has(step.agent))?.agent
  return [...steps, { agent: 'inline', task: '', ...(by && { by }) }]
}

/**
 * Whether a step was routed the way the README says: trivial work on Haiku or
 * inline (the light path), normal work written on Sonnet, hard work never written
 * on Haiku, and a large request split into at least two delegated tasks on at
 * least two tiers. sessionTier is the model of the session agent.
 */
export function routing(kind, steps, sessionTier) {
  const writers = steps
    .filter((step) => step.agent === 'inline' || WRITERS.has(step.agent))
    .map((step) => (step.agent !== 'inline' ? ROLE_TIER[step.agent] : step.by ? ROLE_TIER[step.by] || step.by : `inline ${sessionTier}`))
  const first = writers[0] || 'none'
  const tierOf = (writer) => writer.replace('inline ', '')
  const path = [...new Set(writers)].join(' -> ') || 'none'
  const reviewed = steps.some((step) => step.agent === 'cc-tiers:reviewer')
  let ok
  if (kind === 'trivial') ok = first === 'none' || first === 'haiku' || first.startsWith('inline')
  else if (kind === 'normal') ok = tierOf(first) === 'sonnet'
  else if (kind === 'hard') ok = first !== 'none' && tierOf(first) !== 'haiku'
  else if (kind === 'large') {
    const tasks = new Set(steps.filter((step) => WRITERS.has(step.agent) && step.task).map((step) => step.task))
    ok = tasks.size >= 2 && new Set(writers.map(tierOf)).size >= 2
  } else ok = null
  return { path: reviewed ? `${path} (+ Opus review)` : path, ok }
}

function readLines(file) {
  return file ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

const STEP_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'costUSD']

/**
 * `claude -p --resume` reports usage and cost for the whole session so far.
 * This subtracts the previous step of the same session, so a row holds its own
 * step only. A different session id means a new session: nothing to subtract.
 */
export function stepUsage(json, previous) {
  if (!json || !previous || previous.session_id !== json.session_id) return json
  const modelUsage = {}
  for (const [model, usage] of Object.entries(json.modelUsage || {})) {
    const before = previous.modelUsage?.[model] || {}
    modelUsage[model] = { ...usage }
    for (const field of STEP_FIELDS) if (field in usage) modelUsage[model][field] = (Number(usage[field]) || 0) - (Number(before[field]) || 0)
  }
  return { ...json, modelUsage, total_cost_usd: (Number(json.total_cost_usd) || 0) - (Number(previous.total_cost_usd) || 0) }
}

export function summarize(config, task, rep, run, verdict, escalations = null, route = null, quality = null, outOfScope = null) {
  const json = run.json || {}
  const models = {}
  const tokens = {}
  let freshTokens = 0
  for (const [model, usage] of Object.entries(json.modelUsage || {})) {
    models[model] = Number(usage.costUSD) || 0
    tokens[model] = {
      input: usage.inputTokens || 0,
      output: usage.outputTokens || 0,
      cacheRead: usage.cacheReadInputTokens || 0,
      cacheWrite: usage.cacheCreationInputTokens || 0,
    }
    freshTokens += tokens[model].input + tokens[model].cacheWrite + tokens[model].output
  }
  return {
    config,
    task: task.id,
    kind: task.kind,
    rep,
    f2p: verdict.f2p,
    p2p: verdict.p2p,
    ownTests: verdict.ownTests,
    resolved: verdict.resolved,
    regressions: verdict.regressions,
    reuseChecked: verdict.reuseChecked ?? false,
    recreated: verdict.recreated ?? false,
    pass: verdict.resolved,
    // No JSON (timeout or crash) means no usage to count, not zero tokens.
    freshTokens: run.json ? freshTokens : null,
    cost: Number(json.total_cost_usd) || 0,
    models,
    tokens,
    turns: json.num_turns ?? null,
    seconds: run.seconds,
    subagents: json.subagent_stats?.spawned ?? null,
    subagentTypes: json.subagent_stats?.by_type ?? null,
    escalations: escalations ? escalations.length : null,
    escalationPath: escalations ?? null,
    route: route?.path ?? null,
    routedAsDocumented: route?.ok ?? null,
    delegations: route?.steps ?? null,
    quality,
    outOfScope,
    reviewRounds: route?.steps ? route.steps.filter((step) => step.agent === 'cc-tiers:reviewer' || step.agent === 'cc-tiers:checker').length : null,
    error: json.is_error ? String(json.result || '').slice(0, 300) : run.code === 0 ? '' : run.stderr.slice(-300),
    checkOutput: verdict.resolved ? '' : verdict.output,
  }
}

function progress(row) {
  if (row.resolved) return 'PASS'
  const regressions = row.regressions.length ? ` (regressions: ${row.regressions.join(', ')})` : ''
  return `FAIL f2p=${row.f2p} p2p=${row.p2p}${regressions}`
}

async function pool(items, size, fn) {
  const results = []
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return results
}

const resolvedOf = (row) => Boolean(row.resolved ?? row.pass)
const percent = (share) => `${Math.round(share * 100)}%`
export const kilo = (tokens) => (tokens == null ? '—' : `${(tokens / 1000).toFixed(1)}k`)

/** Fresh tokens of a row; older result files only have the per-model `tokens`. Null when the run left no usage. */
function freshOf(row) {
  if ('freshTokens' in row) return row.freshTokens
  if (!row.tokens) return null
  return Object.values(row.tokens).reduce((sum, t) => sum + (t.input || 0) + (t.cacheWrite || 0) + (t.output || 0), 0)
}

/**
 * pass@1 (HumanEval): mean over tasks of the share of runs resolved. pass^k
 * (τ-bench): share of tasks resolved in every one of their k runs. Regressions:
 * runs whose hidden check passed but that broke a test that passed before.
 * Recreated: runs that failed a `reuse: ` test; null when no run had one.
 * Outside: runs that changed a file outside the task's scope; null when no row has outOfScope.
 */
export function metrics(rows) {
  const tasks = [...new Set(rows.map((row) => row.task))]
  const perTask = tasks.map((task) => {
    const mine = rows.filter((row) => row.task === task)
    return { runs: mine.length, resolved: mine.filter(resolvedOf).length }
  })
  const resolved = rows.filter(resolvedOf).length
  const counted = rows.filter((row) => freshOf(row) != null)
  const tokens = counted.reduce((sum, row) => sum + freshOf(row), 0)
  const resolvedCounted = counted.filter(resolvedOf).length
  return {
    pass1: perTask.length ? perTask.reduce((sum, task) => sum + task.resolved / task.runs, 0) / perTask.length : 0,
    passK: perTask.length ? perTask.filter((task) => task.resolved === task.runs).length / perTask.length : 0,
    k: perTask.length ? Math.min(...perTask.map((task) => task.runs)) : 0,
    resolved,
    runs: rows.length,
    regressions: rows.some((row) => 'p2p' in row) ? rows.filter((row) => row.f2p && row.p2p === false).length : null,
    recreated: rows.some((row) => row.reuseChecked) ? rows.filter((row) => row.recreated).length : null,
    outside: rows.some((row) => Array.isArray(row.outOfScope)) ? rows.filter((row) => row.outOfScope?.length).length : null,
    tokensPerResolved: resolvedCounted ? tokens / resolvedCounted : null,
  }
}

/**
 * The README table: one row per configuration, then one per task, then one per task kind.
 * Quality comes first; tokens are last, for information.
 */
export function table(results) {
  const configs = [...new Set(results.map((row) => row.config))]
  const opus = configs.includes('opus') ? metrics(results.filter((row) => row.config === 'opus')) : null
  const lines = [
    `| Configuration | pass@1 | Δ pass@1 vs ${label('opus')} | pass^k | Resolved | Broke something | Recreated existing code | Touched outside scope | Tokens per resolved task |`,
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: |',
  ]
  for (const config of configs) {
    const m = metrics(results.filter((row) => row.config === config))
    let points = '—'
    if (config !== 'opus' && opus) {
      const difference = (m.pass1 - opus.pass1) * 100
      const change = Math.sign(difference) * Math.round(Math.abs(difference))
      points = change < 0 ? `−${-change} pp` : change > 0 ? `+${change} pp` : '0 pp'
    }
    const tokens = kilo(m.tokensPerResolved)
    lines.push(`| ${label(config)} | ${percent(m.pass1)} | ${points} | ${percent(m.passK)} (k=${m.k}) | ${m.resolved}/${m.runs} | ${m.regressions ?? '—'} | ${m.recreated ?? '—'} | ${m.outside ?? '—'} | ${tokens} |`)
  }
  lines.push('')
  const tasks = [...new Set(results.map((row) => row.task))]
  lines.push(`| Task | ${configs.map(label).join(' | ')} |`)
  lines.push(`| --- | ${configs.map(() => '--:').join(' | ')} |`)
  for (const task of tasks) {
    const cells = configs.map((config) => {
      const rows = results.filter((row) => row.config === config && row.task === task)
      if (!rows.length) return '—'
      const resolved = rows.filter(resolvedOf).length
      return `${resolved === rows.length ? '✅' : resolved ? '🟡' : '❌'} ${resolved}/${rows.length}`
    })
    const kind = results.find((row) => row.task === task)?.kind
    lines.push(`| \`${task}\` (${kind}) | ${cells.join(' | ')} |`)
  }
  const difference = differenceTable(results)
  if (difference.length) lines.push('', ...difference)
  lines.push('', ...kindTable(results))
  if (results.some((row) => row.routedAsDocumented != null)) lines.push('', ...routingTable(results))
  if (results.some((row) => row.quality)) lines.push('', ...qualityTable(results))
  return lines.join('\n')
}

/** The tasks where some configuration resolved a different share of runs than the baseline; empty without a baseline. */
export function differenceTable(results, baseline = 'opus') {
  const configs = [...new Set(results.map((row) => row.config))]
  if (!configs.includes(baseline)) return []
  const share = (config, task) => {
    const rows = results.filter((row) => row.config === config && row.task === task)
    return rows.length ? { resolved: rows.filter(resolvedOf).length, runs: rows.length } : null
  }
  const lines = []
  for (const task of new Set(results.map((row) => row.task))) {
    const base = share(baseline, task)
    const cells = configs.map((config) => share(config, task))
    // A task the baseline did not run cannot be compared, so it is listed.
    if (base && !cells.some((cell) => cell && cell.resolved / cell.runs !== base.resolved / base.runs)) continue
    lines.push(`| \`${task}\` | ${cells.map((cell) => (cell ? `${cell.resolved}/${cell.runs}` : '—')).join(' | ')} |`)
  }
  if (!lines.length) return [`No task differs from ${label(baseline)}.`]
  return [
    `**Where it made a difference** (resolved runs per task vs ${label(baseline)})`,
    '',
    `| Task | ${configs.map(label).join(' | ')} |`,
    `| --- | ${configs.map(() => '--:').join(' | ')} |`,
    ...lines,
  ]
}

/** pass@1 for each kind of task, plus the escalations cc-tiers announced and how often it routed as documented. */
export function kindTable(results) {
  const configs = [...new Set(results.map((row) => row.config))]
  const kinds = [...new Set(results.map((row) => row.kind))]
  const lines = [
    `| Configuration | ${kinds.map((kind) => `${kind}: pass@1`).join(' | ')} | Escalations | Routed as documented |`,
    `| --- | ${kinds.map(() => '--:').join(' | ')} | --: | --: |`,
  ]
  for (const config of configs) {
    const cells = kinds.map((kind) => {
      const rows = results.filter((row) => row.config === config && row.kind === kind)
      return rows.length ? percent(metrics(rows).pass1) : '—'
    })
    const counted = results.filter((row) => row.config === config && row.escalations != null)
    const escalations = counted.length ? counted.reduce((sum, row) => sum + row.escalations, 0) : '—'
    const routed = results.filter((row) => row.config === config && row.routedAsDocumented != null)
    const share = routed.length ? `${routed.filter((row) => row.routedAsDocumented).length}/${routed.length}` : '—'
    lines.push(`| ${label(config)} | ${cells.join(' | ')} | ${escalations} | ${share} |`)
  }
  return lines
}

/** Gate and review events per cc-tiers configuration; rows from older result files have no `quality`. */
export function qualityTable(results) {
  const rows = results.filter((row) => row.quality)
  const configs = [...new Set(rows.map((row) => row.config))]
  const lines = [
    '| Configuration | Pass blocked by gate | Flaky | Not validated | Findings discarded | Rejections without evidence | Review rounds per task |',
    '| --- | --: | --: | --: | --: | --: | --: |',
  ]
  for (const config of configs) {
    const mine = rows.filter((row) => row.config === config)
    const sum = (key) => mine.reduce((total, row) => total + (row.quality[key] || 0), 0)
    const rounds = mine.reduce((total, row) => total + (row.reviewRounds || 0), 0) / mine.length
    lines.push(`| ${label(config)} | ${sum('gateBlocked')} | ${sum('flaky')} | ${sum('notValidated')} | ${sum('discarded')} | ${sum('noEvidence')} | ${rounds.toFixed(1)} |`)
  }
  return lines
}

/** For the routing configurations: how often each kind of task went where the README says, and the usual path. */
export function routingTable(results) {
  const rows = results.filter((row) => row.routedAsDocumented != null)
  const configs = [...new Set(rows.map((row) => row.config))]
  const kinds = [...new Set(rows.map((row) => row.kind))]
  const lines = [`| Configuration | ${kinds.join(' | ')} |`, `| --- | ${kinds.map(() => '---').join(' | ')} |`]
  for (const config of configs) {
    const cells = kinds.map((kind) => {
      const mine = rows.filter((row) => row.config === config && row.kind === kind)
      const counts = {}
      for (const row of mine) counts[row.route] = (counts[row.route] || 0) + 1
      const usual = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      return `${mine.filter((row) => row.routedAsDocumented).length}/${mine.length} (${usual})`
    })
    lines.push(`| ${label(config)} | ${cells.join(' | ')} |`)
  }
  return lines
}

async function main() {
  const args = process.argv.slice(2)
  const value = (flag, fallback) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : fallback
  }
  if (args.includes('--table')) {
    const files = args.slice(args.indexOf('--table') + 1).filter((arg) => !arg.startsWith('--'))
    const rows = files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).results)
    process.stdout.write(`${table(rows)}\n`)
    return
  }
  const configs = value('--configs', Object.keys(CONFIGS).join(',')).split(',').filter((name) => CONFIGS[name])
  const tasksFile = path.resolve(value('--tasks-file', path.join(BENCH, 'tasks-login.json')))
  // tasks-<name>.json pairs with fixture-<name>/ and checks-<name>/ next to it.
  const suffix = path.basename(tasksFile).match(/^tasks(-.+)?\.json$/)?.[1] || ''
  const fixture = path.resolve(value('--fixture', path.join(path.dirname(tasksFile), `fixture${suffix}`)))
  const checks = path.resolve(value('--checks', path.join(path.dirname(tasksFile), `checks${suffix}`)))
  const solutions = path.resolve(value('--solutions', path.join(path.dirname(tasksFile), `solutions${suffix}`)))
  const allTasks = JSON.parse(readFileSync(tasksFile, 'utf8'))
  const wanted = value('--tasks', '')
  const tasks = wanted ? allTasks.filter((task) => wanted.split(',').includes(task.id)) : allTasks
  const repeat = Math.max(1, Number(value('--repeat', 1)) || 1)
  const parallel = Math.max(1, Number(value('--parallel', 3)) || 3)
  const timeoutMs = (Number(value('--timeout', 15)) || 15) * 60000
  const out = value('--out', path.join(BENCH, 'results', 'latest.json'))
  const plugin = path.resolve(value('--plugin', ROOT))
  const tag = value('--tag', '')
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()

  const session = args.includes('--session')
  sessionRefusal(tasks, path.relative(ROOT, tasksFile), session)
  const nameOf = (config) => (tag && config.startsWith('cc-tiers') ? `${config}@${tag}` : config)
  const jobs = []
  if (session) {
    for (let rep = 1; rep <= repeat; rep += 1) for (const config of configs) jobs.push({ rep, config })
  } else {
    for (let rep = 1; rep <= repeat; rep += 1) for (const task of tasks) for (const config of configs) jobs.push({ rep, task, config })
  }
  process.stderr.write(`Running ${jobs.length} ${session ? 'sessions' : 'jobs'} (${configs.length} configs x ${tasks.length} tasks x ${repeat}) on ${path.relative(ROOT, fixture)}, ${parallel} at a time.\n`)
  // Escalations and routing exist only where cc-tiers routes; elsewhere they stay null rather than 0.
  const transcriptFor = (config, sessionId, from, kind, changed) => {
    if (!config.startsWith('cc-tiers')) return { found: null, route: null, quality: null, seen: from }
    const lines = readLines(transcriptFile(sessionId))
    const steps = inlineSteps(routeIn(lines, from), changed)
    const route = { ...routing(kind, steps, config === 'cc-tiers-light' ? 'sonnet' : 'opus'), steps }
    return { found: escalationsIn(lines, from), route, quality: qualityIn(lines, from), seen: lines.length }
  }
  const sessionJob = async ({ rep, config }) => {
    const dir = workspace(fixture)
    const rows = []
    let id = ''
    let seen = 0
    let previous = null
    try {
      for (const task of tasks) {
        const before = passingTests(dir)
        const tree = workspaceTree(dir)
        const files = readTree(dir)
        const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin, id)
        const changed = workspaceTree(dir) !== tree
        const outside = outOfScopeFiles(files, readTree(dir), scopeOf(task, solutions))
        if (run.json?.session_id && run.json.session_id !== id) seen = 0
        id = run.json?.session_id || id
        const read = transcriptFor(config, id, seen, task.kind, changed)
        seen = read.seen
        const verdict = grade(dir, task, run.json?.result, checks, before)
        rmSync(path.join(dir, '.bench-check'), { recursive: true, force: true })
        const step = { ...run, json: stepUsage(run.json, previous) }
        if (run.json) previous = run.json
        const row = { ...summarize(nameOf(config), task, rep, step, verdict, read.found, read.route, read.quality, outside), mode: 'session' }
        process.stderr.write(`${progress(row)} ${row.config} ${task.id} ${kilo(row.freshTokens)} tokens ${row.seconds}s${row.escalations ? ` escalations ${row.escalationPath.join(', ')}` : ''}${row.route ? ` route ${row.route}${row.routedAsDocumented === false ? ' (off)' : ''}` : ''}\n`)
        rows.push(row)
      }
      return rows
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const results = session ? (await pool(jobs, parallel, sessionJob)).flat() : await pool(jobs, parallel, async ({ rep, task, config }) => {
    const dir = workspace(fixture)
    try {
      const before = passingTests(dir)
      const tree = workspaceTree(dir)
      const files = readTree(dir)
      const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin)
      const changed = workspaceTree(dir) !== tree
      const outside = outOfScopeFiles(files, readTree(dir), scopeOf(task, solutions))
      const verdict = grade(dir, task, run.json?.result, checks, before)
      const name = tag && config.startsWith('cc-tiers') ? `${config}@${tag}` : config
      const read = transcriptFor(config, run.json?.session_id, 0, task.kind, changed)
      const row = summarize(name, task, rep, run, verdict, read.found, read.route, read.quality, outside)
      process.stderr.write(`${progress(row)} ${name} ${task.id} ${kilo(row.freshTokens)} tokens ${row.seconds}s\n`)
      return row
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  mkdirSync(path.dirname(out), { recursive: true })
  const pluginVersion = (() => {
    try {
      return JSON.parse(readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version
    } catch {
      return ''
    }
  })()
  const report = {
    date: new Date().toISOString(),
    claudeCode: version,
    plugin: pluginVersion,
    mode: session ? 'session' : 'one-shot',
    repeat,
    fixture: path.relative(ROOT, fixture),
    tasksFile: path.relative(ROOT, tasksFile),
    configs,
    tasks: tasks.map((task) => task.id),
    results,
  }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${table(results)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  })
}
