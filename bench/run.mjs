#!/usr/bin/env node
/**
 * cc-tiers benchmark. Runs every task in tasks.json under each configuration with
 * `claude -p`, in a fresh git copy of fixture/, then copies the hidden check for
 * that task in and runs it with the project's own tests. Records pass/fail, the
 * cost Claude Code reports (list prices, per model), turns, wall time, subagents
 * by type, and the escalations cc-tiers announced in its hook messages.
 *
 *   node bench/run.mjs [--configs opus,sonnet,cc-tiers,cc-tiers-light] [--tasks typo,lru]
 *                      [--repeat 1] [--parallel 3] [--out bench/results/latest.json]
 *                      [--plugin <frozen copy of the plugin>] [--tag 0.4] [--session]
 *                      [--tasks-file bench/tasks-hard.json] [--fixture <dir>] [--checks <dir>]
 *                      [--timeout 15]
 *   node bench/run.mjs --table bench/results/a.json [bench/results/b.json ...]
 *
 * --tasks-file picks another task list. Its fixture and checks default to the
 * matching names: tasks-hard.json runs on fixture-hard/ with checks-hard/.
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

function runClaude(dir, config, prompt, timeoutMs, plugin, resume = '') {
  // project and local only: the user's own CLAUDE.md, agents, plugins, and hooks would change what is measured.
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--setting-sources', 'project,local', ...config.args(plugin)]
  if (resume) args.push('--resume', resume)
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

function check(dir, task, result, checks) {
  const target = path.join(dir, '.bench-check')
  mkdirSync(target, { recursive: true })
  cpSync(path.join(checks, `${task.id}.test.mjs`), path.join(target, `${task.id}.test.mjs`))
  const files = [`.bench-check/${task.id}.test.mjs`]
  const tests = spawnSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'test'], { cwd: dir, encoding: 'utf8' })
  for (const file of tests.stdout.split('\n')) if (/\.test\.m?js$/.test(file)) files.push(file)
  const env = { ...process.env, BENCH_RESULT: String(result || '') }
  delete env.NODE_TEST_CONTEXT
  const proc = spawnSync(process.execPath, ['--test', ...files], {
    cwd: dir,
    encoding: 'utf8',
    env,
    timeout: 120000,
  })
  return { pass: proc.status === 0, output: `${proc.stdout}\n${proc.stderr}`.slice(-1500) }
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
  for (const line of lines.slice(from)) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const fromHook = (row.type === 'attachment' && String(row.attachment?.type || '').startsWith('hook')) || row.type === 'system'
    if (!fromHook) continue
    const text = JSON.stringify(row.attachment ?? row).replace(/\\n/g, '\n')
    for (const { kind, pattern } of ESCALATIONS) {
      for (const match of text.matchAll(pattern)) found.push(`${match[1]}->${match[2]} (${kind})`)
    }
  }
  return found
}

const ROLE_TIER = {
  'cc-tiers:worker': 'haiku',
  'cc-tiers:implementer': 'sonnet',
  'cc-tiers:architect': 'opus',
  'cc-tiers:checker': 'sonnet',
  'cc-tiers:reviewer': 'opus',
  'cc-tiers:planner': 'opus',
}
const WRITERS = new Set(['cc-tiers:worker', 'cc-tiers:implementer', 'cc-tiers:architect'])
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
 * Whether a step was routed the way the README says: trivial work on Haiku or
 * inline (the light path), normal work written on Sonnet, hard work never written
 * on Haiku, and a large request split into at least two delegated tasks on at
 * least two tiers. sessionTier is the model of the session agent.
 */
export function routing(kind, steps, sessionTier) {
  const writers = steps
    .filter((step) => step.agent === 'inline' || WRITERS.has(step.agent))
    .map((step) => (step.agent === 'inline' ? `inline ${sessionTier}` : ROLE_TIER[step.agent]))
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

function summarize(config, task, rep, run, verdict, escalations = null, route = null) {
  const json = run.json || {}
  const models = {}
  const tokens = {}
  for (const [model, usage] of Object.entries(json.modelUsage || {})) {
    models[model] = Number(usage.costUSD) || 0
    tokens[model] = {
      input: usage.inputTokens || 0,
      output: usage.outputTokens || 0,
      cacheRead: usage.cacheReadInputTokens || 0,
      cacheWrite: usage.cacheCreationInputTokens || 0,
    }
  }
  return {
    config,
    task: task.id,
    kind: task.kind,
    rep,
    pass: verdict.pass,
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
    error: json.is_error ? String(json.result || '').slice(0, 300) : run.code === 0 ? '' : run.stderr.slice(-300),
    checkOutput: verdict.pass ? '' : verdict.output,
  }
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

function money(value) {
  return `$${Number(value).toFixed(value >= 1 ? 2 : 3)}`
}

/** The README table: one row per configuration, then one per task kind. */
export function table(results) {
  const configs = [...new Set(results.map((row) => row.config))]
  const lines = [
    '| Configuration | Passed | Mean cost per task | Cost per passed task | Median time | Opus share of cost |',
    '| --- | --: | --: | --: | --: | --: |',
  ]
  for (const config of configs) {
    const rows = results.filter((row) => row.config === config)
    const passed = rows.filter((row) => row.pass).length
    const cost = rows.reduce((sum, row) => sum + row.cost, 0)
    const opus = rows.reduce((sum, row) => sum + Object.entries(row.models).filter(([model]) => model.includes('opus')).reduce((s, [, v]) => s + v, 0), 0)
    const times = rows.map((row) => row.seconds).sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)] ?? 0
    lines.push(
      `| ${label(config)} | ${passed}/${rows.length} | ${money(cost / rows.length)} | ${passed ? money(cost / passed) : '—'} | ${median}s | ${cost ? Math.round((opus / cost) * 100) : 0}% |`,
    )
  }
  lines.push('')
  const tasks = [...new Set(results.map((row) => row.task))]
  lines.push(`| Task | ${configs.map(label).join(' | ')} |`)
  lines.push(`| --- | ${configs.map(() => '--:').join(' | ')} |`)
  for (const task of tasks) {
    const cells = configs.map((config) => {
      const rows = results.filter((row) => row.config === config && row.task === task)
      if (!rows.length) return '—'
      const passed = rows.filter((row) => row.pass).length
      const cost = rows.reduce((sum, row) => sum + row.cost, 0) / rows.length
      return `${passed === rows.length ? '✅' : passed ? '🟡' : '❌'} ${money(cost)}`
    })
    const kind = results.find((row) => row.task === task)?.kind
    lines.push(`| \`${task}\` (${kind}) | ${cells.join(' | ')} |`)
  }
  lines.push('', ...kindTable(results))
  if (results.some((row) => row.routedAsDocumented != null)) lines.push('', ...routingTable(results))
  return lines.join('\n')
}

