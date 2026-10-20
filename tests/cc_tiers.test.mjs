import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
    'hooks/report.mjs',
    'commands/report.md',
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
    'agents/architect.md',
    'agents/planner.md',
    'agents/dispatcher.md',
  ]) {
    assert.ok(existsSync(path.join(ROOT, relative)), relative)
  }
  for (const gone of ['hooks/session-start.sh', 'hooks/after-agent.sh', 'hooks/cc_tiers.py', 'hooks/session_start.py', 'hooks/after_agent.py', 'tests/test_cc_tiers.py']) {
    assert.equal(existsSync(path.join(ROOT, gone)), false, gone)
  }
})

test('manifest declares the 0.5.0 knobs', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(manifest.name, 'cc-tiers')
  assert.equal(manifest.version, '0.6.0')
  assert.equal(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, manifest.version)
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
    ['effort_ladder', 'string'],
    ['classifier', 'string'],
    ['light_path', 'string'],
    ['show_cost', 'string'],
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
  assert.equal(review.default, 'risky')
  assert.equal(manifest.userConfig.show_cost.default, 'off')
  assert.deepEqual(manifest.userConfig.learn.options, ['on', 'off'])
  assert.equal(manifest.userConfig.learn.default, 'on')
  assert.equal(manifest.userConfig.budget_5h.default, 80)
  assert.equal(manifest.userConfig.budget_7d.default, 80)
  assert.equal(manifest.userConfig.budget_5h.min, 1)
  assert.equal(manifest.userConfig.budget_7d.max, 100)
  assert.deepEqual(manifest.userConfig.effort_ladder.options, ['on', 'off'])
  assert.equal(manifest.userConfig.effort_ladder.default, 'on')
  assert.deepEqual(manifest.userConfig.classifier.options, ['haiku', 'local'])
  assert.equal(manifest.userConfig.classifier.default, 'haiku')
  assert.deepEqual(manifest.userConfig.light_path.options, ['inline', 'delegate', 'off'])
  assert.equal(manifest.userConfig.light_path.default, 'inline')
  assert.equal(readdirSync(ROOT).includes('CLAUDE.md'), false)
})

test('marketplace and settings stay pointed at this plugin', () => {
  const market = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'))
  assert.equal(market.name, 'cc-tiers')
  assert.ok(market.owner.name)
  assert.equal(market.plugins[0].name, 'cc-tiers')
  assert.equal(market.plugins[0].source, './')
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(market.description, manifest.description)
  const settings = JSON.parse(readFileSync(path.join(ROOT, 'settings.json'), 'utf8'))
  assert.equal(settings.agent, 'orchestrator')
  assert.deepEqual(Object.keys(settings), ['agent'])
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes('0.2.0'))
  assert.ok(changelog.includes('0.3.0'))
  assert.ok(changelog.includes('0.4.0'))
  assert.ok(changelog.includes('0.5.0'))
  assert.ok(changelog.includes('0.5.1'))
  assert.ok(changelog.includes('0.6.0'))
  assert.ok(changelog.includes('cc-cost'))
})

test('agents pin family aliases, including the Sonnet checker', () => {
  const expected = {
    orchestrator: 'opus',
    reviewer: 'opus',
    checker: 'sonnet',
    implementer: 'sonnet',
    worker: 'haiku',
    architect: 'opus',
    planner: 'opus',
    dispatcher: 'sonnet',
    researcher: 'sonnet',
  }
  const efforts = { worker: 'low', implementer: 'high', architect: 'high', planner: 'high', checker: 'medium', reviewer: 'high', researcher: 'medium' }
  for (const [name, model] of Object.entries(expected)) {
    const fields = frontmatter(path.join(ROOT, 'agents', `${name}.md`))
    assert.equal(fields.name, name)
    assert.ok(fields.description)
    assert.equal(fields.model, model)
    assert.ok(MODELS.has(fields.model))
    assert.equal(fields.name.includes(':'), false)
    assert.ok(tiers.EFFORTS.includes(fields.effort), `${name} effort`)
    if (name in efforts) assert.equal(fields.effort, efforts[name], `${name} effort matches AGENT_EFFORT`)
  }
  assert.deepEqual(tiers.AGENT_EFFORT, efforts)
  assert.match(frontmatter(path.join(ROOT, 'agents', 'planner.md')).tools, /^Read, Grep, Glob, Bash$/)
  const researcher = frontmatter(path.join(ROOT, 'agents', 'researcher.md'))
  assert.match(researcher.tools, /^Read, Grep, Glob, Bash, WebSearch, WebFetch$/)
  assert.equal(researcher.maxTurns, '25')
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    for (const needle of ['cc-tiers:researcher', 'CC_TIERS_RESEARCH_BEGIN', 'CC_TIERS_RESEARCH: none - ', 'into the `cc-tiers:reviewer` or `cc-tiers:checker` prompt', 'reuses the research']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
    assert.ok(text.includes('|reviewer|researcher\n'), `${file} header lists the researcher role`)
  }
  const brief = readFileSync(path.join(ROOT, 'agents', 'researcher.md'), 'utf8')
  for (const needle of ['Version and docs:', 'In the repo:', 'Outside the repo:', 'under about 30 lines']) assert.ok(brief.includes(needle), `researcher mentions ${needle}`)
  assert.equal(brief.includes('CC_TIERS_COVERS: <slugs'), false)
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) {
    assert.ok(readFileSync(path.join(ROOT, file), 'utf8').includes('the brief names when the prompt carries a research brief'), `${file} treats the brief as optional`)
  }
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  for (const tier of tiers.TIERS) assert.equal(defaults.effort[tier][0], efforts[tiers.IMPLEMENTERS[tier]] || 'high')
})

