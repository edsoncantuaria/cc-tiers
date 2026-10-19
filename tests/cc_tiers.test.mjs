import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)

const MODELS = new Set(['haiku', 'sonnet', 'opus'])
const RESERVED_PREFIXES = ['claude-', 'anthropic-', 'anthropics-', 'cc-plugin-']

function frontmatter(file) {
  const text = readFileSync(file, 'utf8')
  assert.ok(text.startsWith('---\n'), `${file} must open with frontmatter`)
  const end = text.indexOf('\n---\n', 4)
  assert.ok(end > 0, `${file} frontmatter does not close`)
  const fields = {}
  for (const line of text.slice(4, end).split(/\n/)) {
    if (!line.trim() || line.startsWith(' ')) continue
    const split = line.indexOf(':')
    fields[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^"|"$/g, '')
  }
  return fields
}

function report(role, tier, status, review = '', reason = 'pytest failed') {
  const lines = [
    'CC_TIERS_TASK: users-pagination',
    `CC_TIERS_TIER: ${tier}`,
    `CC_TIERS_ROLE: ${role}`,
    `CC_TIERS_STATUS: ${status}`,
  ]
  if (review) lines.push(`CC_TIERS_REVIEW: ${review}`)
  lines.push(`CC_TIERS_REASON: ${reason}`)
  return lines.join('\n')
}

function event(toolUseId, role, text, prompt = '', failure = false) {
  const base = {
    session_id: 'sess-1',
    tool_name: 'Agent',
    tool_use_id: toolUseId,
    tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
  }
  if (failure) {
    base.hook_event_name = 'PostToolUseFailure'
    base.error = 'agent crashed'
    return base
  }
  base.hook_event_name = 'PostToolUse'
  base.tool_response = { status: 'completed', content: [{ type: 'text', text }] }
  return base
}

function apply(state, routing, toolUseId, role, text, prompt = '') {
  const normalized = tiers.normalizeEvent(event(toolUseId, role, text, prompt))
  assert.ok(normalized)
  return tiers.applyEvent(state, normalized, routing)
}

test('required files are present and Python hooks are gone', () => {
  for (const relative of [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'settings.json',
    'LICENSE',
    'README.md',
    'README.pt-BR.md',
    'CHANGELOG.md',
    'hooks/hooks.json',
    'hooks/cc_tiers.mjs',
    'hooks/session_start.mjs',
    'hooks/after_agent.mjs',
    'hooks/before_agent.mjs',
    'hooks/subagent_stop.mjs',
    'hooks/stop.mjs',
    'hooks/route.mjs',
    '.gitattributes',
    '.github/workflows/ci.yml',
    'skills/tiers/SKILL.md',
    'commands/route.md',
    'commands/escalate.md',
    'config/routing.default.json',
    'agents/orchestrator.md',
    'agents/worker.md',
    'agents/implementer.md',
    'agents/reviewer.md',
    'agents/checker.md',
  ]) {
    assert.ok(existsSync(path.join(ROOT, relative)), relative)
  }
  for (const gone of ['hooks/session-start.sh', 'hooks/after-agent.sh', 'hooks/cc_tiers.py', 'hooks/session_start.py', 'hooks/after_agent.py', 'tests/test_cc_tiers.py']) {
    assert.equal(existsSync(path.join(ROOT, gone)), false, gone)
  }
})

test('manifest declares the 0.3.0 knobs', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'cc-tiers')
  assert.equal(manifest.version, '0.3.0')
  assert.equal(/\s|@|:|\/|\\/.test(manifest.name), false)
  assert.equal(RESERVED_PREFIXES.some((prefix) => manifest.name.startsWith(prefix)), false)
  assert.equal(manifest.license, 'MIT')
  assert.ok(manifest.homepage.startsWith('https://'))
  for (const [key, expected] of [
    ['max_attempts', 'number'],
    ['review_policy', 'string'],
    ['trivial_extra', 'string'],
    ['risky_extra', 'string'],
    ['learn', 'string'],
    ['budget_5h', 'number'],
    ['budget_7d', 'number'],
  ]) {
    const option = manifest.userConfig[key]
    assert.equal(option.type, expected)
    assert.ok(option.title)
    assert.ok(option.description)
  }
  assert.equal(manifest.userConfig.max_attempts.default, 2)
  assert.equal(manifest.userConfig.max_attempts.min, 1)
  assert.equal(manifest.userConfig.max_attempts.max, 5)
  const review = manifest.userConfig.review_policy
  assert.deepEqual(review.options, ['cheap', 'risky', 'always', 'never'])
  assert.equal(review.default, 'cheap')
  assert.deepEqual(manifest.userConfig.learn.options, ['on', 'off'])
  assert.equal(manifest.userConfig.learn.default, 'on')
  assert.equal(manifest.userConfig.budget_5h.default, 80)
  assert.equal(manifest.userConfig.budget_7d.default, 80)
  assert.equal(manifest.userConfig.budget_5h.min, 1)
  assert.equal(manifest.userConfig.budget_7d.max, 100)
  assert.equal(readdirSync(ROOT).includes('CLAUDE.md'), false)
})

test('marketplace and settings stay pointed at this plugin', () => {
  const market = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'))
  assert.equal(market.name, 'cc-tiers')
  assert.ok(market.owner.name)
  assert.equal(market.plugins[0].name, 'cc-tiers')
  assert.equal(market.plugins[0].source, './')
  const settings = JSON.parse(readFileSync(path.join(ROOT, 'settings.json'), 'utf8'))
  assert.equal(settings.agent, 'orchestrator')
  assert.deepEqual(Object.keys(settings), ['agent'])
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes('0.2.0'))
  assert.ok(changelog.includes('0.3.0'))
  assert.ok(changelog.includes('cc-cost'))
})

