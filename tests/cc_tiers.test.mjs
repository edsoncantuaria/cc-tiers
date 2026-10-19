import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
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
  for (const gone of ['hooks/cc_tiers.py', 'hooks/session_start.py', 'hooks/after_agent.py', 'tests/test_cc_tiers.py']) {
    assert.equal(existsSync(path.join(ROOT, gone)), false, gone)
  }
})

test('manifest declares the 0.2.0 knobs', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'cc-tiers')
  assert.equal(manifest.version, '0.2.0')
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

test('hooks run on Node and the shell entrypoints are executable', () => {
  const hooks = JSON.parse(readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'))
  const events = hooks.hooks
  assert.ok(events.SessionStart)
  assert.equal(events.PostToolUse[0].matcher, 'Agent')
  assert.equal(events.PostToolUseFailure[0].matcher, 'Agent')
  for (const event of Object.values(events)) {
    const command = event[0].hooks[0].command
    assert.ok(command.includes('${CLAUDE_PLUGIN_ROOT}'))
    assert.ok(command.includes('"'))
    assert.equal(command.includes('python'), false)
  }
  for (const script of ['session-start.sh', 'after-agent.sh']) {
    const file = path.join(ROOT, 'hooks', script)
    assert.ok(statSync(file).mode & 0o100, `${script} is not executable`)
    const text = readFileSync(file, 'utf8')
    assert.ok(text.includes('node '))
    assert.equal(text.includes('python'), false)
  }
})

test('readmes stay in sync on the 0.2.0 behavior', () => {
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

test('transcript usage is attributed per task and tier', () => {
  const transcript = [
    JSON.stringify({ type: 'user', message: { content: 'CC_TIERS_TASK: rename-fetch-user\nrename fetchUser' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 800, cache_creation_input_tokens: 10 },
      },
    }),
    JSON.stringify({ type: 'user', message: { content: 'CC_TIERS_TASK: users-pagination\nadd pagination' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1000 },
      },
    }),
  ].join('\n')
  const spend = tiers.attributeTranscript(transcript)
  assert.equal(spend['rename-fetch-user'].haiku, 150)
  assert.equal(spend['users-pagination'].sonnet, 2500)
  assert.equal(spend['users-pagination'].haiku || 0, 0)
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

test('the history file is gitignored when it is first written', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    mkdirSync(path.join(dir, '.git'))
    const wrote = tiers.ensureHistoryGitignore(dir)
    assert.equal(wrote, true)
    assert.ok(readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.claude/cc-tiers-history.json'))
    assert.equal(tiers.ensureHistoryGitignore(dir), false)
    const file = tiers.historyPath(dir)
    tiers.saveHistory(file, tiers.noteHaikuFailure(null, { task: 'fix-typo', prompt: 'fix a typo', reason: 'wrong file', now: '2026-10-19T00:00:00.000Z' }))
    assert.equal(tiers.loadHistory(file).entries[0].kind, 'fix-typo')
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
    assert.ok(readFileSync(path.join(project, '.gitignore'), 'utf8').includes('.claude/cc-tiers-history.json'))
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