test('prompts specify, ask, and hand the criteria to writers and reviewers', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    for (const needle of ['CC_TIERS_SPEC_BEGIN', 'CC_TIERS_SPEC: none - ', 'AskUserQuestion', 'Assumed:', 'at most 3', '${user_config.specify}']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
    assert.ok(text.indexOf('Specify\n') > text.indexOf('Research\n'), `${file} specifies after research`)
  }
  for (const file of ['agents/implementer.md', 'agents/architect.md']) {
    assert.ok(readFileSync(path.join(ROOT, file), 'utf8').includes('CC_TIERS_SPEC_BEGIN'), `${file} reads the spec block`)
  }
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) {
    assert.ok(readFileSync(path.join(ROOT, file), 'utf8').includes('acceptance criteria'), `${file} judges the criteria`)
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
  for (const command of ['route.md', 'escalate.md', 'report.md']) {
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
  const classifier = events.PreToolUse[1]
  assert.equal(classifier.matcher, 'Agent')
  assert.equal(classifier.hooks[0].type, 'prompt')
  assert.equal(classifier.hooks[0].if, 'Agent(cc-tiers:worker)')
  assert.equal(classifier.hooks[0].continueOnBlock, true)
  assert.ok(classifier.hooks[0].prompt.includes('$ARGUMENTS'))
  assert.ok(classifier.hooks[0].prompt.includes('CC_TIERS_CLASSIFY: skip'))
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
      'npm test',
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
  assert.equal(routing.reviewPolicy, 'risky')
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
    specify: 'off',
    verify: 'off',
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
    verify: 'off',
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
    verify: 'off',
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
  const routing = defaultRouting({ review_policy: 'cheap', verify: 'off' })
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
  const routing = defaultRouting({ research: 'off', specify: 'off' })
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

const HEADER = (task, tier, role) => `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\n`

test('the effort ladder raises a retry before the task changes model', () => {
  const routing = defaultRouting({ research: 'off', specify: 'off' })
  assert.deepEqual(routing.effort.ladders, { haiku: ['low', 'medium'], sonnet: ['high', 'xhigh'], opus: ['high', 'xhigh'] })
  assert.equal(tiers.effortFor(routing, 'sonnet', 0), 'high')
  assert.equal(tiers.effortFor(routing, 'sonnet', 1), 'xhigh')
  assert.equal(tiers.effortFor(routing, 'sonnet', 9), 'xhigh')
  assert.equal(tiers.effortFor(routing, 'sonnet', 2, { conserve: true }), 'high')
  assert.equal(tiers.effortFor(routing, 'opus', 0, { conserve: true }), 'high')
  assert.equal(tiers.effortFor(routing, 'haiku', 0, { boost: 1 }), 'medium')

  let state = tiers.emptyState('s')
  const first = apply(state, routing, 'e1', 'implementer', report('implementer', 'sonnet', 'fail', '', 'cursor off by one'))
  assert.ok(first.message.includes('Retry on sonnet (cc-tiers:implementer) at effort xhigh'))
  state = first.state
  const prompt = `${HEADER('users-pagination', 'sonnet', 'implementer')}Add pagination to GET /users.`
  const retry = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt, description: 'retry' }, routing)
  assert.equal(retry.deny, '')
  assert.deepEqual(retry.input, { subagent_type: 'cc-tiers:implementer', prompt, description: 'retry', effort: 'xhigh' })
  assert.ok(retry.context.includes('cc-tiers set effort xhigh'))
  const asked = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt, effort: 'max' }, routing)
  assert.equal(asked.input.effort, 'xhigh')
  const lower = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt, effort: 'low' }, routing)
  assert.equal(lower.input.effort, 'xhigh')
  assert.equal(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt, effort: 'xhigh' }, routing).input, null)

  const fresh = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  assert.equal(fresh.input, null)
  const risky = tiers.checkDelegation(
    tiers.emptyState('s'),
    { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('login', 'sonnet', 'implementer')}Add OAuth login.` },
    routing,
  )
  assert.equal(risky.input.effort, 'xhigh')
  assert.ok(risky.context.includes('review keyword'))

  const second = apply(state, routing, 'e2', 'implementer', report('implementer', 'sonnet', 'fail', '', 'still wrong'))
  assert.ok(second.message.includes('The next tier is opus (the Opus ceiling'))
  assert.ok(second.message.includes('cc-tiers:architect'))
  assert.equal(second.meta.sonnetEscalated, true)
  const ceiling = tiers.checkDelegation(second.state, { subagent_type: 'cc-tiers:architect', prompt: HEADER('users-pagination', 'opus', 'architect') }, routing)
  assert.equal(ceiling.input, null)
  const down = tiers.checkDelegation(second.state, { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  assert.ok(down.deny.includes('cc-tiers:architect'))
})

test('the effort ladder can be turned off or replaced by the project', () => {
  const off = defaultRouting({ effort_ladder: 'off' })
  assert.equal(off.effort.on, false)
  assert.equal(tiers.effortFor(off, 'sonnet', 1), null)
  const state = tiers.emptyState('s')
  state.tasks.a = { tier: 'sonnet', failures: ['sonnet/implementer: x'], carried: [] }
  const call = { subagent_type: 'cc-tiers:implementer', prompt: HEADER('a', 'sonnet', 'implementer') }
  assert.equal(tiers.checkDelegation(state, call, off).input, null)
  const retry = apply(tiers.emptyState('s'), off, 'o1', 'implementer', report('implementer', 'sonnet', 'fail'))
  assert.equal(retry.message.includes('at effort'), false)

  const project = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')), {
    effort: { sonnet: ['high', 'max'], haiku: ['high', 'low'], conserveCap: 'medium' },
  })
  assert.deepEqual(project.effort.ladders.sonnet, ['high', 'max'])
  assert.deepEqual(project.effort.ladders.haiku, ['low', 'medium'])
  assert.ok(project.notes.some((note) => note.includes('effort.haiku')))
  assert.equal(tiers.effortFor(project, 'sonnet', 1, { conserve: true }), 'high')
  const text = tiers.formatSessionContext(defaultRouting(), 'not present', { budget: { conserve: true, hits: ['5h 90%'] } })
  assert.ok(text.includes('Effort ladder: on (haiku low -> medium, sonnet high -> xhigh, opus high -> xhigh)'))
  assert.ok(text.includes('effort stops at high'))
  assert.ok(text.includes('Classifier: haiku'))
})

test('the complexity score keeps multi-step work off Haiku', () => {
  const routing = defaultRouting()
  assert.deepEqual(tiers.assessComplexity('Rename fetchUser to loadUser in api.ts', routing).score, 0)
  const steps = 'Rename fetchUser to loadUser:\n- update api.ts\n- update client.ts\n- update server.ts'
  const assessed = tiers.assessComplexity(steps, routing)
  assert.equal(assessed.complex, true)
  assert.ok(assessed.signals.some((signal) => signal.startsWith('multi-step')))
  assert.deepEqual([tiers.decideTier(steps, routing).tier, tiers.decideTier(steps, routing).because], ['sonnet', 'complex'])
  const design = tiers.decideTier('Rename the helpers and refactor the whole codebase around them', routing)
  assert.equal(design.because, 'complex')
  assert.equal(tiers.decideTier('Renomear e depois investigar o vazamento de memória', routing).tier, 'sonnet')
  const hint = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:worker', prompt: `${HEADER('r', 'haiku', 'worker')}${steps}` }, routing)
  assert.ok(hint.context.includes('complexity score'))
})

test('the classifier header is refused unless the classifier is local', () => {
  const prompt = `${HEADER('t', 'haiku', 'worker')}CC_TIERS_CLASSIFY: skip\nfix a typo in README`
  const haiku = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:worker', prompt }, defaultRouting())
  assert.ok(haiku.deny.includes('CC_TIERS_CLASSIFY'))
  const local = defaultRouting({ classifier: 'local' })
  assert.equal(local.classifier, 'local')
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:worker', prompt }, local).deny, '')
  assert.equal(defaultRouting({ classifier: 'gpt' }).classifier, 'haiku')
  assert.ok(tiers.classifierLine(local).includes('CC_TIERS_CLASSIFY: skip'))
})

test('an API or network error is not counted as a failure', () => {
  const routing = defaultRouting()
  const raw = event('x1', 'implementer', '', HEADER('users-pagination', 'sonnet', 'implementer'), true)
  raw.error = 'API Error: 529 overloaded_error'
  const applied = tiers.applyEvent(tiers.emptyState('s'), tiers.normalizeEvent(raw), routing)
  assert.ok(applied.message.includes('did not count it as a failure'))
  assert.equal(applied.state.tasks['users-pagination'], undefined)
  assert.equal(tiers.isInfraError('Rate limit reached'), true)
  assert.equal(tiers.isInfraError('agent crashed'), false)
  const crash = tiers.applyEvent(tiers.emptyState('s'), tiers.normalizeEvent(event('x2', 'implementer', '', HEADER('users-pagination', 'sonnet', 'implementer'), true)), routing)
  assert.equal(crash.state.tasks['users-pagination'].failures.length, 1)
})

test('the planner is orchestration: no header, no count, spend to (orchestration)', () => {
  const routing = defaultRouting()
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:planner', prompt: 'plan this' }, routing).deny, '')
  assert.ok(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:planner', prompt: 'x', model: 'sonnet' }, routing).deny)
  const state = tiers.emptyState('s')
  const ctx = { routing, ccCost: true, projectDir: '' }
  const planned = tiers.normalizeEvent(event('p1', 'planner', 'Slug: a, Tier: sonnet', 'plan this'))
  assert.equal(tiers.processReport(ctx, state, planned, { key: 'p1', tier: 'opus', tokens: 900 }), '')
  assert.deepEqual(state.spend['(orchestration)'], { haiku: 0, sonnet: 0, opus: 900 })
  assert.deepEqual(state.tasks, {})
})

test('a task that escalated past Sonnet starts similar work at the top of the Sonnet ladder', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const routing = defaultRouting({ max_attempts: 1, research: 'off', specify: 'off' })
    const ctx = { routing, ccCost: false, projectDir: dir }
    const state = tiers.emptyState('s')
    const prompt = `${HEADER('cursor-pagination', 'sonnet', 'implementer')}Add cursor pagination to the orders listing`
    const failed = tiers.normalizeEvent(event('s1', 'implementer', report('implementer', 'sonnet', 'fail').replace('users-pagination', 'cursor-pagination'), prompt))
    const message = tiers.processReport(ctx, state, failed)
    assert.ok(message.includes('escalated past Sonnet'))
    const history = tiers.loadHistory(tiers.historyPath(dir))
    assert.equal(history.entries[0].tier, 'sonnet')
    assert.equal(tiers.historyMatches(prompt, history, 'sonnet'), true)
    assert.equal(tiers.historyMatches(prompt, history, 'haiku'), false)
    const similar = `${HEADER('orders-cursor', 'sonnet', 'implementer')}Add cursor pagination to the orders export`
    const call = tiers.checkDelegation(tiers.emptyState('s2'), { subagent_type: 'cc-tiers:implementer', prompt: similar }, routing, { history })
    assert.equal(call.input.effort, 'xhigh')
    assert.ok(call.context.includes('escalated past Sonnet'))
    assert.equal(tiers.decideTier(similar, routing, { history }).effort, 'xhigh')
    assert.ok(tiers.guidance(routing, null, history).some((line) => line.startsWith('Sonnet escalation history')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the light path flags a one-task trivial request only', () => {
  const routing = defaultRouting()
  assert.ok(tiers.lightHint('fix a typo in README', routing).includes('Do it yourself in this session'))
  const delegate = defaultRouting({ light_path: 'delegate' })
  assert.ok(tiers.lightHint('where is fetchUser defined?', delegate).includes('no checker pass'))
  assert.equal(defaultRouting({ light_path: 'on' }).light, 'inline')
  assert.equal(defaultRouting({ light_path: 'weird' }).light, 'inline')
  assert.equal(tiers.lightHint('Add pagination to GET /users', routing), '')
  assert.equal(tiers.lightHint('Rename fetchUser and then update the docs', routing), '')
  assert.equal(tiers.lightHint('Rename the login handler', routing), '')
  assert.equal(tiers.lightHint('/cc-tiers:route fix a typo', routing), '')
  assert.equal(tiers.lightHint('fix a typo in README', defaultRouting({ light_path: 'off' })), '')
})

test('the hooks set effort on the call and add the light path on prompt submit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_RESEARCH: 'off', CLAUDE_PLUGIN_OPTION_SPECIFY: 'off' })
    const prompt = `${HEADER('users-pagination', 'sonnet', 'implementer')}Add pagination.`
    runHook('after_agent.mjs', event('h1', 'implementer', report('implementer', 'sonnet', 'fail'), prompt), env)
    const proc = runHook(
      'before_agent.mjs',
      { session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt } },
      env,
    )
    assert.equal(proc.status, 0, proc.stderr)
    const output = JSON.parse(proc.stdout).hookSpecificOutput
    assert.equal(output.permissionDecision, 'allow')
    assert.deepEqual(output.updatedInput, { subagent_type: 'cc-tiers:implementer', prompt, effort: 'xhigh' })

    const submit = runHook('stop.mjs', { session_id: 'sess-2', hook_event_name: 'UserPromptSubmit', prompt: 'fix a typo in README' }, env)
    assert.ok(JSON.parse(submit.stdout).hookSpecificOutput.additionalContext.includes('cc-tiers light path'))
    const plain = runHook('stop.mjs', { session_id: 'sess-2', hook_event_name: 'UserPromptSubmit', prompt: 'Add pagination to GET /users' }, env)
    assert.equal(plain.stdout, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cost follows the model price table, and the Opus comparison uses current Opus rates', () => {
  const routing = defaultRouting()
  assert.equal(tiers.normalizeModel('us.anthropic.claude-sonnet-5-5-20260301[1m]'), 'claude-sonnet-5-5')
  assert.equal(tiers.priceFor('claude-opus-5-5', routing).input, 4)
  assert.equal(tiers.priceFor('claude-opus-5', routing).input, 5)
  assert.equal(tiers.priceFor('claude-haiku-4-5-20251001', routing).input, 1)
  assert.equal(tiers.priceFor('claude-sonnet-4-5', routing).model, 'claude-sonnet-5-5')
  assert.equal(tiers.priceFor('gpt-5', routing), null)
  const usage = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }
  assert.equal(tiers.usageDollars(usage, tiers.priceFor('claude-sonnet-5-5', routing)).toFixed(2), '14.70')
  const split = { input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }
  assert.equal(tiers.usageDollars(split, tiers.priceFor('claude-opus-5-5', routing)), 13)
  const cost = tiers.usageCost(usage, 'claude-haiku-5-5', routing)
  assert.equal(cost.tier, 'haiku')
  assert.ok(cost.opus > cost.usd * 30)
  const line = tiers.formatTaskCost('t', { haiku: 0.01, sonnet: 0.02, opus: 0, opusRate: 0.1 })
  assert.ok(line.includes('about $0.030 at API list prices (haiku $0.010, sonnet $0.020)'))
  assert.ok(line.includes('70% less'))
})

test('task cost is recorded without cc-cost, and the log feeds the report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_SHOW_COST: 'on', CLAUDE_PLUGIN_OPTION_RESEARCH: 'off', CLAUDE_PLUGIN_OPTION_SPECIFY: 'off', CLAUDE_PLUGIN_OPTION_VERIFY: 'off' })
    const prompt = `${HEADER('users-pagination', 'sonnet', 'implementer')}Add pagination.`
    const failed = event('c1', 'implementer', report('implementer', 'sonnet', 'fail'), prompt)
    failed.tool_response.usage = { input_tokens: 1000, output_tokens: 500, model: 'claude-sonnet-5-5' }
    const first = runHook('after_agent.mjs', failed, env)
    const text = JSON.parse(first.stdout).hookSpecificOutput.additionalContext
    assert.ok(text.includes('cc-tiers cost for users-pagination: about $0.0070'))
    assert.equal(text.includes('fresh tokens'), false)
    runHook(
      'before_agent.mjs',
      { session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'cc-tiers:implementer', prompt } },
      env,
    )
    const passed = event('c2', 'implementer', report('implementer', 'sonnet', 'pass', 'skip', 'green'), prompt)
    passed.tool_response.usage = { input_tokens: 1000, output_tokens: 500, model: 'claude-sonnet-5-5' }
    runHook('after_agent.mjs', passed, env)

    const state = JSON.parse(readFileSync(path.join(dir, 'data', 'latest.json'), 'utf8'))
    assert.deepEqual(state.log['users-pagination'].tiers, ['sonnet'])
    assert.equal(state.log['users-pagination'].attempts, 2)
    assert.equal(state.log['users-pagination'].failures, 1)
    assert.equal(state.log['users-pagination'].status, 'done')
    assert.equal(state.log['users-pagination'].effort.sonnet, 'xhigh')
    assert.ok(Math.abs(state.cost['users-pagination'].sonnet - 0.014) < 1e-9)

    const proc = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'report.mjs'), path.join(dir, 'data')], { encoding: 'utf8' })
    assert.equal(proc.status, 0, proc.stderr)
    assert.ok(proc.stdout.includes('| users-pagination | sonnet | 2 | 0 | sonnet xhigh | — | done on sonnet | $0.014 |'))
    assert.ok(proc.stdout.includes('% less'))
    const empty = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'report.mjs'), path.join(dir, 'nothing')], { encoding: 'utf8' })
    assert.equal(empty.stdout, 'cc-tiers has no session data yet.\n')
    const off = runHook('after_agent.mjs', { ...failed, tool_use_id: 'c3' }, { ...env, CLAUDE_PLUGIN_OPTION_SHOW_COST: 'off' })
    assert.equal(JSON.parse(off.stdout).hookSpecificOutput.additionalContext.includes('cc-tiers cost'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('large files named in a task keep it off Haiku', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    writeFileSync(path.join(dir, 'big.ts'), 'x'.repeat(500000))
    writeFileSync(path.join(dir, 'small.ts'), 'x')
    const routing = defaultRouting()
    const big = tiers.decideTier('Rename fetchUser in big.ts', routing, { projectDir: dir })
    assert.deepEqual([big.tier, big.because], ['sonnet', 'complex'])
    assert.ok(tiers.assessComplexity('Rename fetchUser in big.ts', routing, { projectDir: dir }).signals[0].startsWith('large files'))
    assert.equal(tiers.decideTier('Rename fetchUser in small.ts', routing, { projectDir: dir }).tier, 'haiku')
    assert.equal(tiers.decideTier('Rename fetchUser in big.ts', routing).tier, 'haiku')
    assert.equal(tiers.assessComplexity('Rename x in ../big.ts', routing, { projectDir: path.join(dir, 'sub') }).score, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a dispatcher doing a task itself is counted from its trailer and escalates to the architect', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0' })
    const transcript = path.join(dir, 'main.jsonl')
    const trailer = (status, reason) =>
      `CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: dispatcher\nCC_TIERS_STATUS: ${status}\nCC_TIERS_REASON: ${reason}`
    const open = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: dispatcher\nWorking on it.'
    writeFileSync(
      transcript,
      [
        assistantRow('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, [{ type: 'text', text: open }], { id: 'd0', uuid: 'v0' }),
        assistantRow('claude-sonnet-5-5', { input_tokens: 10, output_tokens: 10 }, [{ type: 'text', text: trailer('fail', 'cursor test red') }], { id: 'd1', uuid: 'v1' }),
        assistantRow('claude-sonnet-5-5', { input_tokens: 10, output_tokens: 10 }, [{ type: 'text', text: trailer('fail', 'still red') }], { id: 'd2', uuid: 'v2' }),
      ].join('\n') + '\n',
    )
    const proc = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', transcript_path: transcript, stop_hook_active: false }, env)
    assert.equal(proc.status, 0, proc.stderr)
    const reason = JSON.parse(proc.stdout).reason
    assert.ok(reason.includes('Retry on sonnet'))
    assert.ok(reason.includes('The next tier is opus'))
    assert.ok(reason.includes('cc-tiers:architect'))
    const state = JSON.parse(readFileSync(path.join(dir, 'data', 'latest.json'), 'utf8'))
    assert.equal(state.tasks['users-pagination'].tier, 'opus')
    assert.equal(state.log['users-pagination'].attempts, 2)
    assert.ok(state.cost['users-pagination'].sonnet > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the first table puts quality first and tokens last, with no cost column', async () => {
  const bench = path.join(ROOT, 'bench')
  for (const gone of ['tasks.json', 'tasks-calc.json', 'tasks-trap.json', 'fixture', 'fixture-calc', 'fixture-trap']) {
    assert.equal(existsSync(path.join(bench, gone)), false, gone)
  }
  const { table, label } = await import(pathToFileURL(path.join(bench, 'run.mjs')).href)
  assert.equal(label('cc-tiers-light@0.5'), 'cc-tiers light (Sonnet dispatcher) 0.5')
  const rows = [
    { config: 'opus', task: 'typo', kind: 'trivial', resolved: true, f2p: true, p2p: true, freshTokens: 12000, reuseChecked: true, recreated: false },
    { config: 'opus', task: 'typo', kind: 'trivial', resolved: false, f2p: true, p2p: false, freshTokens: 8000, reuseChecked: true, recreated: true },
  ]
  const text = table(rows)
  assert.ok(text.startsWith('| Configuration | pass@1 | Δ pass@1 vs Opus only | pass^k | Resolved | Broke something | Recreated existing code | Tokens per resolved task |\n'), text)
  assert.ok(text.includes('| Opus only | 50% | — | 0% (k=2) | 1/2 | 1 | 1 | 20.0k |'))
  assert.ok(text.includes('| `typo` (trivial) | 🟡 1/2 |'))
  assert.equal(text.includes('$'), false)
  assert.equal(text.includes('Δ tokens'), false)
})

test('pass-to-pass uses the before-form of each test file', async () => {
  const bench = path.join(ROOT, 'bench')
  const { grade, passingTests } = await import(pathToFileURL(path.join(bench, 'run.mjs')).href)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-grade-'))
  const checks = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-checks-'))
  try {
    const file = (name) => path.join(dir, name)
    const unit = (name, value) => `import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { ${name} } from '../src/${name}.js'\ntest('${name}', () => assert.equal(${name}(), ${value}))\n`
    mkdirSync(file('src'))
    mkdirSync(file('test'))
    writeFileSync(file('src/a.js'), 'export const a = () => 1\n')
    writeFileSync(file('src/b.js'), 'export const b = () => 2\n')
    writeFileSync(file('test/a.test.mjs'), unit('a', 1))
    writeFileSync(file('test/b.test.mjs'), unit('b', 2))
    writeFileSync(file('test/red.test.mjs'), "import { test } from 'node:test'\ntest('red', () => { throw new Error('red') })\n")
    // The hidden check: one reuse test and one behaviour test that fails on the untouched tree.
    const check = [
      "import assert from 'node:assert/strict'",
      "import { readFileSync } from 'node:fs'",
      "import path from 'node:path'",
      "import { test } from 'node:test'",
      "import { pathToFileURL } from 'node:url'",
      "test('reuse: b is not copied into a', () => assert.doesNotMatch(readFileSync('src/a.js', 'utf8'), /copy of b/))",
      "test('b doubles', async () => assert.equal((await import(pathToFileURL(path.resolve('src/b.js')).href)).b(), 4))",
      '',
    ].join('\n')
    writeFileSync(path.join(checks, 'double.test.mjs'), check)
    writeFileSync(path.join(checks, 'plain.test.mjs'), check.replace("'reuse: b is not copied into a'", "'b is not copied into a'"))
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const before = passingTests(dir)
    assert.deepEqual([...before.keys()].sort(), ['test/a.test.mjs', 'test/b.test.mjs'])
    const trivial = "import { test } from 'node:test'\ntest('ok', () => {})\n"
    writeFileSync(file('test/a.test.mjs'), trivial)
    writeFileSync(file('src/a.js'), 'export const a = () => 0\n')
    const broken = grade(dir, { id: 'double' }, '', checks, before)
    assert.equal(broken.f2p, false)
    assert.equal(broken.p2p, false)
    assert.equal(broken.resolved, false)
    assert.equal(broken.ownTests, false)
    assert.deepEqual(broken.regressions, ['test/a.test.mjs'])
    assert.equal(broken.reuseChecked, true)
    assert.equal(broken.recreated, false, 'only a failing reuse: test counts')
    assert.equal(readFileSync(file('test/a.test.mjs'), 'utf8'), trivial)
    const changed = grade(dir, { id: 'double', changesTests: ['test/a.test.mjs'] }, '', checks, before)
    assert.equal(changed.p2p, true)
    assert.deepEqual(changed.regressions, [])

    writeFileSync(file('src/a.js'), '// copy of b\nexport const a = () => 1\n')
    rmSync(file('test/b.test.mjs'))
    writeFileSync(file('src/b.js'), 'export const b = () => 4\n')
    const deleted = grade(dir, { id: 'double' }, '', checks, before)
    assert.equal(deleted.f2p, false)
    assert.equal(deleted.p2p, false)
    assert.deepEqual(deleted.regressions, ['test/b.test.mjs'])
    assert.equal(existsSync(file('test/b.test.mjs')), false)
    assert.equal(deleted.recreated, true)
    const plain = grade(dir, { id: 'plain' }, '', checks, before)
    assert.equal(plain.reuseChecked, false)
    assert.equal(plain.recreated, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(checks, { recursive: true, force: true })
  }
})

test('failing reuse: tests are read from both test reporters', async () => {
  const { failedTests } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const spec = [
    '✔ fine (1.2ms)',
    '✖ reuse: tokens are signed with the existing helper (3.1ms)',
    '✖ failing tests:',
    '',
    'test at .bench-check/login.test.mjs:62:1',
    '✖ reuse: tokens are signed with the existing helper (3.1ms)',
    '  AssertionError [ERR_ASSERTION]: src/jwt.js signs on its own',
    '✖ it works (12ms)',
  ].join('\n')
  assert.deepEqual(failedTests(spec), ['reuse: tokens are signed with the existing helper', 'it works'])
  const tap = 'TAP version 13\nok 1 - fine\nnot ok 2 - reuse: no copy\n  ---\nnot ok 3 - it works\n'
  assert.deepEqual(failedTests(tap), ['reuse: no copy', 'it works'])
})

test('quality metrics: pass@1, pass^k, regressions, recreated code, tokens', async () => {
  const { metrics, table } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const row = (config, task, f2p, p2p, freshTokens, recreated) => ({
    config, task, kind: 'normal', f2p, p2p, resolved: f2p && p2p, freshTokens, ...(recreated != null && { reuseChecked: true, recreated }),
  })
  const rows = [
    row('opus', 'a', true, true, 20000),
    row('opus', 'a', true, true, 20000),
    row('opus', 'b', true, true, 20000),
    row('opus', 'b', false, true, 30000),
    row('cc-tiers', 'a', true, true, 30000, false),
    row('cc-tiers', 'a', true, true, 30000, false),
    row('cc-tiers', 'b', true, false, 40000, true),
    row('cc-tiers', 'b', true, true, 35000),
    row('sonnet', 'a', true, true, 27600),
    row('sonnet', 'a', true, true, 27600),
    row('sonnet', 'b', true, true, 27600),
    row('sonnet', 'b', true, true, 27600),
  ]
  assert.deepEqual(metrics(rows.filter((r) => r.config === 'opus')), { pass1: 0.75, passK: 0.5, k: 2, resolved: 3, runs: 4, regressions: 0, recreated: null, tokensPerResolved: 30000 })
  assert.deepEqual(metrics(rows.filter((r) => r.config === 'cc-tiers')), { pass1: 0.75, passK: 0.5, k: 2, resolved: 3, runs: 4, regressions: 1, recreated: 1, tokensPerResolved: 45000 })
  const text = table(rows)
  assert.ok(text.includes('| Opus only | 75% | — | 50% (k=2) | 3/4 | 0 | — | 30.0k |'))
  assert.ok(text.includes('| cc-tiers (Opus orchestrator) | 75% | 0 pp | 50% (k=2) | 3/4 | 1 | 1 | 45.0k |'))
  assert.ok(text.includes('| Sonnet only | 100% | +25 pp | 100% (k=2) | 4/4 | 0 | — | 27.6k |'))
  assert.ok(text.includes('| `b` (normal) | 🟡 1/2 | 🟡 1/2 | ✅ 2/2 |'))
  assert.equal(text.includes('$'), false)
  assert.ok(table(rows.filter((r) => r.config !== 'opus')).includes('| cc-tiers (Opus orchestrator) | 75% | — | 50% (k=2) | 3/4 | 1 | 1 | 45.0k |'))
  const clean = rows.filter((r) => r.config === 'cc-tiers').map((r) => ({ ...r, reuseChecked: true, recreated: false }))
  assert.equal(metrics(clean).recreated, 0)
})

test('the tables show where cc-tiers and Sonnet differ from Opus only', async () => {
  const { table, differenceTable } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const row = (config, task, resolved) => ({ config, task, kind: 'hard', resolved, f2p: resolved, p2p: true, freshTokens: 10000 })
  const rows = [
    row('opus', 'same', true), row('opus', 'same', true),
    row('opus', 'trap', true), row('opus', 'trap', false),
    row('sonnet', 'same', true), row('sonnet', 'same', true),
    row('sonnet', 'trap', false), row('sonnet', 'trap', false),
    row('cc-tiers', 'same', true), row('cc-tiers', 'same', true),
    row('cc-tiers', 'trap', true), row('cc-tiers', 'trap', true),
  ]
  const trap = rows.filter((r) => r.task === 'trap')
  const text = table(trap)
  assert.ok(text.includes('| Opus only | 50% | — | 0% (k=2) | 1/2 | 0 | — | 20.0k |'))
  assert.ok(text.includes('| Sonnet only | 0% | −50 pp | 0% (k=2) | 0/2 | 0 | — | — |'))
  assert.ok(text.includes('| cc-tiers (Opus orchestrator) | 100% | +50 pp | 100% (k=2) | 2/2 | 0 | — | 10.0k |'))
  assert.deepEqual(differenceTable(rows), [
    '**Where it made a difference** (resolved runs per task vs Opus only)',
    '',
    '| Task | Opus only | Sonnet only | cc-tiers (Opus orchestrator) |',
    '| --- | --: | --: | --: |',
    '| `trap` | 1/2 | 0/2 | 2/2 |',
  ])
  const full = table(rows)
  const perTask = full.indexOf('| `trap` (hard) |')
  const section = full.indexOf('**Where it made a difference**')
  assert.ok(perTask >= 0 && section > perTask && section < full.indexOf('hard: pass@1'))
  const same = rows.filter((r) => r.task === 'same')
  assert.deepEqual(differenceTable(same), ['No task differs from Opus only.'])
  assert.ok(table(same).includes('\nNo task differs from Opus only.\n'))
  const noOpus = rows.filter((r) => r.config !== 'opus')
  assert.deepEqual(differenceTable(noOpus), [])
  assert.equal(table(noOpus).includes('No task differs'), false)
  assert.equal(table(noOpus).includes('Where it made a difference'), false)
  assert.ok(table(noOpus).includes('| Sonnet only | 50% | — | 50% (k=2) | 2/4 | 0 | — | 20.0k |'))
})

test('Δ pass@1 rounds halves away from zero, and a task Opus did not run is listed', async () => {
  const { table, differenceTable } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const runs = (config, task, resolved, total) => Array.from({ length: total }, (_, i) => ({ config, task, kind: 'hard', resolved: i < resolved }))
  const text = table([...runs('opus', 'a', 4, 8), ...runs('sonnet', 'a', 5, 8), ...runs('cc-tiers', 'a', 3, 8)])
  assert.ok(text.includes('| 63% | +13 pp | 0% (k=8) | 5/8 | — | — | — |'), text)
  assert.ok(text.includes('| 38% | −13 pp | 0% (k=8) | 3/8 | — | — | — |'), text)
  const rows = [...runs('opus', 'a', 1, 1), ...runs('sonnet', 'a', 1, 1), ...runs('sonnet', 'b', 1, 1)]
  assert.deepEqual(differenceTable(rows).slice(2), [
    '| Task | Opus only | Sonnet only |',
    '| --- | --: | --: |',
    '| `b` | — | 1/1 |',
  ])
})

test('old result rows render with pass as resolved', async () => {
  const { metrics, table } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const usage = (input, output, cacheRead, cacheWrite) => ({ 'claude-opus-5-5': { input, output, cacheRead, cacheWrite } })
  const rows = [
    { config: 'opus', task: 'typo', kind: 'trivial', pass: true, cost: 0.1, models: { 'claude-opus-5-5': 0.1 }, tokens: usage(1000, 2000, 50000, 3000) },
    { config: 'opus', task: 'typo', kind: 'trivial', pass: false, cost: 0.3, models: { 'claude-opus-5-5': 0.3 }, tokens: usage(1000, 1000, 90000, 2000) },
    { config: 'sonnet', task: 'typo', kind: 'trivial', pass: true, cost: 0.1, models: {} },
    { config: 'sonnet', task: 'typo', kind: 'trivial', pass: false, cost: 0.1, models: {} },
  ]
  const text = table(rows)
  assert.ok(text.includes('| Opus only | 50% | — | 0% (k=2) | 1/2 | — | — | 10.0k |'))
  assert.ok(text.includes('| Sonnet only | 50% | 0 pp | 0% (k=2) | 1/2 | — | — | — |'))
  assert.ok(text.includes('| `typo` (trivial) | 🟡 1/2 | 🟡 1/2 |'))
  assert.equal(text.includes('$'), false)
  const mixed = [
    { task: 'a', resolved: true, f2p: true, p2p: true, freshTokens: 10000 },
    { task: 'b', pass: true },
  ]
  assert.equal(metrics(mixed).tokensPerResolved, 10000)
  assert.equal(metrics(mixed).regressions, 0)
  assert.equal(metrics(mixed).recreated, null)
})

test('session steps keep their own usage, not the running total', async () => {
  const { stepUsage } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const usage = (input, output, cacheRead, cacheWrite, costUSD) => ({
    inputTokens: input, outputTokens: output, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheWrite, costUSD, contextWindow: 200000,
  })
  const first = { session_id: 's1', total_cost_usd: 0.07, modelUsage: { opus: usage(6, 336, 44637, 6778, 0.07) } }
  const second = {
    session_id: 's1',
    total_cost_usd: 0.1,
    modelUsage: { opus: usage(10, 563, 60000, 7000, 0.09), haiku: usage(100, 50, 0, 200, 0.01) },
  }
  const step = stepUsage(second, first)
  assert.deepEqual(step.modelUsage.opus, usage(4, 227, 15363, 222, 0.09 - 0.07))
  assert.deepEqual(step.modelUsage.haiku, usage(100, 50, 0, 200, 0.01))
  assert.equal(step.total_cost_usd, 0.1 - 0.07)
  assert.equal(stepUsage(first, null), first)
  const fresh = { ...second, session_id: 's2' }
  assert.equal(stepUsage(fresh, first), fresh)
})

test('the hard benchmark fixture is green, and every hidden check fails before its task and passes with the reference fix', async () => {
  const bench = path.join(ROOT, 'bench')
  const tasks = JSON.parse(readFileSync(path.join(bench, 'tasks-hard.json'), 'utf8'))
  assert.equal(tasks[0].id, 'find-listeners', 'the lookup runs first in session mode, while the tree is clean')
  const kinds = {}
  for (const task of tasks) kinds[task.kind] = (kinds[task.kind] || 0) + 1
  assert.deepEqual(kinds, { trivial: 4, normal: 3, hard: 3, large: 2 })
  const { cpSync } = await import('node:fs')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const dirs = []
  const fresh = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-hard-'))
    dirs.push(dir)
    cpSync(path.join(bench, 'fixture-hard'), dir, { recursive: true })
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'fixture']]) {
      spawnSync('git', args, { cwd: dir })
    }
    mkdirSync(path.join(dir, '.bench-check'))
    return dir
  }
  const run = (dir, files, extra = {}) => spawnSync(process.execPath, ['--test', ...files], { cwd: dir, encoding: 'utf8', env: { ...env, ...extra } })
  const projectTests = (dir) => readdirSync(path.join(dir, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('test', name))
  try {
    const untouched = await fresh()
    assert.equal(run(untouched, projectTests(untouched)).status, 0)
    for (const task of tasks) {
      assert.ok(task.prompt, task.id)
      const check = path.join(bench, 'checks-hard', `${task.id}.test.mjs`)
      cpSync(check, path.join(untouched, '.bench-check', `${task.id}.test.mjs`))
      assert.notEqual(run(untouched, [`.bench-check/${task.id}.test.mjs`]).status, 0, `${task.id} check passes on the untouched fixture`)
    }
    for (const task of tasks) {
      const dir = await fresh()
      const patch = path.join(bench, 'solutions-hard', `${task.id}.patch`)
      const answer = path.join(bench, 'solutions-hard', `${task.id}.txt`)
      if (existsSync(patch)) assert.equal(spawnSync('git', ['apply', patch], { cwd: dir }).status, 0, `${task.id} patch applies`)
      cpSync(path.join(bench, 'checks-hard', `${task.id}.test.mjs`), path.join(dir, '.bench-check', `${task.id}.test.mjs`))
      const result = existsSync(answer) ? readFileSync(answer, 'utf8') : ''
      const proc = run(dir, [`.bench-check/${task.id}.test.mjs`, ...projectTests(dir)], { BENCH_RESULT: result })
      assert.equal(proc.status, 0, `${task.id} reference fails:\n${proc.stdout.slice(-1500)}`)
      const changed = []
      for (const file of projectTests(untouched)) {
        writeFileSync(path.join(dir, file), readFileSync(path.join(untouched, file)))
        if (run(dir, [file]).status !== 0) changed.push(file)
      }
      assert.deepEqual(changed, task.changesTests ?? [], `${task.id}: original tests that fail against the reference`)
    }
  } finally {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  }
})

test('the benchmark counts escalations from hook output only, and splits results by kind', async () => {
  const { escalationsIn, kindTable, routeIn, routing } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const hook = (text) => JSON.stringify({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [text], hookEvent: 'PostToolUse' } })
  const counted = tiers.applyEvent(
    tiers.applyEvent(tiers.emptyState('s'), tiers.normalizeEvent(event('t1', 'implementer', report('implementer', 'sonnet', 'fail'))), riskyRouting()).state,
    tiers.normalizeEvent(event('t2', 'implementer', report('implementer', 'sonnet', 'fail'))),
    riskyRouting(),
  ).message
  const lines = [
    hook('cc-tiers moved csv from haiku to sonnet before the attempt limit. The new tier starts at zero failures; carry the notes.'),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: counted }] } }),
    hook(counted),
  ]
  assert.deepEqual(escalationsIn(lines), ['haiku->sonnet (early)', 'sonnet->opus (limit)'])
  assert.deepEqual(escalationsIn(lines, 1), ['sonnet->opus (limit)'])
  const rows = [
    { config: 'sonnet', task: 'race', kind: 'hard', resolved: false, escalations: null },
    { config: 'sonnet', task: 'race', kind: 'hard', resolved: true, escalations: null },
    { config: 'cc-tiers', task: 'race', kind: 'hard', resolved: true, escalations: 2 },
  ]
  const text = kindTable(rows).join('\n')
  assert.ok(text.includes('| Configuration | hard: pass@1 | Escalations | Routed as documented |'))
  assert.ok(text.includes('| Sonnet only | 50% | — | — |'))
  assert.ok(text.includes('| cc-tiers (Opus orchestrator) | 100% | 2 | — |'))
  assert.equal(text.includes('$'), false)
  const call = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
  const steps = routeIn([
    call('Agent', { subagent_type: 'cc-tiers:worker', prompt: 'CC_TIERS_TASK: rename\nCC_TIERS_TIER: haiku' }),
    call('Agent', { subagent_type: 'cc-tiers:implementer', prompt: 'CC_TIERS_TASK: skip-dates\nCC_TIERS_TIER: sonnet' }),
    call('Edit', { file_path: 'src/time.js' }),
  ])
  assert.deepEqual(steps.map((step) => step.task), ['rename', 'skip-dates', ''])
  assert.deepEqual(routing('large', steps, 'opus'), { path: 'haiku -> sonnet -> inline opus', ok: true })
  assert.equal(routing('normal', steps.slice(2), 'opus').ok, false)
  assert.equal(routing('normal', steps.slice(2), 'sonnet').ok, true)
  assert.equal(routing('trivial', steps.slice(1), 'opus').ok, false)
  assert.equal(routing('hard', steps, 'opus').ok, false)
  assert.equal(routing('large', steps.slice(0, 1), 'opus').ok, false)
})

test('the benchmark sees inline work that only changed the workspace tree', async () => {
  const { inlineSteps, routing, workspaceTree } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-tree-'))
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(path.join(dir, 'a.js'), 'export const a = 1\n')
    git('init', '-q')
    git('add', '-A')
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'fixture')
    const before = workspaceTree(dir)
    assert.match(before, /^[0-9a-f]{40,64}$/)
    assert.equal(workspaceTree(dir) !== before, false)
    writeFileSync(path.join(dir, 'b.js'), 'export const b = 2\n')
    assert.equal(workspaceTree(dir) !== before, true)
    assert.equal(git('diff', '--cached', '--name-only').stdout, '', 'the snapshot leaves the real index alone')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  const inline = inlineSteps([{ agent: 'cc-tiers:researcher', task: 'csv' }], true)
  assert.deepEqual(inline.at(-1), { agent: 'inline', task: '' })
  assert.deepEqual(routing('normal', inline, 'sonnet'), { path: 'inline sonnet', ok: true })
  assert.deepEqual(inlineSteps([], false), [])
  const delegated = [{ agent: 'cc-tiers:implementer', task: 'csv' }]
  assert.deepEqual(inlineSteps(delegated, true), delegated)
  const edited = [{ agent: 'inline', task: '' }]
  assert.deepEqual(inlineSteps(edited, true), edited)
  for (const [agent, tier] of [['general-purpose', 'general-purpose'], ['cc-tiers:orchestrator', 'opus']]) {
    const steps = inlineSteps([{ agent: 'cc-tiers:reviewer', task: '' }, { agent, task: 'csv' }], true)
    assert.equal(routing('normal', steps, 'sonnet').path, `${tier} (+ Opus review)`, agent)
  }
  assert.equal(routing('normal', inlineSteps([{ agent: 'Explore', task: '' }], true), 'sonnet').path, 'inline sonnet')
})

test('a run with no JSON has no token count', async () => {
  const { kilo, metrics, summarize } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const verdict = { f2p: false, p2p: true, ownTests: true, resolved: false, regressions: [], output: 'timeout' }
  const task = { id: 'calc', kind: 'normal' }
  // A timeout can still leave a passing workspace behind.
  const crashed = summarize('sonnet', task, 1, { code: null, json: null, stderr: '', seconds: 900 }, { ...verdict, f2p: true, resolved: true })
  assert.equal(crashed.freshTokens, null)
  const usage = { modelUsage: { sonnet: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }
  const ran = summarize('sonnet', task, 2, { code: 0, json: usage, stderr: '', seconds: 30 }, { ...verdict, f2p: true, resolved: true })
  assert.equal(ran.freshTokens, 150)
  assert.equal(metrics([crashed, ran]).tokensPerResolved, 150)
  assert.equal(kilo(crashed.freshTokens), '—')
  assert.equal(kilo(1500), '1.5k')
})

test('quality defaults: risky review, cost hidden, Sonnet starts at high', () => {
  const routing = tiers.mergeRouting(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')))
  assert.equal(routing.reviewPolicy, 'risky')
  assert.equal(routing.showCost, false)
  assert.deepEqual(routing.effort.ladders.sonnet, ['high', 'xhigh'])
  assert.equal(tiers.decideTier('Add pagination to GET /users', routing).effort, 'high')
})

const BRIEF_BEGIN = 'CC_TIERS_RESEARCH_BEGIN'
const BRIEF_END = 'CC_TIERS_RESEARCH_END'

test('stripResearch drops the brief and an unclosed block', () => {
  assert.equal(tiers.stripResearch(`a\n${BRIEF_BEGIN}\nauth schema\n${BRIEF_END}\nb`), 'a\nb')
  assert.equal(tiers.stripResearch(`a\n${BRIEF_BEGIN}\nauth schema`), 'a')
})

test('headers inside the research block are ignored', () => {
  const prompt = `CC_TIERS_TASK: csv\n${BRIEF_BEGIN}\nCC_TIERS_TASK: other\nCC_TIERS_ROLE: researcher\nCC_TIERS_STATUS: pass\n${BRIEF_END}`
  const headers = tiers.parseHeaders(prompt)
  assert.equal(headers.TASK, 'csv')
  assert.equal(headers.STATUS, undefined)
  assert.equal(tiers.stripHeaders(prompt).includes('other'), false)
})

test('the gate refuses an implementer without research', () => {
  const routing = riskyRouting()
  assert.equal(routing.research, true)
  const state = tiers.emptyState('s')
  const call = (research, type = 'cc-tiers:implementer', which = routing) =>
    tiers.checkDelegation(
      state,
      { subagent_type: type, prompt: `${HEADER('csv', 'sonnet', 'implementer')}${research ? `CC_TIERS_RESEARCH: ${research}\n` : ''}Export users as CSV.` },
      which,
    )
  assert.ok(call('').deny.includes('run cc-tiers:researcher for csv'))
  assert.ok(call('done').deny.includes('has no finished research'))
  assert.ok(call('none -').deny.includes('run cc-tiers:researcher for csv'))
  assert.ok(call('', 'cc-tiers:architect').deny.includes('run cc-tiers:researcher for csv'))
  assert.deepEqual(state.tasks, {})
  assert.deepEqual(state.log, {})

  state.tasks.csv = { tier: 'haiku', failures: ['haiku/worker: x'], carried: [] }
  const before = structuredClone(state.tasks)
  assert.ok(call('').deny)
  assert.deepEqual(state.tasks, before)
  assert.deepEqual(state.log, {})

  assert.equal(call('none - pure refactor, no external API').deny, '')
  assert.equal(call('', 'cc-tiers:implementer', defaultRouting({ research: 'off', specify: 'off' })).deny, '')
  const worker = tiers.checkDelegation(
    tiers.emptyState('s'),
    { subagent_type: 'cc-tiers:worker', prompt: `${HEADER('typo', 'haiku', 'worker')}Fix a typo in README.` },
    routing,
  )
  assert.equal(worker.deny, '')
  const researcher = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:researcher', prompt: 'look around' }, routing)
  assert.ok(researcher.deny.includes('CC_TIERS_TASK'))
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:researcher', prompt: 'CC_TIERS_TASK: csv\nlook' }, routing).deny, '')
})

test('a slug named like an Object.prototype key needs its own research mark', () => {
  const routing = riskyRouting()
  const call = (state) =>
    tiers.checkDelegation(
      state,
      { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('constructor', 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\nBuild it.` },
      routing,
    )
  assert.ok(call(tiers.emptyState('s')).deny.includes('constructor has no finished research'))
})