test('agents pin family aliases, including the Sonnet checker', () => {
  const expected = {
    orchestrator: 'opus',
    reviewer: 'opus',
    checker: 'sonnet',
    implementer: 'sonnet',
    worker: 'haiku',
  }
  for (const [name, model] of Object.entries(expected)) {
    const fields = frontmatter(path.join(ROOT, 'agents', `${name}.md`))
    assert.equal(fields.name, name)
    assert.ok(fields.description)
    assert.equal(fields.model, model)
    assert.ok(MODELS.has(fields.model))
    assert.equal(fields.name.includes(':'), false)
  }
})

test('skill and commands keep their frontmatter', () => {
  const skill = frontmatter(path.join(ROOT, 'skills/tiers/SKILL.md'))
  assert.equal(skill.name, 'tiers')
  assert.ok(skill.description.includes('Haiku'))
  const body = readFileSync(path.join(ROOT, 'skills/tiers/SKILL.md'), 'utf8')
  assert.ok(body.includes('${user_config.max_attempts}'))
  assert.ok(body.includes('${user_config.review_policy}'))
  assert.ok(body.includes('${user_config.learn}'))
  assert.ok(body.includes('cc-tiers:checker'))
  for (const command of ['route.md', 'escalate.md']) {
    const fields = frontmatter(path.join(ROOT, 'commands', command))
    assert.equal('name' in fields, false)
    assert.ok(fields.description)
  }
})

test('hooks call node directly, so they run under bash and PowerShell', () => {
  const hooks = JSON.parse(readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'))
  const events = hooks.hooks
  for (const name of ['SessionStart', 'Stop', 'UserPromptSubmit', 'SubagentStop']) assert.ok(events[name], name)
  for (const name of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) assert.equal(events[name][0].matcher, 'Agent')
  assert.equal(events.PreToolUse[0].hooks[0].onFailure, 'continue')
  for (const event of Object.values(events)) {
    const command = event[0].hooks[0].command
    assert.match(command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z_]+\.mjs"$/)
    const script = command.match(/hooks\/([a-z_]+\.mjs)/)[1]
    assert.ok(existsSync(path.join(ROOT, 'hooks', script)), script)
  }
  assert.ok(readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').includes('eol=lf'))
})

test('readmes stay in sync in structure and behavior', () => {
  for (const name of ['README.md', 'README.pt-BR.md']) {
    const text = readFileSync(path.join(ROOT, name), 'utf8')
    for (const marker of [
      '/plugin install cc-tiers --marketplace edsoncantuaria/cc-tiers',
      'users-pagination',
      'max_attempts',
      'fetchUser',
      'cc-cost',
      'budget_5h',
      'budget_7d',
      'cc-tiers-history.json',
      'cheap',
      'cc-tiers:checker',
      'node --test',
      'five_hour',
      'seven_day',
    ]) {
      assert.ok(text.includes(marker), `${name} missing ${marker}`)
    }
  }
  const outline = (name) => {
    const text = readFileSync(path.join(ROOT, name), 'utf8')
    return {
      headings: text.split(/\n/).filter((line) => /^#{1,3} /.test(line)).length,
      tables: text.split(/\n/).filter((line) => line.startsWith('|')).length,
      fences: text.split(/\n/).filter((line) => line.startsWith('```')).length,
      json: text.match(/```json\n[\s\S]*?```/g),
      bash: text.match(/```bash\n[\s\S]*?```/g).map((block) => block.replace('/caminho/para/', '/path/to/')),
      version: text.match(/badge\/Claude_Code-[^-]+/)[0],
    }
  }
  assert.deepEqual(outline('README.pt-BR.md'), outline('README.md'))
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
  assert.ok(license.includes('MIT License'))
  assert.ok(license.includes('Copyright (c) 2026 Edson Cantuária'))
})

test('user config wins for attempts, policy, learn, and budgets', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const routing = tiers.mergeRouting(
    defaults,
    { maxAttempts: 5, reviewPolicy: 'never', learn: 'off', budget5h: 50, trivialExtra: ['changelog edits'] },
    { max_attempts: 3, review_policy: 'always', learn: 'on', budget_5h: 70, trivial_extra: 'license year bumps' },
  )
  assert.equal(routing.maxAttempts, 3)
  assert.equal(routing.reviewPolicy, 'always')
  assert.equal(routing.learn, true)
  assert.equal(routing.budget5h, 70)
  assert.ok(routing.tiers.haiku.when.includes('changelog edits'))
  assert.ok(routing.tiers.haiku.when.includes('license year bumps'))
  assert.ok(routing.notes.some((note) => note.includes('maxAttempts')))
  assert.ok(routing.notes.some((note) => note.includes('learn')))
})

test('bad attempts, policy, and thresholds fall back', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const routing = tiers.mergeRouting(defaults, null, {
    max_attempts: 'nine',
    review_policy: 'loud',
    budget_5h: 0,
    budget_7d: 'high',
    learn: 'maybe',
  })
  assert.equal(routing.maxAttempts, 2)
  assert.equal(routing.reviewPolicy, 'cheap')
  assert.equal(routing.budget5h, 80)
  assert.equal(routing.budget7d, 80)
  assert.equal(routing.learn, true)
})

test('a project can turn learning off when /config leaves it unset', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const routing = tiers.mergeRouting(defaults, { learn: 'off', budget5h: 60 }, {})
  assert.equal(routing.learn, false)
  assert.equal(routing.budget5h, 60)
  assert.equal(routing.notes.some((note) => note.includes('learn')), false)
})

test('a project list replaces only that list', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const routing = tiers.mergeRouting(defaults, {
    tiers: { haiku: { when: ['changelog edits'] }, opus: { reviewWhen: 'nope' } },
  })
  assert.deepEqual(routing.tiers.haiku.when, ['changelog edits'])
  assert.ok(routing.tiers.opus.reviewWhen.join(' ').includes('public API'))
  assert.ok(routing.notes.some((note) => note.includes('reviewWhen')))
})