/** Pass rate and cost per passed task for each kind of task, plus the escalations cc-tiers announced. */
export function kindTable(results) {
  const configs = [...new Set(results.map((row) => row.config))]
  const kinds = [...new Set(results.map((row) => row.kind))]
  const lines = [
    `| Configuration | ${kinds.map((kind) => `${kind}: passed | ${kind}: cost per passed task`).join(' | ')} | Escalations | Routed as documented |`,
    `| --- | ${kinds.map(() => '--: | --:').join(' | ')} | --: | --: |`,
  ]
  for (const config of configs) {
    const cells = kinds.map((kind) => {
      const rows = results.filter((row) => row.config === config && row.kind === kind)
      const passed = rows.filter((row) => row.pass).length
      const cost = rows.reduce((sum, row) => sum + row.cost, 0)
      return `${passed}/${rows.length} | ${passed ? money(cost / passed) : '—'}`
    })
    const counted = results.filter((row) => row.config === config && row.escalations != null)
    const escalations = counted.length ? counted.reduce((sum, row) => sum + row.escalations, 0) : '—'
    const routed = results.filter((row) => row.config === config && row.routedAsDocumented != null)
    const share = routed.length ? `${routed.filter((row) => row.routedAsDocumented).length}/${routed.length}` : '—'
    lines.push(`| ${label(config)} | ${cells.join(' | ')} | ${escalations} | ${share} |`)
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
  const tasksFile = path.resolve(value('--tasks-file', path.join(BENCH, 'tasks.json')))
  // tasks-<name>.json pairs with fixture-<name>/ and checks-<name>/ next to it.
  const suffix = path.basename(tasksFile).match(/^tasks(-.+)?\.json$/)?.[1] || ''
  const fixture = path.resolve(value('--fixture', path.join(path.dirname(tasksFile), `fixture${suffix}`)))
  const checks = path.resolve(value('--checks', path.join(path.dirname(tasksFile), `checks${suffix}`)))
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
  const nameOf = (config) => (tag && config.startsWith('cc-tiers') ? `${config}@${tag}` : config)
  const jobs = []
  if (session) {
    for (let rep = 1; rep <= repeat; rep += 1) for (const config of configs) jobs.push({ rep, config })
  } else {
    for (let rep = 1; rep <= repeat; rep += 1) for (const task of tasks) for (const config of configs) jobs.push({ rep, task, config })
  }
  process.stderr.write(`Running ${jobs.length} ${session ? 'sessions' : 'jobs'} (${configs.length} configs x ${tasks.length} tasks x ${repeat}) on ${path.relative(ROOT, fixture)}, ${parallel} at a time.\n`)
  // Escalations and routing exist only where cc-tiers routes; elsewhere they stay null rather than 0.
  const transcriptFor = (config, sessionId, from, kind) => {
    if (!config.startsWith('cc-tiers')) return { found: null, route: null, seen: from }
    const lines = readLines(transcriptFile(sessionId))
    const steps = routeIn(lines, from)
    const route = { ...routing(kind, steps, config === 'cc-tiers-light' ? 'sonnet' : 'opus'), steps }
    return { found: escalationsIn(lines, from), route, seen: lines.length }
  }
  const sessionJob = async ({ rep, config }) => {
    const dir = workspace(fixture)
    const rows = []
    let id = ''
    let seen = 0
    try {
      for (const task of tasks) {
        const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin, id)
        if (run.json?.session_id && run.json.session_id !== id) seen = 0
        id = run.json?.session_id || id
        const read = transcriptFor(config, id, seen, task.kind)
        seen = read.seen
        const verdict = check(dir, task, run.json?.result, checks)
        rmSync(path.join(dir, '.bench-check'), { recursive: true, force: true })
        const row = { ...summarize(nameOf(config), task, rep, run, verdict, read.found, read.route), mode: 'session' }
        process.stderr.write(`${row.pass ? 'PASS' : 'FAIL'} ${row.config} ${task.id} ${money(row.cost)} ${row.seconds}s${row.escalations ? ` escalations ${row.escalationPath.join(', ')}` : ''}${row.route ? ` route ${row.route}${row.routedAsDocumented === false ? ' (off)' : ''}` : ''}\n`)
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
      const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin)
      const verdict = check(dir, task, run.json?.result, checks)
      const name = tag && config.startsWith('cc-tiers') ? `${config}@${tag}` : config
      const read = transcriptFor(config, run.json?.session_id, 0, task.kind)
      const row = summarize(name, task, rep, run, verdict, read.found, read.route)
      process.stderr.write(`${row.pass ? 'PASS' : 'FAIL'} ${name} ${task.id} ${money(row.cost)} ${row.seconds}s\n`)
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