test('an unclosed research block in the prompt does not hide the report trailer', () => {
  const routing = defaultRouting({ review_policy: 'cheap', verify: 'off' })
  const prompt = `${HEADER('csv', 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\n${BRIEF_BEGIN}\n- users table`
  const text = 'Done. Touched the login middleware.\nCC_TIERS_TASK: csv\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_STATUS: pass'
  const result = apply(tiers.emptyState('s'), routing, 'i1', 'implementer', text, prompt)
  assert.equal(result.meta.task, 'csv')
  assert.equal(result.meta.outcome, 'review')
  assert.ok(result.message.includes('cc-tiers:reviewer'))
})

test('a researcher pass marks the task and its covers', () => {
  const routing = riskyRouting()
  const prompt = 'CC_TIERS_TASK: csv\nCC_TIERS_COVERS: date-filter, cancel\nResearch the export.'
  const passed = apply(tiers.emptyState('s'), routing, 'r1', 'researcher', 'brief\nCC_TIERS_STATUS: pass', prompt)
  assert.deepEqual(passed.state.researched, { csv: true, 'date-filter': true, cancel: true })
  assert.equal(passed.meta.outcome, 'research')
  assert.equal(passed.state.tasks.csv, undefined)
  assert.ok(passed.message.includes('cc-tiers marked csv, date-filter, cancel as researched.'))
  const allowed = tiers.checkDelegation(
    passed.state,
    { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('cancel', 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\nAdd cancel.` },
    routing,
  )
  assert.equal(allowed.deny, '')

  const failed = apply(tiers.emptyState('s'), routing, 'r2', 'researcher', 'CC_TIERS_STATUS: fail', prompt)
  assert.deepEqual(failed.state.researched, {})
  assert.ok(failed.message.includes('research for csv did not pass'))
  const missing = apply(tiers.emptyState('s'), routing, 'r3', 'researcher', 'no trailer', prompt)
  assert.deepEqual(missing.state.researched, {})
  assert.equal(missing.state.log.csv, undefined)

  const ctx = { routing, ccCost: false, projectDir: '' }
  const state = tiers.emptyState('s')
  const normalized = tiers.normalizeEvent(event('r4', 'researcher', 'CC_TIERS_STATUS: pass', prompt))
  const usage = { key: 'r4', cost: { sonnet: 0.5, opusRate: 1 } }
  tiers.processReport(ctx, state, normalized, usage)
  assert.equal(state.log.csv, undefined)
  assert.ok(state.cost.csv)
  assert.equal(state.cost[tiers.OVERHEAD], undefined)
})

test('a background researcher marks the slug only when it reports pass', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir)
    const prompt = 'CC_TIERS_TASK: csv\nCC_TIERS_ROLE: researcher\nResearch the export.'
    runHook(
      'after_agent.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'bg-r',
        tool_input: { subagent_type: 'cc-tiers:researcher', prompt },
        tool_response: { status: 'async_launched', agentId: 'agent-r', prompt },
      },
      env,
    )
    const file = tiers.sessionPath(path.join(dir, 'data'), 'sess-1')
    assert.deepEqual(tiers.loadState(file, 'sess-1').researched, {})
    const stop = runHook(
      'subagent_stop.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'SubagentStop',
        agent_id: 'agent-r',
        agent_type: 'cc-tiers:researcher',
        last_assistant_message: 'brief\nCC_TIERS_STATUS: pass',
      },
      env,
    )
    assert.equal(stop.status, 0, stop.stderr)
    assert.deepEqual(tiers.loadState(file, 'sess-1').researched, { csv: true })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the research mark survives a passed task', () => {
  const routing = riskyRouting()
  let state = apply(tiers.emptyState('s'), routing, 'r1', 'researcher', 'CC_TIERS_STATUS: pass', 'CC_TIERS_TASK: csv').state
  state.tasks.csv = { tier: 'sonnet', failures: ['sonnet/implementer: x'], carried: [] }
  const text = 'CC_TIERS_TASK: csv\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_STATUS: pass\nCC_TIERS_REVIEW: skip'
  state = apply(state, routing, 'i1', 'implementer', text).state
  assert.equal(state.tasks.csv, undefined)
  assert.equal(state.researched.csv, true)
})

test('the brief does not raise effort or complexity', () => {
  const routing = riskyRouting()
  const base = `${HEADER('csv', 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\nExport users as CSV.`
  const brief = [
    BRIEF_BEGIN,
    '- the schema has a users table',
    '- permission checks run in the login middleware',
    '- see src/a.js, src/b.js, src/c.js, src/d.js',
    '- then update the password reset flow',
    BRIEF_END,
  ].join('\n')
  const run = (prompt) => {
    const state = tiers.emptyState('s')
    state.researched = { csv: true }
    return tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  }
  const plain = run(base)
  const withBrief = run(`${base}\n${brief}`)
  assert.equal(plain.deny, '')
  assert.equal(withBrief.deny, '')
  assert.deepEqual(withBrief.input?.effort, plain.input?.effort)
  assert.equal(withBrief.context, plain.context)
})

test('research is a /config and project option', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  assert.equal(defaults.research, true)
  assert.equal(tiers.mergeRouting(defaults).research, true)
  assert.equal(tiers.mergeRouting(defaults, { research: false }).research, false)
  assert.equal(tiers.mergeRouting(defaults, { research: false }, { research: 'on' }).research, true)
  assert.equal(tiers.mergeRouting(defaults, null, { research: 'off' }).research, false)
  assert.equal(tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_RESEARCH: 'off' }).research, 'off')
  assert.equal(tiers.userFromEnv({}).research, null)
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const option = manifest.userConfig.research
  assert.equal(option.type, 'string')
  assert.deepEqual(option.options, ['on', 'off'])
  assert.equal(option.default, 'on')
  assert.ok(option.description.includes('none - <reason>'))
  const text = tiers.formatSessionContext(tiers.mergeRouting(defaults), 'not present', { ccCost: { installed: false } })
  assert.ok(text.includes('Research: on'))
  assert.ok(text.indexOf('Research: on') > text.indexOf('Classifier:'))
  assert.equal(tiers.ROLES.researcher, 'sonnet')
  assert.equal(tiers.SCOPED.researcher, 'cc-tiers:researcher')
  for (const roles of [tiers.WRITER_ROLES, tiers.REVIEW_ROLES, tiers.SESSION_ROLES]) assert.equal(roles.has('researcher'), false)
})

test('the research list is capped and drops the oldest slug', () => {
  const routing = riskyRouting()
  let state = tiers.emptyState('s')
  for (let index = 0; index < 205; index += 1) {
    state = apply(state, routing, `r${index}`, 'researcher', 'CC_TIERS_STATUS: pass', `CC_TIERS_TASK: t${index}`).state
  }
  const slugs = Object.keys(state.researched)
  assert.equal(slugs.length, 200)
  assert.equal(slugs[0], 't5')
  assert.equal(state.researched.t204, true)
})

const SPEC_BEGIN = 'CC_TIERS_SPEC_BEGIN'
const SPEC_END = 'CC_TIERS_SPEC_END'

test('stripSpec drops the criteria block and an unclosed one', () => {
  assert.equal(tiers.stripSpec(`a\n${SPEC_BEGIN}\nCriteria:\n- auth schema (request)\n${SPEC_END}\nb`), 'a\nb')
  assert.equal(tiers.stripSpec(`a\n${SPEC_BEGIN}\nauth schema`), 'a')
  assert.deepEqual(tiers.specCriteria(`a\n${SPEC_BEGIN}\nCriteria:\n\n- exports a CSV (request)\nEdge cases:\n${SPEC_END}`), ['- exports a CSV (request)'])
  assert.deepEqual(tiers.specCriteria('no block'), [])
})

test('headers inside the spec block are ignored', () => {
  const trailer = 'CC_TIERS_TASK: other\nCC_TIERS_ROLE: researcher\nCC_TIERS_STATUS: pass'
  const prompt = `CC_TIERS_TASK: csv\n${SPEC_BEGIN}\nCriteria:\n- x (request)\n${trailer}\n${SPEC_END}`
  const headers = tiers.parseHeaders(prompt)
  assert.equal(headers.TASK, 'csv')
  assert.equal(headers.STATUS, undefined)
  assert.equal(tiers.stripHeaders(prompt).includes('other'), false)
})

test('the spec gate refuses a writer without criteria', () => {
  const routing = defaultRouting({ research: 'off' })
  assert.equal(routing.specify, true)
  const state = tiers.emptyState('s')
  const call = (extra, type = 'cc-tiers:implementer', which = routing) =>
    tiers.checkDelegation(state, { subagent_type: type, prompt: `${HEADER('csv', 'sonnet', 'implementer')}${extra}Export users as CSV.` }, which)
  const refusal =
    'cc-tiers: write the acceptance criteria for csv between CC_TIERS_SPEC_BEGIN and CC_TIERS_SPEC_END before delegating it, or add CC_TIERS_SPEC: none - <reason>.'
  assert.equal(call('').deny, refusal)
  assert.equal(call('', 'cc-tiers:architect').deny, refusal)
  assert.equal(call(`${SPEC_BEGIN}\nCriteria:\nEdge cases:\nAssumed:\n${SPEC_END}\n`).deny, refusal)
  assert.equal(call('CC_TIERS_SPEC: none -\n').deny, refusal)
  for (const body of ['-', '- (request)', '**', '1. (repo: src/a.js:3)', '• (decided: simpler) (user)']) {
    assert.equal(call(`${SPEC_BEGIN}\nCriteria:\n${body}\n${SPEC_END}\n`).deny, refusal, body)
  }
  for (const heading of ['**Criteria:**', '## Edge cases', 'Criteria', '*Assumed:*', '__Criteria__:']) {
    assert.equal(call(`${SPEC_BEGIN}\n${heading}\n${SPEC_END}\n`).deny, refusal, heading)
  }
  assert.equal(call(`${BRIEF_BEGIN}\n${SPEC_BEGIN}\nCriteria:\n- a CSV with a header row (request)\n${SPEC_END}\n${BRIEF_END}\n`).deny, refusal)
  assert.deepEqual(state.tasks, {})
  assert.deepEqual(state.log, {})

  state.tasks.csv = { tier: 'haiku', failures: ['haiku/worker: x'], carried: [] }
  const before = structuredClone(state.tasks)
  assert.ok(call('').deny)
  assert.deepEqual(state.tasks, before)
  assert.deepEqual(state.log, {})

  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}${SPEC_BEGIN}\n**Criteria:**\n- a CSV with a header row (request)\n${SPEC_END}\nGo.` }, routing).deny, '')
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}CC_TIERS_SPEC: none - typo-level change\nGo.` }, routing).deny, '')
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}${SPEC_BEGIN}\nCriteria:\n- a CSV with a header row (request)\n${SPEC_END}\nGo.` }, routing).deny, '')
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}${SPEC_BEGIN}\nCriteria:\n- returns {} when both files are missing (request)\n${SPEC_END}\nGo.` }, routing).deny, '')
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}Go.` }, defaultRouting({ research: 'off', specify: 'off' })).deny, '')
  const worker = tiers.checkDelegation(
    tiers.emptyState('s'),
    { subagent_type: 'cc-tiers:worker', prompt: `${HEADER('typo', 'haiku', 'worker')}Fix a typo in README.` },
    routing,
  )
  assert.equal(worker.deny, '')
  const both = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}Go.` }, defaultRouting())
  assert.ok(both.deny.includes('run cc-tiers:researcher for csv'))
  const hint = ' Also add the acceptance criteria between CC_TIERS_SPEC_BEGIN and CC_TIERS_SPEC_END, or CC_TIERS_SPEC: none - <reason>.'
  assert.ok(both.deny.endsWith(`add CC_TIERS_RESEARCH: none - <reason>.${hint}`))
  const onlyResearch = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${HEADER('csv', 'sonnet', 'implementer')}CC_TIERS_SPEC: none - typo\nGo.` }, defaultRouting())
  assert.ok(onlyResearch.deny.includes('run cc-tiers:researcher for csv'))
  assert.equal(onlyResearch.deny.includes('acceptance criteria'), false)
})