test('session context states the limit and the cost gap', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const routing = tiers.mergeRouting(defaults, null, { max_attempts: 2, review_policy: 'risky' })
  const text = tiers.formatSessionContext(routing, 'not present', {
    budget: { fiveHour: null, sevenDay: null, conserve: false, hits: [] },
    history: { version: 1, entries: [] },
    ccCost: { installed: false },
  })
  assert.ok(text.includes('Max attempts per tier: 2.'))
  assert.ok(text.includes('cc-tiers:worker'))
  assert.ok(text.includes('not present'))
  assert.ok(text.includes('cc-cost: not installed'))
})

function riskyRouting() {
  return tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), null, {
    max_attempts: 2,
    review_policy: 'risky',
  })
}

test('two Sonnet failures escalate with the notes', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('sess-1')
  let applied = apply(state, routing, 't1', 'implementer', report('implementer', 'sonnet', 'fail', '', 'cursor off by one'))
  state = applied.state
  assert.ok(applied.message.includes('Retry on sonnet'))
  assert.deepEqual(state.tasks['users-pagination'].failures, ['sonnet/implementer: cursor off by one'])
  applied = apply(state, routing, 't2', 'implementer', report('implementer', 'sonnet', 'fail', '', 'cursor still wrong'))
  assert.ok(applied.message.includes('The next tier is opus'))
  assert.ok(applied.message.includes('cursor off by one'))
  assert.ok(applied.message.includes('cursor still wrong'))
  const task = applied.state.tasks['users-pagination']
  assert.equal(task.tier, 'opus')
  assert.deepEqual(task.failures, [])
  assert.equal(task.carried.length, 2)
})

test('a review rejection counts against the writer', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('sess-1')
  state = apply(state, routing, 't1', 'implementer', report('implementer', 'sonnet', 'fail', '', 'tests failed')).state
  const passed = apply(state, routing, 't2', 'implementer', report('implementer', 'sonnet', 'pass', 'pending'))
  assert.ok(passed.message.includes('passed on sonnet'))
  const rejected = apply(
    passed.state,
    routing,
    't3',
    'reviewer',
    report('reviewer', 'sonnet', 'fail', '', 'cursor is not validated'),
  )
  assert.ok(rejected.message.includes('The next tier is opus'))
  assert.ok(rejected.message.includes('tests failed'))
  assert.ok(rejected.message.includes('reviewer: cursor is not validated'))
})

test('an Opus review pass clears the task', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('sess-1')
  state = apply(state, routing, 't1', 'implementer', report('implementer', 'sonnet', 'pass', 'pending')).state
  const message = apply(state, routing, 't2', 'reviewer', report('reviewer', 'sonnet', 'pass', '', 'checked the cursor'))
  assert.ok(message.message.includes('passed Opus review'))
  assert.equal(message.state.tasks['users-pagination'], undefined)
})

test('skip review clears the task', () => {
  const routing = riskyRouting()
  const applied = apply(
    tiers.emptyState('sess-1'),
    routing,
    't1',
    'worker',
    report('worker', 'haiku', 'pass', 'skip', 'renamed'),
  )
  assert.ok(applied.message.includes('review was skipped'))
  assert.equal(applied.state.tasks['users-pagination'], undefined)
})

test('the Opus ceiling stops', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('sess-1')
  let message = ''
  for (const [index, reason] of ['first', 'second'].entries()) {
    const applied = apply(state, routing, `o${index}`, 'implementer', report('implementer', 'sonnet', 'fail', '', reason))
    state = applied.state
    message = applied.message
  }
  assert.ok(message.includes('next tier is opus'))
  assert.equal(state.tasks['users-pagination'].tier, 'opus')
  state.tasks['users-pagination'].failures = []
  const first = apply(state, routing, 'r1', 'reviewer', report('reviewer', 'opus', 'fail', '', 'still wrong'))
  assert.ok(first.message.includes('Retry on opus'))
  const second = apply(first.state, routing, 'r2', 'reviewer', report('reviewer', 'opus', 'fail', '', 'still wrong again'))
  assert.ok(second.message.includes('Opus is the last tier'))
})

test('a duplicate tool use is ignored', () => {
  const routing = riskyRouting()
  const text = report('implementer', 'sonnet', 'fail', '', 'once')
  const first = apply(tiers.emptyState('sess-1'), routing, 'same', 'implementer', text)
  const second = apply(first.state, routing, 'same', 'implementer', text)
  assert.equal(second.message, '')
  assert.equal(second.state.tasks['users-pagination'].failures.length, 1)
})

test('a subagent error counts from the prompt header', () => {
  const routing = riskyRouting()
  const prompt = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: haiku\nCC_TIERS_ROLE: worker\nRename it.'
  const normalized = tiers.normalizeEvent(event('e1', 'worker', '', prompt, true))
  const applied = tiers.applyEvent(tiers.emptyState('sess-1'), normalized, routing)
  assert.ok(applied.message.includes('Retry on haiku'))
  assert.ok(applied.message.includes('agent crashed'))
  assert.equal(applied.meta.haikuFailure, true)
})

test('an interrupt does not count', () => {
  const raw = event('e1', 'worker', '', '', true)
  raw.is_interrupt = true
  assert.equal(tiers.normalizeEvent(raw), null)
})

test('a background launch does not increment', () => {
  const routing = riskyRouting()
  const raw = event('b1', 'worker', 'CC_TIERS_STATUS: fail')
  raw.tool_response = { status: 'async_launched' }
  const normalized = tiers.normalizeEvent(raw)
  assert.equal(normalized.kind, 'background')
  const applied = tiers.applyEvent(tiers.emptyState('sess-1'), normalized, routing)
  assert.ok(applied.message.includes('background'))
  assert.deepEqual(applied.state.tasks, {})
})

