#!/usr/bin/env node
/**
 * cc-tiers benchmark. Runs every task in tasks.json under each configuration with
 * `claude -p`, in a fresh git copy of fixture/, then copies the hidden check for
 * that task in and runs it with the project's own tests. Records pass/fail, the
 * cost Claude Code reports (list prices, per model), turns, and wall time.
 *
 *   node bench/run.mjs [--configs opus,sonnet,cc-tiers,cc-tiers-light] [--tasks typo,lru]
 *                      [--repeat 1] [--parallel 3] [--out bench/results/latest.json]
 *                      [--plugin <frozen copy of the plugin>] [--tag 0.4] [--session]
 *   node bench/run.mjs --table bench/results/a.json [bench/results/b.json ...]
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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-tiers-bench-'))
  cpSync(path.join(BENCH, 'fixture'), dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'fixture')
  return dir
}

function runClaude(dir, config, prompt, timeoutMs, plugin, resume = '') {
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', ...config.args(plugin)]
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

function check(dir, task, result) {
  const target = path.join(dir, '.bench-check')
  mkdirSync(target, { recursive: true })
  cpSync(path.join(BENCH, 'checks', `${task.id}.test.mjs`), path.join(target, `${task.id}.test.mjs`))
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

function summarize(config, task, rep, run, verdict) {
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
  return lines.join('\n')
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
  const allTasks = JSON.parse(readFileSync(path.join(BENCH, 'tasks.json'), 'utf8'))
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
  process.stderr.write(`Running ${jobs.length} ${session ? 'sessions' : 'jobs'} (${configs.length} configs x ${tasks.length} tasks x ${repeat}), ${parallel} at a time.\n`)
  const sessionJob = async ({ rep, config }) => {
    const dir = workspace()
    const rows = []
    let id = ''
    try {
      for (const task of tasks) {
        const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin, id)
        id = run.json?.session_id || id
        const verdict = check(dir, task, run.json?.result)
        rmSync(path.join(dir, '.bench-check'), { recursive: true, force: true })
        const row = { ...summarize(nameOf(config), task, rep, run, verdict), mode: 'session' }
        process.stderr.write(`${row.pass ? 'PASS' : 'FAIL'} ${row.config} ${task.id} ${money(row.cost)} ${row.seconds}s\n`)
        rows.push(row)
      }
      return rows
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const results = session ? (await pool(jobs, parallel, sessionJob)).flat() : await pool(jobs, parallel, async ({ rep, task, config }) => {
    const dir = workspace()
    try {
      const run = await runClaude(dir, CONFIGS[config], task.prompt, timeoutMs, plugin)
      const verdict = check(dir, task, run.json?.result)
      const name = tag && config.startsWith('cc-tiers') ? `${config}@${tag}` : config
      const row = summarize(name, task, rep, run, verdict)
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
  const report = { date: new Date().toISOString(), claudeCode: version, plugin: pluginVersion, mode: session ? 'session' : 'one-shot', repeat, configs, tasks: tasks.map((task) => task.id), results }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${table(results)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`)
    process.exit(1)
  })
}