test('both blocks are left out of routing signals', () => {
  const routing = defaultRouting()
  const base = `${HEADER('csv', 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\nExport users as CSV.`
  const brief = [BRIEF_BEGIN, '- the schema has a users table', '- see src/a.js, src/b.js, src/c.js', BRIEF_END].join('\n')
  const spec = [
    SPEC_BEGIN,
    'Criteria:',
    '- auth schema permission checks stay as they are (repo: src/auth.js:10)',
    '- the password reset flow is untouched (decided: out of scope)',
    '- see src/d.js, src/e.js, src/f.js, src/g.js',
    'Edge cases:',
    '- an empty users table gives a header-only file (request)',
    SPEC_END,
  ].join('\n')
  const run = (prompt) => {
    const state = tiers.emptyState('s')
    state.researched = { csv: true }
    return tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  }
  const plain = run(`${base}\nCC_TIERS_SPEC: none - plain baseline`)
  const withBlocks = run(`${base}\n${brief}\n${spec}`)
  assert.equal(plain.deny, '')
  assert.equal(withBlocks.deny, '')
  assert.deepEqual(withBlocks.input?.effort, plain.input?.effort)
  assert.equal(withBlocks.context, plain.context)
})

test('specify is a /config and project option', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  assert.equal(defaults.specify, true)
  assert.equal(tiers.mergeRouting(defaults).specify, true)
  assert.equal(tiers.mergeRouting(defaults, { specify: false }).specify, false)
  assert.equal(tiers.mergeRouting(defaults, { specify: false }, { specify: 'on' }).specify, true)
  assert.equal(tiers.mergeRouting(defaults, null, { specify: 'off' }).specify, false)
  assert.equal(tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_SPECIFY: 'off' }).specify, 'off')
  assert.equal(tiers.userFromEnv({}).specify, null)
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const option = manifest.userConfig.specify
  assert.equal(option.type, 'string')
  assert.deepEqual(option.options, ['on', 'off'])
  assert.equal(option.default, 'on')
  assert.ok(option.description.includes('none - <reason>'))
  const text = tiers.formatSessionContext(tiers.mergeRouting(defaults), 'not present', { ccCost: { installed: false } })
  assert.ok(text.includes('Specify: on'))
  assert.ok(text.indexOf('Specify: on') > text.indexOf('Research: on'))
  const off = tiers.formatSessionContext(tiers.mergeRouting(defaults, null, { specify: 'off' }), 'not present', { ccCost: { installed: false } })
  assert.ok(off.includes('Specify: off'))
})