test('cheap review sends Haiku to the checker and risky Sonnet work to Opus', () => {
  assert.equal(tiers.selectReviewer({ policy: 'cheap', writerTier: 'haiku', risky: false, conserve: false }), 'checker')
  assert.equal(tiers.selectReviewer({ policy: 'cheap', writerTier: 'sonnet', risky: false, conserve: false }), null)
  assert.equal(tiers.selectReviewer({ policy: 'cheap', writerTier: 'sonnet', risky: true, conserve: false }), 'reviewer')
  assert.equal(tiers.selectReviewer({ policy: 'cheap', writerTier: 'opus', risky: false, conserve: false }), 'reviewer')
  assert.equal(tiers.selectReviewer({ policy: 'always', writerTier: 'haiku', risky: false, conserve: false }), 'checker')
  assert.equal(tiers.selectReviewer({ policy: 'always', writerTier: 'sonnet', risky: false, conserve: false }), 'reviewer')
  assert.equal(tiers.selectReviewer({ policy: 'never', writerTier: 'haiku', risky: true, conserve: false }), null)
  assert.equal(tiers.selectReviewer({ policy: 'risky', writerTier: 'haiku', risky: false, conserve: false }), null)
  assert.equal(tiers.selectReviewer({ policy: 'risky', writerTier: 'sonnet', risky: false, conserve: false }), 'reviewer')
  assert.equal(tiers.selectReviewer({ policy: 'risky', writerTier: 'sonnet', risky: false, conserve: true }), null)
  assert.equal(tiers.selectReviewer({ policy: 'always', writerTier: 'haiku', risky: false, conserve: true }), 'checker')
})

test('a cheap Haiku pass waits for the Sonnet checker, and a checker pass clears it', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), null, {
    review_policy: 'cheap',
  })
  const passed = apply(tiers.emptyState('sess-1'), routing, 't1', 'worker', report('worker', 'haiku', 'pass', 'pending', 'renamed'))
  assert.ok(passed.message.includes('cc-tiers:checker'))
  assert.ok(passed.state.tasks['users-pagination'])
  const cleared = apply(passed.state, routing, 't2', 'checker', report('checker', 'haiku', 'pass', '', 'rename is sound'))
  assert.ok(cleared.message.includes('passed Sonnet review'))
  assert.equal(cleared.state.tasks['users-pagination'], undefined)
})

test('ordinary Sonnet work is not queued for Opus under the cheap policy', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), null, {
    review_policy: 'cheap',
  })
  const passed = apply(
    tiers.emptyState('sess-1'),
    routing,
    't1',
    'implementer',
    report('implementer', 'sonnet', 'pass', 'pending', 'added the helper'),
  )
  assert.ok(passed.message.includes('no review is due'))
  assert.equal(passed.state.tasks['users-pagination'], undefined)
})

test('fresh tokens follow cc-cost and drop cache reads', () => {
  assert.equal(
    tiers.freshTokens({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: 1000,
    }),
    2500,
  )
  assert.equal(tiers.tierOfModel('claude-haiku-4-5'), 'haiku')
  assert.equal(tiers.tierOfModel('claude-sonnet-4-5'), 'sonnet')
  assert.equal(tiers.tierOfModel('claude-opus-4-1'), 'opus')
  assert.equal(tiers.tierOfModel('other'), null)
})

test('cc-cost install records and limit kinds are recognized', () => {
  assert.equal(tiers.manifestHasCcCost({ plugins: { 'cc-cost@edsoncantuaria': [{ version: '0.6.1' }] } }), true)
  assert.equal(tiers.manifestHasCcCost({ plugins: [{ name: 'cc-tiers' }] }), false)
  const now = Date.parse('2026-10-19T12:00:00Z')
  const limits = tiers.parseLimits(
    {
      rateLimits: [
        { kind: 'five_hour', percentUsed: 82, resetsAt: '2026-10-19T15:00:00Z' },
        { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-19T11:00:00Z' },
      ],
    },
    now,
  )
  assert.equal(limits.fiveHour, 82)
  assert.equal(limits.sevenDay, 0)
  const status = tiers.parseLimits(
    { rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 70 } } },
    now,
  )
  assert.equal(status.fiveHour, 10)
  assert.equal(status.sevenDay, 70)
  assert.equal(tiers.freshFromStore({ 'novos:2026-10-19:a': 1000, 'novos:2026-10-19:b': 2500, 'novos:2026-10-18:a': 9 }, '2026-10-19'), 3500)
})

function assistantRow(model, usage, blocks, extra = {}) {
  return JSON.stringify({ type: 'assistant', uuid: extra.uuid, isSidechain: extra.isSidechain, message: { id: extra.id, model, usage, content: blocks } })
}

const DELEGATE = (task) => ({
  type: 'tool_use',
  name: 'Agent',
  input: { subagent_type: 'cc-tiers:worker', prompt: `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: haiku\nCC_TIERS_ROLE: worker\nrename` },
})