test('every benchmark config runs without AskUserQuestion', async () => {
  const { CONFIGS, claudeArgs } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  assert.deepEqual(Object.keys(CONFIGS), ['opus', 'sonnet', 'cc-tiers', 'cc-tiers-light'])
  for (const name of Object.keys(CONFIGS)) {
    for (const resume of ['', 'abc']) {
      const args = claudeArgs(CONFIGS[name], ROOT, 'do it', resume)
      assert.equal(args[args.indexOf('--disallowedTools') + 1], 'AskUserQuestion', `${name} keeps AskUserQuestion`)
      assert.equal(args[1], 'do it')
      assert.equal(args.includes('--resume'), Boolean(resume))
    }
  }
})

test('--session is refused for a oneShot task, and the login task is oneShot', async () => {
  const { sessionRefusal } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const tasks = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'tasks-login.json'), 'utf8'))
  assert.throws(() => sessionRefusal(tasks, 'bench/tasks-login.json', true), /tasks-login\.json.*login.*the task edits the server and config/s)
  assert.throws(() => sessionRefusal([{ id: 'x', oneShot: true }], 'bench/t.json', true), /"x".*clean tree/s)
  assert.doesNotThrow(() => sessionRefusal(tasks, 'bench/tasks-login.json', false))
  assert.doesNotThrow(() => sessionRefusal([{ id: 'a' }], 'bench/tasks-hard.json', true))
})

test('a slug named like an Object.prototype key works through every per-slug map', async () => {
  const routing = riskyRouting()
  const task = 'constructor'
  const trailer = (role, status) => `ok\nCC_TIERS_TASK: ${task}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: ${role}\nCC_TIERS_STATUS: ${status}\n`
  let state = apply(tiers.emptyState('s'), routing, 'r1', 'researcher', 'brief\nCC_TIERS_STATUS: pass', `CC_TIERS_TASK: ${task}\nResearch.`).state
  const prompt = `${HEADER(task, 'sonnet', 'implementer')}CC_TIERS_RESEARCH: done\nBuild it.`
  assert.equal(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt }, routing).deny, '')
  const passed = apply(state, routing, 'i1', 'implementer', `${trailer('implementer', 'pass')}CC_TIERS_REVIEW: pending\n`, prompt)
  assert.equal(passed.meta.outcome, 'review')
  state = passed.state
  tiers.addSpend(state.spend, task, 'sonnet', 10)
  tiers.addCost(state.cost, task, { tier: 'sonnet', usd: 1, opus: 2 })
  const reviewed = apply(state, routing, 'v1', 'reviewer', `${trailer('reviewer', 'pass')}CC_TIERS_REASON: checked\n`)
  assert.equal(reviewed.meta.outcome, 'pass')
  for (const map of ['log', 'cost', 'spend']) assert.ok(Object.hasOwn(reviewed.state[map], task), map)
  assert.equal(reviewed.state.cost[task].sonnet, 1)
  assert.equal(reviewed.state.spend[task].sonnet, 10)
  assert.equal(Object.haiku, undefined)
  tiers.mergeCost(reviewed.state.cost, { [task]: { haiku: 1 } })
  assert.equal(reviewed.state.cost[task].haiku, 1)
  const ctx = { routing, ccCost: false, projectDir: '' }
  const fresh = tiers.emptyState('s')
  tiers.processReport(ctx, fresh, tiers.normalizeEvent(event('r9', 'researcher', 'CC_TIERS_STATUS: pass', `CC_TIERS_TASK: ${task}\nx`)), { key: 'r9', cost: { haiku: 0.5, opusRate: 1 } })
  assert.ok(Object.hasOwn(fresh.cost, task))
  assert.equal(Object.haiku, undefined)
  const { renderReport } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'report.mjs')).href)
  const text = renderReport([JSON.parse(JSON.stringify(reviewed.state))])
  assert.match(text, /\| constructor \|/)
  assert.equal(Object.haiku, undefined)
})