test('transcript usage charges delegations and ceiling work, and the rest is orchestration', () => {
  const opus = (input) => ({ input_tokens: input, output_tokens: 0, cache_read_input_tokens: 9999 })
  const transcript = [
    JSON.stringify({ type: 'user', message: { content: 'CC_TIERS_TASK: from-a-user-row\nignored' } }),
    assistantRow('claude-opus-4-5', opus(10), [{ type: 'text', text: 'planning' }], { id: 'm1' }),
    assistantRow('claude-opus-4-5', opus(20), [DELEGATE('rename-fetch-user')], { id: 'm2' }),
    assistantRow('claude-opus-4-5', opus(20), [DELEGATE('rename-fetch-user')], { id: 'm2' }),
    assistantRow('claude-haiku-4-5', { input_tokens: 500 }, [{ type: 'text', text: 'side' }], { id: 's1', isSidechain: true }),
    assistantRow('claude-opus-4-5', opus(30), [{ type: 'text', text: 'summary' }], { id: 'm3' }),
    assistantRow('claude-opus-4-5', opus(40), [{ type: 'text', text: 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator' }], { id: 'm4' }),
    assistantRow('claude-opus-4-5', opus(50), [{ type: 'text', text: 'editing' }], { id: 'm5' }),
    assistantRow('claude-opus-4-5', opus(60), [{ type: 'text', text: 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: cursor test fails' }], { id: 'm6', uuid: 'u6' }),
    assistantRow('claude-opus-4-5', opus(70), [{ type: 'text', text: 'after' }], { id: 'm7' }),
  ].join('\n')
  const spend = tiers.attributeTranscript(transcript)
  assert.equal(spend['rename-fetch-user'].opus, 20)
  assert.equal(spend['users-pagination'].opus, 150)
  assert.equal(spend[tiers.OVERHEAD].opus, 110)
  assert.equal(spend['from-a-user-row'], undefined)
  assert.equal(Object.values(spend).some((tiersSpend) => tiersSpend.haiku > 0), false)
})

test('the transcript is scanned incrementally and totals only grow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const file = path.join(dir, 'transcript.jsonl')
    const state = tiers.emptyState('s')
    writeFileSync(file, `${assistantRow('claude-opus-4-5', { input_tokens: 10 }, [DELEGATE('a')], { id: 'm1' })}\n{"partial":`)
    tiers.scanTranscript(state, file)
    assert.equal(state.spend.a.opus, 10)
    const offset = state.cursor.offset
    writeFileSync(
      file,
      `${assistantRow('claude-opus-4-5', { input_tokens: 10 }, [DELEGATE('a')], { id: 'm1' })}\n` +
        `${assistantRow('claude-opus-4-5', { input_tokens: 5 }, [DELEGATE('a')], { id: 'm2' })}\n` +
        `${JSON.stringify({ type: 'system', rate_limits: { five_hour: { used_percentage: 91 } } })}\n`,
    )
    tiers.scanTranscript(state, file)
    assert.ok(state.cursor.offset > offset)
    assert.equal(state.spend.a.opus, 15)
    tiers.scanTranscript(state, file)
    assert.equal(state.spend.a.opus, 15)
    assert.equal(tiers.collectLimits({ cursor: state.cursor, env: {} }).fiveHour, 91)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an Opus ceiling trailer is counted as a report', () => {
  const routing = riskyRouting()
  const state = tiers.emptyState('s')
  state.tasks['users-pagination'] = { tier: 'opus', failures: [], carried: ['sonnet/implementer: a', 'sonnet/implementer: b'] }
  const ctx = { routing, ccCost: false, projectDir: '' }
  const text = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: still red'
  const message = tiers.processReport(ctx, state, { kind: 'report', id: 'row:u1', role: 'orchestrator', prompt: '', text })
  assert.ok(message.includes('Retry on opus'))
  assert.ok(message.includes('opus/orchestrator: still red'))
  assert.equal(tiers.processReport(ctx, state, { kind: 'report', id: 'row:u1', role: 'orchestrator', prompt: '', text }), '')
})

test('budget routing keeps Opus for the ceiling and for planning', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')))
  const cross = 'cross-cutting work the orchestrator cannot hand off cleanly'
  assert.equal(tiers.decideTier(cross, routing, { conserve: false }).tier, 'opus')
  assert.equal(tiers.decideTier(cross, routing, { conserve: true }).because, 'budget')
  assert.equal(tiers.decideTier(cross, routing, { conserve: true }).tier, 'sonnet')
  assert.equal(tiers.decideTier(cross, routing, { conserve: true, ceiling: true }).because, 'ceiling')
  assert.equal(tiers.decideTier('planning and splitting work into tasks', routing, { conserve: true }).because, 'orchestration')
  const decision = tiers.budgetDecision({ fiveHour: 80, sevenDay: 10 }, routing)
  assert.equal(decision.conserve, true)
  assert.equal(tiers.budgetDecision({ fiveHour: 79, sevenDay: 10 }, routing).conserve, false)
  assert.equal(tiers.budgetDecision({ fiveHour: null, sevenDay: null }, routing).conserve, false)
})

test('Haiku failures steer a similar task to Sonnet', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')))
  const history = tiers.noteHaikuFailure(tiers.emptyHistory(), {
    task: 'users-pagination',
    prompt: 'a mechanical edit of about 15 lines or fewer in one file',
    reason: 'not a trivial task',
    now: '2026-10-19T12:00:00.000Z',
  })
  assert.equal(history.entries[0].kind, 'users-pagination')
  const similar = tiers.decideTier('a mechanical edit of about 15 lines or fewer in one file', routing, { history })
  assert.equal(similar.tier, 'sonnet')
  assert.equal(similar.because, 'history')
  const rename = tiers.decideTier('rename a symbol in one or two files', routing, { history })
  assert.equal(rename.tier, 'haiku')
  assert.equal(rename.because, 'trivial')
  const learnedRename = tiers.noteHaikuFailure(history, {
    task: 'rename-fetch-user',
    prompt: 'rename a symbol in one or two files',
    reason: 'missed a call site',
    now: '2026-10-19T12:05:00.000Z',
  })
  const bumped = tiers.decideTier('rename a symbol in one or two files', routing, { history: learnedRename })
  assert.equal(bumped.tier, 'sonnet')
  assert.equal(bumped.because, 'history')
  assert.equal(tiers.decideTier('rename a symbol in one or two files', routing, { history: null }).tier, 'haiku')
})

test('the history file goes in .git/info/exclude, not the tracked .gitignore', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    mkdirSync(path.join(dir, '.git'))
    assert.equal(tiers.ensureHistoryIgnored(dir), true)
    assert.ok(readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8').includes('/.claude/cc-tiers-history.json'))
    assert.equal(existsSync(path.join(dir, '.gitignore')), false)
    assert.equal(tiers.ensureHistoryIgnored(dir), false)
    const file = tiers.historyPath(dir)
    tiers.saveHistory(file, tiers.noteHaikuFailure(null, { task: 'fix-typo', prompt: 'fix a typo', reason: 'wrong file', now: '2026-10-19T00:00:00.000Z' }))
    assert.equal(tiers.loadHistory(file).entries[0].kind, 'fix-typo')

    const plain = path.join(dir, 'plain')
    mkdirSync(plain)
    assert.equal(tiers.ensureHistoryIgnored(plain), false)
    assert.equal(existsSync(path.join(plain, '.gitignore')), false)

    const worktree = path.join(dir, 'worktree')
    const gitDir = path.join(dir, '.git', 'worktrees', 'wt')
    mkdirSync(worktree)
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(path.join(gitDir, 'commondir'), '../..\n')
    writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`)
    assert.equal(tiers.gitCommonDir(worktree), path.join(dir, '.git'))
    assert.equal(tiers.ensureHistoryIgnored(worktree), false)

    const ignored = path.join(dir, 'ignored')
    mkdirSync(path.join(ignored, '.git'), { recursive: true })
    writeFileSync(path.join(ignored, '.gitignore'), '.claude/cc-tiers-history.json\n')
    assert.equal(tiers.ensureHistoryIgnored(ignored), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function runHook(script, payload, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'hooks', script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  })
}

test('session start emits context without Python', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, '.claude'), { recursive: true })
    writeFileSync(path.join(project, '.claude', 'cc-tiers.json'), JSON.stringify({ trivialExtra: ['changelog edits'] }))
    const limits = path.join(dir, 'limits.json')
    writeFileSync(
      limits,
      JSON.stringify({ rateLimits: [{ kind: 'five_hour', percentUsed: 91 }, { kind: 'seven_day', percentUsed: 12 }] }),
    )
    writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ [`novos:${tiers.localDay()}:abc`]: 4200 }))
    const data = path.join(dir, 'data')
    const proc = runHook(
      'session_start.mjs',
      { session_id: 'abc', hook_event_name: 'SessionStart' },
      {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: ROOT,
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_PLUGIN_DATA: data,
        CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
        CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'risky',
        CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA: 'license year bumps',
        CLAUDE_PLUGIN_OPTION_RISKY_EXTRA: 'billing',
        CLAUDE_PLUGIN_OPTION_LEARN: 'on',
        CC_TIERS_CC_COST: '1',
        CC_TIERS_LIMITS_FILE: limits,
        CC_TIERS_CC_COST_DATA: dir,
        HOME: path.join(dir, 'home'),
      },
    )
    assert.equal(proc.status, 0, proc.stderr)
    const payload = JSON.parse(proc.stdout)
    const text = payload.hookSpecificOutput.additionalContext
    assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart')
    assert.ok(text.includes('Max attempts per tier: 2.'))
    assert.ok(text.includes('changelog edits'))
    assert.ok(text.includes('license year bumps'))
    assert.ok(text.includes('billing'))
    assert.ok(text.includes('cc-cost: installed'))
    assert.ok(text.includes('cc-cost today: 4200 fresh tokens'))
    assert.ok(text.includes('Budget routing: conserve (5h 91%)'))
    assert.ok(existsSync(path.join(data, 'session-abc.json')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the after-agent hook escalates on the second failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PLUGIN_DATA: dir,
      CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
      CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'risky',
      CLAUDE_PLUGIN_OPTION_TRIVIAL_EXTRA: '',
      CLAUDE_PLUGIN_OPTION_RISKY_EXTRA: '',
      CLAUDE_PLUGIN_OPTION_LEARN: 'off',
      CC_TIERS_CC_COST: '0',
    }
    delete env.CLAUDE_PROJECT_DIR
    const messages = []
    for (const [toolId, reason] of [
      ['a', 'cursor off by one'],
      ['b', 'cursor still wrong'],
    ]) {
      const raw = event('implementer-id', 'implementer', report('implementer', 'sonnet', 'fail', '', reason))
      raw.tool_use_id = toolId
      const proc = runHook('after_agent.mjs', raw, env)
      assert.equal(proc.status, 0, proc.stderr)
      messages.push(JSON.parse(proc.stdout).hookSpecificOutput.additionalContext)
    }
    assert.ok(messages[0].includes('Retry on sonnet'))
    assert.ok(messages[1].includes('The next tier is opus'))
    assert.ok(messages[1].includes('cursor off by one'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a Haiku failure is recorded and the spend line uses the tool response', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = path.join(dir, 'project')
    mkdirSync(path.join(project, '.git'), { recursive: true })
    const raw = event('h1', 'worker', report('worker', 'haiku', 'fail', '', 'not a trivial task'), 'Add pagination to GET /users')
    raw.tool_response.usage = {
      input_tokens: 20,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 0,
      model: 'claude-haiku-4-5',
    }
    const proc = runHook('after_agent.mjs', raw, {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PLUGIN_DATA: path.join(dir, 'data'),
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
      CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'cheap',
      CLAUDE_PLUGIN_OPTION_LEARN: 'on',
      CC_TIERS_CC_COST: '1',
      HOME: path.join(dir, 'home'),
    })
    assert.equal(proc.status, 0, proc.stderr)
    const text = JSON.parse(proc.stdout).hookSpecificOutput.additionalContext
    assert.ok(text.includes('Retry on haiku'))
    assert.ok(text.includes('recorded a Haiku failure for users-pagination'))
    assert.ok(text.includes('haiku 25 fresh tokens'))
    assert.ok(readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8').includes('.claude/cc-tiers-history.json'))
    assert.equal(existsSync(path.join(project, '.gitignore')), false)
    const history = JSON.parse(readFileSync(path.join(project, '.claude', 'cc-tiers-history.json'), 'utf8'))
    assert.equal(history.entries[0].kind, 'users-pagination')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missing cc-cost omits the spend line', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const raw = event('h1', 'worker', report('worker', 'haiku', 'fail', '', 'not a trivial task'))
    raw.tool_response.usage = { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const proc = runHook('after_agent.mjs', raw, {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PLUGIN_DATA: dir,
      CLAUDE_PLUGIN_OPTION_LEARN: 'off',
      CC_TIERS_CC_COST: '0',
    })
    delete proc.env
    assert.equal(proc.status, 0, proc.stderr)
    const text = JSON.parse(proc.stdout).hookSpecificOutput.additionalContext
    assert.equal(text.includes('fresh tokens'), false)
    assert.equal(existsSync(path.join(dir, '..', '.claude', 'cc-tiers-history.json')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function defaultRouting(user = {}) {
  return tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), null, user)
}

test('the built-in lists match real task wording, in English and Portuguese', () => {
  const routing = defaultRouting()
  for (const risky of [
    'Add OAuth authentication to the login endpoint',
    'Write a database migration for the users table',
    'Adicionar migração do banco de pagamentos',
    'Fix a race condition in the job queue',
    'Change the public API for /users',
  ]) {
    assert.equal(tiers.isRisky(risky, routing), true, risky)
  }
  for (const safe of ['Add pagination to GET /users', 'Fix the author name in the footer', 'Update the README intro']) {
    assert.equal(tiers.isRisky(safe, routing), false, safe)
  }
  assert.equal(tiers.decideTier('Rename fetchUser to loadUser in api.ts', routing).tier, 'haiku')
  assert.equal(tiers.decideTier('fix a typo in README', routing).tier, 'haiku')
  assert.equal(tiers.decideTier('Renomear a função carregarUsuario', routing).tier, 'haiku')
  const risky = tiers.decideTier('Rename the users column and migrate the data', routing)
  assert.deepEqual([risky.tier, risky.because], ['sonnet', 'risky'])
  assert.equal(tiers.decideTier('Add pagination to GET /users', routing).because, 'default')
})

test('a risky Sonnet pass is sent to Opus under the cheap policy', () => {
  const routing = defaultRouting({ review_policy: 'cheap' })
  const prompt = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nAdd OAuth authentication to /login.'
  const passed = apply(tiers.emptyState('s'), routing, 't1', 'implementer', report('implementer', 'sonnet', 'pass', 'pending', 'done'), prompt)
  assert.ok(passed.message.includes('cc-tiers:reviewer (Opus)'))
  assert.ok(passed.state.tasks['users-pagination'])
})

test('project files can replace the keyword lists', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), {
    tiers: { opus: { reviewKeywords: ['terraform'] }, haiku: { keywords: 'nope' } },
  })
  assert.deepEqual(routing.tiers.opus.reviewKeywords, ['terraform'])
  assert.ok(routing.tiers.haiku.keywords.includes('rename'))
  assert.ok(routing.notes.some((note) => note.includes('haiku.keywords')))
  assert.equal(tiers.isRisky('Add OAuth login', routing), false)
  assert.equal(tiers.isRisky('Bump the Terraform provider', routing), true)
})

test('history matches the task slug from the header and folds accents', () => {
  const history = tiers.noteHaikuFailure(null, { task: 'rename-fetch-user', prompt: 'Rename fetchUser', reason: 'missed callers' })
  assert.equal(tiers.historyMatches('CC_TIERS_TASK: rename-fetch-user\nCC_TIERS_ROLE: worker\nRename x', history), true)
  assert.equal(tiers.historyMatches('CC_TIERS_TASK: other\nUpdate docs', history), false)
  const accented = tiers.noteHaikuFailure(null, { task: 'x', prompt: 'migração configuração usuários', reason: '' })
  assert.equal(tiers.historyMatches('migracao da configuracao', accented), true)
  assert.deepEqual(tiers.tokenize('Migração não'), ['migracao'])
})

test('a stale lower-tier run does not reset an escalated counter', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('s')
  state = apply(state, routing, 'h1', 'worker', report('worker', 'haiku', 'fail', '', 'a')).state
  state = apply(state, routing, 'h2', 'worker', report('worker', 'haiku', 'fail', '', 'b')).state
  assert.equal(state.tasks['users-pagination'].tier, 'sonnet')
  state = apply(state, routing, 's1', 'implementer', report('implementer', 'sonnet', 'fail', '', 'c')).state
  const late = apply(state, routing, 'h3', 'worker', report('worker', 'haiku', 'fail', '', 'd'))
  assert.ok(late.message.includes('already escalated to sonnet'))
  assert.equal(late.state.tasks['users-pagination'].tier, 'sonnet')
  assert.equal(late.state.tasks['users-pagination'].failures.length, 1)
  assert.equal(late.meta.haikuFailure, false)
})

test('checkDelegation refuses model overrides, missing headers, and downgrades', () => {
  const routing = defaultRouting()
  const header = (task, tier, role) => `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\n`
  const state = tiers.emptyState('s')
  assert.equal(tiers.checkDelegation(state, { subagent_type: 'Explore', prompt: 'x', model: 'opus' }, routing).deny, '')
  assert.equal(tiers.checkDelegation(state, { subagent_type: 'other-plugin:worker', prompt: 'x', model: 'opus' }, routing).deny, '')
  assert.ok(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:worker', prompt: header('a', 'haiku', 'worker'), model: 'sonnet' }, routing).deny.includes('do not pass model'))
  assert.ok(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt: 'just do it' }, routing).deny.includes('CC_TIERS_TASK'))
  assert.ok(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:checker', prompt: 'review' }, routing).deny.includes('CC_TIERS_TASK'))

  state.tasks.a = { tier: 'sonnet', failures: [], carried: ['haiku/worker: x'] }
  const down = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:worker', prompt: header('a', 'haiku', 'worker') }, routing)
  assert.ok(down.deny.includes('already escalated to sonnet'))
  assert.equal(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:checker', prompt: header('a', 'haiku', 'checker') }, routing).deny, '')

  state.tasks.b = { tier: 'haiku', failures: ['haiku/worker: first'], carried: [] }
  const up = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt: header('b', 'sonnet', 'implementer') }, routing)
  assert.equal(up.deny, '')
  assert.ok(up.context.includes('moved b from haiku to sonnet'))
  assert.deepEqual(state.tasks.b, { tier: 'sonnet', failures: [], carried: ['haiku/worker: first'] })

  const hint = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:worker', prompt: `${header('c', 'haiku', 'worker')}Rename the login handler` }, routing)
  assert.equal(hint.deny, '')
  assert.ok(hint.context.includes('routing hint'))
})

function hookEnv(dir, extra = {}) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_DATA: path.join(dir, 'data'),
    CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '2',
    CLAUDE_PLUGIN_OPTION_REVIEW_POLICY: 'cheap',
    CLAUDE_PLUGIN_OPTION_LEARN: 'off',
    CC_TIERS_CC_COST: '1',
    CC_TIERS_CC_COST_DATA: path.join(dir, 'cc-cost'),
    HOME: path.join(dir, 'home'),
    ...extra,
  }
  delete env.CLAUDE_PROJECT_DIR
  return env
}

test('the PreToolUse hook denies a model override', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const proc = runHook(
      'before_agent.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        tool_input: { subagent_type: 'cc-tiers:worker', model: 'opus', prompt: 'CC_TIERS_TASK: a\nrename' },
      },
      hookEnv(dir),
    )
    assert.equal(proc.status, 0, proc.stderr)
    const output = JSON.parse(proc.stdout).hookSpecificOutput
    assert.equal(output.hookEventName, 'PreToolUse')
    assert.equal(output.permissionDecision, 'deny')
    assert.ok(output.permissionDecisionReason.includes('do not pass model'))
    const allowed = runHook(
      'before_agent.mjs',
      { session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'look' } },
      hookEnv(dir),
    )
    assert.equal(allowed.stdout, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a background agent is counted at SubagentStop and reported at Stop', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir)
    const prompt = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nAdd pagination.'
    const launch = runHook(
      'after_agent.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'bg1',
        tool_input: { subagent_type: 'cc-tiers:implementer', prompt },
        tool_response: { status: 'async_launched', agentId: 'agent-7', prompt },
      },
      env,
    )
    assert.ok(JSON.parse(launch.stdout).hookSpecificOutput.additionalContext.includes('agent agent-7'))

    const agentTranscript = path.join(dir, 'agent-7.jsonl')
    writeFileSync(
      agentTranscript,
      [
        assistantRow('claude-sonnet-4-5', { input_tokens: 100, output_tokens: 20 }, [{ type: 'text', text: 'a' }], { id: 'x1' }),
        assistantRow('claude-sonnet-4-5', { input_tokens: 100, output_tokens: 20 }, [{ type: 'text', text: 'a' }], { id: 'x1' }),
        assistantRow('claude-sonnet-4-5', { input_tokens: 30 }, [{ type: 'text', text: 'b' }], { id: 'x2' }),
      ].join('\n'),
    )
    const stop = runHook(
      'subagent_stop.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'SubagentStop',
        agent_id: 'agent-7',
        agent_type: 'cc-tiers:implementer',
        agent_transcript_path: agentTranscript,
        last_assistant_message: report('implementer', 'sonnet', 'fail', '', 'cursor off by one'),
      },
      env,
    )
    assert.equal(stop.status, 0, stop.stderr)
    assert.equal(stop.stdout, '')
    const again = runHook('subagent_stop.mjs', { session_id: 'sess-1', hook_event_name: 'SubagentStop', agent_id: 'agent-7', last_assistant_message: 'x' }, env)
    assert.equal(again.stdout, '')

    const end = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false }, env)
    const decision = JSON.parse(end.stdout)
    assert.equal(decision.decision, 'block')
    assert.ok(decision.reason.includes('Retry on sonnet'))
    assert.ok(decision.reason.includes('sonnet 150 fresh tokens'))
    const quiet = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false }, env)
    assert.equal(quiet.stdout, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a ceiling trailer in the transcript is counted at Stop', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0' })
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(
      transcript,
      `${assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: fail\nCC_TIERS_REASON: still red' }], { id: 'm1', uuid: 'u1' })}\n`,
    )
    const payload = { session_id: 'sess-1', hook_event_name: 'Stop', transcript_path: transcript, stop_hook_active: true }
    const first = runHook('stop.mjs', payload, env)
    assert.equal(first.status, 0, first.stderr)
    assert.ok(JSON.parse(first.stdout).systemMessage.includes('opus/orchestrator: still red'))
    assert.equal(runHook('stop.mjs', payload, env).stdout, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parallel hooks do not drop counts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_MAX_ATTEMPTS: '5' })
    const { spawn } = await import('node:child_process')
    const runs = Array.from({ length: 8 }, (_, index) => {
      const task = `task-${index % 2}`
      const raw = event(`p${index}`, 'implementer', report('implementer', 'sonnet', 'fail', '', `r${index}`).replace('users-pagination', task))
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, 'hooks', 'after_agent.mjs')], { env })
        child.on('close', resolve)
        child.stdin.end(JSON.stringify(raw))
      })
    })
    await Promise.all(runs)
    const state = JSON.parse(readFileSync(path.join(dir, 'data', 'session-sess-1.json'), 'utf8'))
    const counted = Object.values(state.tasks).reduce((sum, task) => sum + task.failures.length + task.carried.length, 0)
    assert.equal(counted, 8)
    assert.equal(readdirSync(path.join(dir, 'data')).some((name) => name.endsWith('.lock') || name.endsWith('.tmp')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the route helper prints the heuristic tier', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const proc = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'route.mjs')], {
      input: 'Add a database migration for invoices',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '', CLAUDE_PROJECT_DIR: dir, HOME: path.join(dir, 'home') },
    })
    assert.equal(proc.status, 0, proc.stderr)
    const decision = JSON.parse(proc.stdout)
    assert.equal(decision.tier, 'sonnet')
    assert.equal(decision.risky, true)
    assert.equal(decision.review, 'reviewer')
    assert.equal(tiers.pluginRoot({}), ROOT)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