const LOGIN_PROMPT = 'Add POST /login. The body is { email, password }; if they match a user, respond 200 with { token }, a token signed with the app\'s private key that is valid for one hour and identifies the user; otherwise respond 401.'

async function loginWorkspace() {
  const { cpSync } = await import('node:fs')
  const bench = path.join(ROOT, 'bench')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-login-'))
  cpSync(path.join(bench, 'fixture-login'), dir, { recursive: true })
  mkdirSync(path.join(dir, '.bench-check'))
  cpSync(path.join(bench, 'checks-login', 'login.test.mjs'), path.join(dir, '.bench-check', 'login.test.mjs'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  delete env.PRIVATE_KEY
  const run = (...files) => spawnSync(process.execPath, ['--test', ...files], { cwd: dir, encoding: 'utf8', env })
  const fixtureTests = () => readdirSync(path.join(dir, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => `test/${name}`)
  const solve = (name) => cpSync(path.join(bench, 'solutions-login', name), path.join(dir, name))
  return { dir, env, run, fixtureTests, solve }
}

test('the login task is the natural prompt, with no hints, and runs one-shot', () => {
  const tasks = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'tasks-login.json'), 'utf8'))
  assert.deepEqual(tasks, [{ id: 'login', kind: 'hard', oneShot: 'the task edits the server and config', prompt: LOGIN_PROMPT }])
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'fixture-login', 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies, { dotenv: '8.6.0' })
  const installed = JSON.parse(readFileSync(path.join(ROOT, 'bench', 'fixture-login', 'node_modules', 'dotenv', 'package.json'), 'utf8'))
  assert.equal(installed.version, '8.6.0')
})

test('the login check embeds the private key from the fixture .env byte for byte', () => {
  const source = readFileSync(path.join(ROOT, 'bench', 'checks-login', 'login.test.mjs'), 'utf8')
  const embedded = JSON.parse(source.match(/^const PRIVATE_KEY = (".*")$/m)[1])
  const dotenvFile = readFileSync(path.join(ROOT, 'bench', 'fixture-login', '.env'), 'utf8')
  assert.equal(embedded, dotenvFile.match(/^PRIVATE_KEY="([^"]*)"$/m)[1])
  assert.match(embedded, /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/)
})

test('the login check fails on the untouched fixture, whose own tests pass', async () => {
  const { dir, run, fixtureTests } = await loginWorkspace()
  try {
    assert.ok(fixtureTests().length >= 3)
    for (const file of fixtureTests()) assert.equal(run(file).status, 0, `${file} fails on the untouched fixture`)
    assert.notEqual(run('.bench-check/login.test.mjs').status, 0, 'check passes on the untouched fixture')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a naive /login on the existing config starts fine and keeps /health, but fails the login check', async () => {
  const { dir, env, run, solve } = await loginWorkspace()
  try {
    solve('src/server.js')
    const probe = [
      "import { createServer } from './src/server.js'",
      "import { config } from './src/config.js'",
      'const server = createServer().listen(0, async () => {',
      '  const health = await fetch(`http://127.0.0.1:${server.address().port}/health`)',
      '  console.log(JSON.stringify({ health: health.status, key: config.privateKey }))',
      '  server.close()',
      '})',
      '',
    ].join('\n')
    writeFileSync(path.join(dir, 'probe.mjs'), probe)
    const started = spawnSync(process.execPath, ['probe.mjs'], { cwd: dir, encoding: 'utf8', env })
    assert.equal(started.status, 0, started.stderr)
    assert.deepEqual(JSON.parse(started.stdout), { health: 200, key: '"-----BEGIN PRIVATE KEY-----' })
    const trapped = run('.bench-check/login.test.mjs')
    assert.notEqual(trapped.status, 0, 'the naive login passes the check')
    assert.match(trapped.stdout, /(?:not ok \d+ -|✖) a valid email and password get a signed one-hour token for that user/)
    assert.match(trapped.stdout, /answered 500/, 'the naive login should fail on the truncated key, with a 500')
    assert.match(trapped.stdout, /(?:#|ℹ) pass [1-9]/, `the naive solution fails everything, so the trap is not what fails it:\n${trapped.stdout.slice(-1500)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the reference login passes the check and every fixture test', async () => {
  const { dir, run, fixtureTests, solve } = await loginWorkspace()
  try {
    solve('src/config.js')
    solve('src/server.js')
    const proc = run('.bench-check/login.test.mjs', ...fixtureTests())
    assert.equal(proc.status, 0, `reference fails:\n${proc.stdout.slice(-2500)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the login check catches a recreated signer or an added JWT library, not a comment or a key check', async () => {
  const { dir, run, solve } = await loginWorkspace()
  const reuse = ['--test-name-pattern=existing helper', '.bench-check/login.test.mjs']
  const { grade } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)
  const checks = path.join(ROOT, 'bench', 'checks-login')
  try {
    const check = readFileSync(path.join(checks, 'login.test.mjs'), 'utf8')
    assert.ok(check.includes("test('reuse: tokens are signed with the existing helper and no JWT library is added'"))
    solve('src/config.js')
    solve('src/server.js')
    writeFileSync(path.join(dir, 'src', 'notes.js'), "// crypto.sign( and createPrivateKey( live in src/crypto/sign.js\nexport const signer = 'createSign('\n")
    assert.equal(run(...reuse).status, 0, 'a comment or a string counts as recreating the signer')
    const config = readFileSync(path.join(dir, 'src', 'config.js'), 'utf8')
    writeFileSync(path.join(dir, 'src', 'config.js'), `import { createPrivateKey } from 'node:crypto'\n${config}createPrivateKey(config.privateKey)\n`)
    assert.equal(run(...reuse).status, 0, 'checking the key with createPrivateKey in config.js counts as recreating the signer')
    for (const source of [
      "import { sign } from 'node:crypto'\nexport const jws = (data, key) => sign(null, data, key)\n",
      "import crypto from 'crypto'\nexport const jws = (data, key) => crypto.sign(null, data, key)\n",
      "import * as nodeCrypto from 'node:crypto'\nexport const jws = (data, key) => nodeCrypto.sign(null, data, key)\n",
      "const { sign: jws } = require('crypto')\nmodule.exports = jws\n",
      "import { createSign } from 'node:crypto'\nexport const jws = () => createSign('RSA-SHA256')\n",
    ]) {
      writeFileSync(path.join(dir, 'src', 'jwt.js'), source)
      assert.notEqual(run(...reuse).status, 0, `recreated signer passes:\n${source}`)
    }
    const recreated = grade(dir, { id: 'login' }, '', checks, new Map())
    assert.deepEqual([recreated.f2p, recreated.reuseChecked, recreated.recreated], [false, true, true])
    rmSync(path.join(dir, 'src', 'jwt.js'))
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, jose: '^5.0.0' } }))
    assert.notEqual(run(...reuse).status, 0, 'an added jose passes')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the login check accepts a token that identifies the user by email only', async () => {
  const { dir, run, solve } = await loginWorkspace()
  try {
    solve('src/config.js')
    solve('src/server.js')
    const server = readFileSync(path.join(dir, 'src', 'server.js'), 'utf8')
    const byEmail = server.replace('{ sub: user.id, iss: config.issuer }', '{ email: user.email }')
    assert.notEqual(byEmail, server)
    writeFileSync(path.join(dir, 'src', 'server.js'), byEmail)
    const proc = run('.bench-check/login.test.mjs')
    assert.equal(proc.status, 0, `an email-only token fails:\n${proc.stdout.slice(-1500)}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const VERIFY_ALLOW_DEFAULT = 'npm test, npm run test, node --test, npx tsc, npx eslint, npx vitest, npx jest, npx playwright test, vendor/bin/phpunit, ./vendor/bin/phpunit, vendor/bin/phpstan, ./vendor/bin/phpstan, vendor/bin/phpcs, ./vendor/bin/phpcs, pytest, python -m pytest, go test, cargo test'

test('manifest declares the verify knobs', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  for (const key of ['verify', 'review_evidence']) {
    const option = manifest.userConfig[key]
    assert.equal(option.type, 'string')
    assert.deepEqual(option.options, ['on', 'off'])
    assert.equal(option.default, 'on')
    assert.ok(option.title && option.description)
  }
  const allow = manifest.userConfig.verify_allow
  assert.equal(allow.type, 'string')
  assert.equal(allow.default, VERIFY_ALLOW_DEFAULT)
  assert.equal(allow.default.includes('docker'), false)
  assert.ok(allow.title && allow.description)
  for (const [key, def, min, max] of [['verify_timeout', 300, 10, 600], ['verify_budget', 600, 30, 600]]) {
    const option = manifest.userConfig[key]
    assert.equal(option.type, 'number')
    assert.equal(option.default, def)
    assert.equal(option.min, min)
    assert.equal(option.max, max)
    assert.ok(option.title && option.description)
  }
})

test('verify options come from /config env', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const base = tiers.mergeRouting(defaults)
  assert.equal(base.verify, true)
  assert.equal(base.reviewEvidence, true)
  assert.equal(base.verifyTimeout, 300)
  assert.equal(base.verifyBudget, 600)
  assert.deepEqual(base.verifyAllow, VERIFY_ALLOW_DEFAULT.split(',').map((entry) => entry.trim().split(/\s+/)))
  assert.deepEqual(tiers.mergeRouting(defaults, null, { verify_allow: '  ' }).verifyAllow, base.verifyAllow)

  const env = tiers.userFromEnv({
    CLAUDE_PLUGIN_OPTION_VERIFY: 'off',
    CLAUDE_PLUGIN_OPTION_REVIEW_EVIDENCE: 'off',
    CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'make  check, ,npm run lint',
    CLAUDE_PLUGIN_OPTION_VERIFY_TIMEOUT: '700',
    CLAUDE_PLUGIN_OPTION_VERIFY_BUDGET: '5',
  })
  const routing = tiers.mergeRouting(defaults, null, env)
  assert.equal(routing.verify, false)
  assert.equal(routing.reviewEvidence, false)
  assert.deepEqual(routing.verifyAllow, [['make', 'check'], ['npm', 'run', 'lint']])
  assert.equal(routing.verifyTimeout, 600)
  assert.equal(routing.verifyBudget, 30)
  assert.equal(tiers.mergeRouting(defaults, null, { verify_timeout: 'abc' }).verifyTimeout, 300)
  assert.equal(tiers.userFromEnv({}).verify, null)
  assert.equal(tiers.userFromEnv({}).verify_allow, '')
})

test('session context states verify and review evidence', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const ctx = (user) => tiers.formatSessionContext(tiers.mergeRouting(defaults, null, user), 'not present', { ccCost: { installed: false } })
  const on = ctx(null)
  assert.ok(on.includes('Verify: on (gate runs CC_TIERS_VERIFY commands; review needs evidence)'))
  assert.ok(on.includes('Review evidence: on'))
  assert.ok(on.indexOf('Verify: on') > on.indexOf('Specify: on'))
  const off = ctx({ verify: 'off', review_evidence: 'off' })
  assert.ok(off.includes('Verify: off'))
  assert.ok(off.includes('Review evidence: off'))
})

function gateEvent(toolUseId, text, gate) {
  const normalized = tiers.normalizeEvent(event(toolUseId, 'implementer', text))
  return gate === undefined ? normalized : { ...normalized, gate }
}

const GATE_BASE = { verified: [], flaky: [], unverified: [], failure: null }

test('writer pass without VERIFY counts a failure', () => {
  const state = tiers.emptyState('s')
  const applied = apply(state, defaultRouting(), 'a', 'implementer', report('implementer', 'sonnet', 'pass'))
  assert.equal(applied.meta.outcome, 'retry')
  assert.ok(applied.message.startsWith('cc-tiers gate: users-pagination reported pass without CC_TIERS_VERIFY'))
  assert.equal(applied.meta.reason, 'reported pass without CC_TIERS_VERIFY')
  assert.ok(state.tasks['users-pagination'].failures[0].includes('reported pass without CC_TIERS_VERIFY'))
  assert.equal(applied.meta.gate.status, 'missing')
  const missing = tiers.applyEvent(tiers.emptyState('s'), gateEvent('b', report('implementer', 'sonnet', 'pass'), { ...GATE_BASE, status: 'missing' }), defaultRouting())
  assert.equal(missing.meta.outcome, 'retry')
  const review = apply(tiers.emptyState('s'), defaultRouting(), 'c', 'checker', report('checker', 'haiku', 'pass'))
  assert.equal(review.meta.outcome, 'pass')
  assert.equal(review.message.includes('cc-tiers gate'), false)
})

test('failed gate counts a failure with the tail in the notes and escalates after max_attempts', () => {
  const state = tiers.emptyState('s')
  state.tasks = { 'other-task': { tier: 'haiku', failures: [], carried: [] } }
  const routing = defaultRouting({ max_attempts: 2 })
  const gate = {
    ...GATE_BASE,
    status: 'fail',
    failure: { raw: 'npm test', code: 1, timedOut: false, tail: 'at cursor.test.js:12\nAssertionError: boom', seconds: 300 },
  }
  const first = tiers.applyEvent(state, gateEvent('a', report('implementer', 'sonnet', 'pass'), gate), routing)
  assert.equal(first.meta.outcome, 'retry')
  assert.ok(first.message.startsWith('cc-tiers gate: users-pagination failed: npm test (exit 1)'))
  assert.equal(first.meta.reason, 'npm test exit 1: AssertionError: boom')
  assert.ok(first.message.includes('at cursor.test.js:12'))
  assert.ok(first.message.includes('Other open tasks in this session (other-task) may share the working tree; one of them may have caused this failure.'))
  assert.equal(first.meta.gate, gate)
  const second = tiers.applyEvent(state, gateEvent('b', report('implementer', 'sonnet', 'pass'), gate), routing)
  assert.equal(second.meta.outcome, 'escalate')
  assert.ok(second.message.includes('The next tier is opus'))
  assert.equal(state.tasks['users-pagination'].tier, 'opus')
  assert.ok(state.tasks['users-pagination'].carried.every((note) => note.includes('AssertionError: boom')))
  const timeout = { ...GATE_BASE, status: 'fail', failure: { raw: 'npm test', code: null, timedOut: true, tail: 'hanging', seconds: 300 } }
  const alone = tiers.applyEvent(tiers.emptyState('s'), gateEvent('c', report('implementer', 'sonnet', 'pass'), timeout), routing)
  assert.ok(alone.message.startsWith('cc-tiers gate: users-pagination timed out: npm test after 300 s'))
  assert.equal(alone.meta.reason, 'npm test timed out after 300 s: hanging')
  assert.equal(alone.message.includes('Other open tasks'), false)
})

test('unverified gate keeps the pass and says not validated', () => {
  const state = tiers.emptyState('s')
  const gate = { ...GATE_BASE, status: 'unverified', unverified: [{ raw: 'none - docs only', reason: 'docs only' }] }
  const applied = tiers.applyEvent(state, gateEvent('a', report('implementer', 'sonnet', 'pass', 'skip'), gate), defaultRouting())
  assert.equal(applied.meta.outcome, 'pass')
  assert.ok(applied.message.startsWith('cc-tiers gate: users-pagination not validated: docs only\n'))
  tiers.logReport(state, applied.meta)
  assert.deepEqual(state.log['users-pagination'].verify, { verified: [], flaky: [], unverified: [{ raw: 'none - docs only', reason: 'docs only' }] })
  const passed = { ...GATE_BASE, status: 'pass', verified: ['npm test'], flaky: ['npm test'] }
  const ok = tiers.applyEvent(tiers.emptyState('s'), gateEvent('b', report('implementer', 'sonnet', 'pass', 'skip'), passed), defaultRouting())
  assert.equal(ok.meta.outcome, 'pass')
  assert.ok(ok.message.startsWith('cc-tiers gate: users-pagination verified: npm test\ncc-tiers gate: users-pagination flaky: npm test\n'))
})

test('verify off keeps 0.6 behavior', () => {
  const routing = defaultRouting({ verify: 'off' })
  const applied = apply(tiers.emptyState('s'), routing, 'a', 'implementer', report('implementer', 'sonnet', 'pass', 'skip'))
  assert.equal(applied.meta.outcome, 'pass')
  assert.equal(applied.message.includes('cc-tiers gate'), false)
  assert.equal(applied.meta.gate, undefined)
  const ctx = { routing, projectDir: '/tmp' }
  const prepared = tiers.prepareReport(ctx, tiers.normalizeEvent(event('b', 'implementer', report('implementer', 'sonnet', 'pass'))))
  assert.equal(prepared.gate, undefined)
})

test('prepareReport gates only a writer pass with a slug', () => {
  const ctx = { routing: defaultRouting(), projectDir: '' }
  const prepare = (role, text, payload = {}) => tiers.prepareReport(ctx, tiers.normalizeEvent(event('a', role, text)), payload)
  assert.equal(prepare('implementer', report('implementer', 'sonnet', 'fail')).gate, undefined)
  assert.equal(prepare('reviewer', report('reviewer', 'opus', 'pass')).gate, undefined)
  assert.equal(prepare('implementer', 'CC_TIERS_STATUS: pass').gate, undefined)
  assert.equal(prepare('implementer', report('implementer', 'sonnet', 'pass')).gate.status, 'missing')
  const declared = `${report('implementer', 'sonnet', 'pass')}\nCC_TIERS_VERIFY: npm test`
  const nowhere = prepare('implementer', declared).gate
  assert.equal(nowhere.status, 'unverified')
  assert.deepEqual(nowhere.unverified, [{ raw: '', reason: 'no project dir' }])
  const original = tiers.normalizeEvent(event('a', 'worker', `${report('worker', 'haiku', 'pass')}\nCC_TIERS_VERIFY: none - docs only`))
  const copy = tiers.prepareReport(ctx, original, { cwd: os.tmpdir() })
  assert.equal(original.gate, undefined)
  assert.deepEqual(copy.gate.unverified, [{ raw: 'none - docs only', reason: 'docs only' }])
})

test('prepareReport runs outside the lock', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = path.join(dir, 'project')
    mkdirSync(project)
    writeFileSync(
      path.join(project, 'probe.mjs'),
      "import { existsSync, writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], String(existsSync(process.argv[2])))\n",
    )
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node probe.mjs', CLAUDE_PLUGIN_OPTION_RESEARCH: 'off', CLAUDE_PLUGIN_OPTION_SPECIFY: 'off' })
    const lock = path.join(dir, 'data', 'session-sess-1.json.lock')
    const out = path.join(dir, 'out-fg')
    const raw = event('fg', 'implementer', `${report('implementer', 'sonnet', 'pass', 'skip')}\nCC_TIERS_VERIFY: node probe.mjs ${lock} ${out}`)
    raw.cwd = project
    const proc = runHook('after_agent.mjs', raw, env)
    assert.equal(proc.status, 0, proc.stderr)
    assert.equal(readFileSync(out, 'utf8'), 'false')
    const message = JSON.parse(proc.stdout).hookSpecificOutput.additionalContext
    assert.ok(message.includes(`cc-tiers gate: users-pagination verified: node probe.mjs ${lock} ${out}`))
    let state = JSON.parse(readFileSync(path.join(dir, 'data', 'session-sess-1.json'), 'utf8'))
    assert.deepEqual(state.log['users-pagination'].verify.verified, [`node probe.mjs ${lock} ${out}`])

    const prompt = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nAdd pagination.'
    const launch = runHook(
      'after_agent.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: 'bg1',
        cwd: project,
        tool_input: { subagent_type: 'cc-tiers:implementer', prompt },
        tool_response: { status: 'async_launched', agentId: 'agent-9', prompt },
      },
      env,
    )
    assert.equal(launch.status, 0, launch.stderr)
    const bgOut = path.join(dir, 'out-bg')
    const stop = runHook(
      'subagent_stop.mjs',
      {
        session_id: 'sess-1',
        hook_event_name: 'SubagentStop',
        agent_id: 'agent-9',
        agent_type: 'cc-tiers:implementer',
        cwd: project,
        last_assistant_message: `${report('implementer', 'sonnet', 'pass', 'skip')}\nCC_TIERS_VERIFY: node probe.mjs ${lock} ${bgOut}`,
      },
      env,
    )
    assert.equal(stop.status, 0, stop.stderr)
    assert.equal(readFileSync(bgOut, 'utf8'), 'false')
    state = JSON.parse(readFileSync(path.join(dir, 'data', 'session-sess-1.json'), 'utf8'))
    assert.equal(state.background['agent-9'], undefined)
    assert.ok(state.pending.some((text) => text.includes('cc-tiers gate: users-pagination verified:')))
    assert.equal(readdirSync(path.join(dir, 'data')).some((name) => name.endsWith('.lock') || name.endsWith('.tmp')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('hooks.json gives the gate 660 s', () => {
  const events = JSON.parse(readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8')).hooks
  for (const name of ['PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'Stop']) assert.equal(events[name][0].hooks[0].timeout, 660, name)
  for (const name of ['SessionStart', 'UserPromptSubmit']) assert.equal(events[name][0].hooks[0].timeout, 15, name)
  assert.equal(events.PreToolUse[0].hooks[0].timeout, 15)
})
