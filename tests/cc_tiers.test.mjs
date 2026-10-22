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
    'commands/redo.md',
    'hooks/redo.mjs',
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
  assert.equal(manifest.version, '0.12.0')
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
    assert.ok(text.includes('`CC_TIERS_TIER` and `CC_TIERS_ROLE` lines are optional'), `${file} says only CC_TIERS_TASK is required`)
  }
  const brief = readFileSync(path.join(ROOT, 'agents', 'researcher.md'), 'utf8')
  for (const needle of ['Version and docs:', 'In the repo:', 'Outside the repo:', 'under about 40 lines']) assert.ok(brief.includes(needle), `researcher mentions ${needle}`)
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
  for (const command of ['route.md', 'escalate.md', 'report.md', 'redo.md']) {
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
  assert.equal(events.PreToolUse[0].hooks[0].onFailure, 'block')
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
  // One writer attempt fails once: the second rejection judges a new Opus attempt.
  const retried = apply(first.state, routing, 'a1', 'architect', report('architect', 'opus', 'pass'))
  const second = apply(retried.state, routing, 'r2', 'reviewer', report('reviewer', 'opus', 'fail', '', 'still wrong again'))
  assert.ok(second.message.includes('Opus is the last tier'))
})

test('an unverifiable failure at the attempt limit stops with a partial report instead of escalating', () => {
  const routing = riskyRouting()
  const reason = 'unverifiable: the repo has no test setup for the invoice export'
  const first = apply(tiers.emptyState('sess-1'), routing, 'u1', 'implementer', report('implementer', 'sonnet', 'fail', '', reason))
  assert.equal(first.meta.outcome, 'retry')
  const second = apply(first.state, routing, 'u2', 'implementer', report('implementer', 'sonnet', 'fail', '', reason))
  assert.equal(second.meta.outcome, 'stop')
  assert.equal(second.meta.diagnosis.category, 'unverifiable')
  assert.match(second.message, /The repo cannot exercise this failure, so a stronger tier would not help/)
  assert.match(second.message, /report the task as partial, and name the test setup that is missing/)
  assert.ok(!second.message.includes('next tier is opus'))
  assert.equal(second.state.tasks['users-pagination'].tier, 'sonnet')
  const other = apply(apply(tiers.emptyState('sess-1'), routing, 'c1', 'implementer', report('implementer', 'sonnet', 'fail', '', 'tests fail on the new route')).state, routing, 'c2', 'implementer', report('implementer', 'sonnet', 'fail', '', 'tests fail on the new route'))
  assert.equal(other.meta.outcome, 'escalate', 'any other category still escalates')
})

test('a task moved to a new tier inside a failure keeps its infra skip count', () => {
  const routing = riskyRouting()
  const state = tiers.emptyState('sess-1')
  state.tasks['users-pagination'] = { tier: 'sonnet', failures: ['sonnet/implementer: broke'], carried: [], infra: 2 }
  // An Opus writer attempt on a task the counter still holds at sonnet moves it inside applyFailure.
  const moved = apply(state, routing, 'k1', 'architect', report('architect', 'opus', 'fail', '', 'still wrong'))
  assert.equal(moved.meta.outcome, 'retry')
  assert.equal(moved.state.tasks['users-pagination'].tier, 'opus')
  assert.equal(moved.state.tasks['users-pagination'].infra, 2)
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
  assert.deepEqual([risky.tier, risky.because], ['opus', 'hard'])
  assert.equal(tiers.decideTier('Add pagination to GET /users', routing).because, 'default')
})

test('hard start: a risky task starts on Opus unless the option says sonnet or the budget conserves', () => {
  const routing = defaultRouting()
  assert.equal(routing.hardStart, 'opus')
  const migration = tiers.decideTier('Write a database migration for the users table', routing)
  assert.deepEqual([migration.tier, migration.because, migration.effort], ['opus', 'hard', 'high'])
  const conserved = tiers.decideTier('Write a database migration for the users table', routing, { conserve: true })
  assert.deepEqual([conserved.tier, conserved.because, conserved.effort], ['sonnet', 'budget', 'high'])
  assert.equal(tiers.decideTier('Add pagination to GET /users', routing).tier, 'sonnet')

  const sonnet = defaultRouting({ hard_start: 'sonnet' })
  assert.equal(sonnet.hardStart, 'sonnet')
  assert.deepEqual(
    ['tier', 'because', 'effort'].map((key) => tiers.decideTier('Write a database migration for the users table', sonnet)[key]),
    ['sonnet', 'default', 'xhigh'],
  )
  const rename = tiers.decideTier('Rename the users column and migrate the data', sonnet)
  assert.deepEqual([rename.tier, rename.because], ['sonnet', 'risky'])
  assert.equal(defaultRouting({ hard_start: 'bogus' }).hardStart, 'opus')
  assert.equal(tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_HARD_START: 'sonnet' }).hard_start, 'sonnet')
  assert.equal(tiers.userFromEnv({}).hard_start, null)

  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const option = manifest.userConfig.hard_start
  assert.equal(option.type, 'string')
  assert.deepEqual(option.options, ['opus', 'sonnet'])
  assert.equal(option.default, 'opus')
  assert.equal(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')).hardStart, 'opus')

  const text = tiers.formatSessionContext(routing, 'not present', { ccCost: { installed: false } })
  assert.ok(text.includes('Hard start: opus'))
  assert.ok(tiers.formatSessionContext(sonnet, 'not present', { ccCost: { installed: false } }).includes('Hard start: sonnet'))

  const state = tiers.emptyState('s')
  const prompt = 'CC_TIERS_TASK: users-migration\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\nWrite a database migration for the users table'
  const hint = tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  assert.equal(hint.deny, '')
  assert.ok(hint.context.includes('looks like Opus work'))
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt }, sonnet).context.includes('Opus work'), false)
})

test('CC_TIERS_RISK: none with a reason waives a keyword that is only text, and the report is still checked', () => {
  const routing = defaultRouting({ verify: 'off' })
  const header = 'CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\n'
  const task = 'Fix the off-by-one in the users list. Do not stash, reset or checkout.'
  assert.equal(tiers.isRisky(`${header}${task}`, routing), true)
  const waived = `${header}CC_TIERS_RISK: none - checkout is a git command here\n${task}`
  assert.equal(tiers.isRisky(waived, routing), false)
  assert.deepEqual([tiers.decideTier(waived, routing).tier, tiers.decideTier(waived, routing).effort], ['sonnet', 'high'])
  const call = tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: waived }, routing)
  assert.equal(call.context.includes('Opus work'), false)
  assert.equal(call.input, null)
  assert.equal(tiers.checkDelegation(tiers.emptyState('s'), { subagent_type: 'cc-tiers:implementer', prompt: `${header}${task}` }, routing).input.effort, 'xhigh')
  assert.equal(tiers.isRisky(`${header}CC_TIERS_RISK: none\n${task}`, routing), true)
  assert.equal(tiers.isRisky(`${header}CC_TIERS_RISK: None - git command\n${task}`, routing), false)
  assert.equal(tiers.isRisky(`${header}CC_TIERS_RISK: NONE - git command\n${task}`, routing), false)

  const cheap = defaultRouting({ review_policy: 'cheap', verify: 'off' })
  const plain = apply(tiers.emptyState('s'), cheap, 't1', 'implementer', report('implementer', 'sonnet', 'pass', 'pending', 'done'), waived)
  assert.ok(plain.message.includes('no review is due'))
  const touched = apply(tiers.emptyState('s'), cheap, 't2', 'implementer', `Changed the checkout total in src/cart.js.\n${report('implementer', 'sonnet', 'pass', 'pending', 'done')}`, waived)
  assert.ok(touched.message.includes('cc-tiers:reviewer (Opus)'))
  const echoed = `Changed the checkout total in src/cart.js.\nCC_TIERS_RISK: none - echoed\n${report('implementer', 'sonnet', 'pass', 'pending', 'done')}`
  assert.ok(apply(tiers.emptyState('s'), cheap, 't3', 'implementer', echoed, waived).message.includes('cc-tiers:reviewer (Opus)'))
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

  // b names no files, so c would wait for it; its report releases it.
  assert.match(tiers.checkDelegation(state, { subagent_type: 'cc-tiers:worker', prompt: `${header('c', 'haiku', 'worker')}Rename the login handler` }, routing).deny, /unknown scope/)
  state.active = {}
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

const HANDBACK = (message) => ({ type: 'tool_use', name: 'SubagentHandback', input: { message } })
const HANDBACK_RESULT = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"success":true,"message":"Report delivered to your caller."}' }] }] },
})

test('the last SubagentHandback report is read from a subagent transcript', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const file = path.join(dir, 'agent.jsonl')
    writeFileSync(
      file,
      [
        assistantRow('claude-sonnet-4-5', {}, [HANDBACK('first draft')], { id: 'h1' }),
        'not json',
        assistantRow('claude-sonnet-4-5', {}, [{ type: 'text', text: 'between' }], { id: 'h2' }),
        assistantRow('claude-sonnet-4-5', {}, [HANDBACK('final report')], { id: 'h3' }),
        HANDBACK_RESULT,
      ].join('\n'),
    )
    assert.equal(tiers.agentHandbackReport(file), 'final report')
    assert.equal(tiers.agentHandbackReport(path.join(dir, 'missing.jsonl')), '')
    assert.equal(tiers.agentHandbackReport(undefined), '')
    writeFileSync(file, `${assistantRow('claude-sonnet-4-5', {}, [{ type: 'text', text: 'no handback' }], { id: 'h4' })}\n`)
    assert.equal(tiers.agentHandbackReport(file), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a background report delivered through SubagentHandback is counted at SubagentStop', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const env = hookEnv(dir)
    const launch = (role, id, task = 'users-pagination') => {
      const prompt = `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: ${role}\nWork.`
      runHook(
        'after_agent.mjs',
        {
          session_id: 'sess-1',
          hook_event_name: 'PostToolUse',
          tool_name: 'Agent',
          tool_use_id: `bg-${id}`,
          tool_input: { subagent_type: `cc-tiers:${role}`, prompt },
          tool_response: { status: 'async_launched', agentId: id, prompt },
        },
        env,
      )
    }
    const stop = (role, id, message, last = '') => {
      const file = path.join(dir, `${id}.jsonl`)
      writeFileSync(file, [assistantRow('claude-sonnet-4-5', { input_tokens: 40 }, [HANDBACK(message)], { id: `m-${id}` }), HANDBACK_RESULT].join('\n'))
      return runHook(
        'subagent_stop.mjs',
        { session_id: 'sess-1', hook_event_name: 'SubagentStop', agent_id: id, agent_type: `cc-tiers:${role}`, agent_transcript_path: file, last_assistant_message: last },
        env,
      )
    }

    launch('implementer', 'agent-f')
    assert.equal(stop('implementer', 'agent-f', report('implementer', 'sonnet', 'fail', '', 'cursor off by one')).status, 0)
    const end = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false }, env)
    const decision = JSON.parse(end.stdout)
    assert.equal(decision.decision, 'block')
    assert.ok(decision.reason.includes('Retry on sonnet'))
    assert.ok(!decision.reason.includes('without CC_TIERS_STATUS'))

    launch('researcher', 'agent-p')
    assert.equal(stop('researcher', 'agent-p', 'brief\nCC_TIERS_STATUS: pass').status, 0)
    const file = tiers.sessionPath(path.join(dir, 'data'), 'sess-1')
    assert.deepEqual(tiers.loadState(file, 'sess-1').researched, { 'users-pagination': true })

    // A last message that carries the trailer wins over the transcript.
    launch('researcher', 'agent-w', 'csv')
    stop('researcher', 'agent-w', 'brief\nCC_TIERS_STATUS: fail', 'CC_TIERS_TASK: csv\nCC_TIERS_ROLE: researcher\nCC_TIERS_STATUS: pass')
    assert.deepEqual(tiers.loadState(file, 'sess-1').researched, { 'users-pagination': true, csv: true })
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
    assert.equal(decision.tier, 'opus')
    assert.equal(decision.because, 'hard')
    assert.equal(decision.risky, true)
    assert.equal(decision.review, 'reviewer')
    assert.equal(tiers.pluginRoot({}), ROOT)
    const sonnet = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'route.mjs')], {
      input: 'Add a database migration for invoices',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '', CLAUDE_PROJECT_DIR: dir, HOME: path.join(dir, 'home'), CLAUDE_PLUGIN_OPTION_HARD_START: 'sonnet' },
    })
    assert.equal(JSON.parse(sonnet.stdout).tier, 'sonnet')
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
  const small = tiers.lightHint('Add pagination to GET /users', routing)
  assert.ok(small.includes('cc-tiers small path'))
  assert.ok(small.includes('do it yourself in this session'))
  assert.ok(!small.includes('cc-tiers:implementer'))
  for (const note of [tiers.lightHint('Add pagination to GET /users', delegate), tiers.lightHint('Add pagination to GET /users', routing, { conserve: true })]) {
    assert.ok(note.includes('cc-tiers small path'))
    assert.ok(note.includes('send it to cc-tiers:implementer in one call'))
    for (const needle of ['CC_TIERS_SPEC_BEGIN', 'CC_TIERS_RESEARCH: none', 'CC_TIERS_REVIEW: skip']) assert.ok(note.includes(needle))
    assert.ok(!note.includes('do it yourself'))
  }
  assert.equal(tiers.lightHint('CC_TIERS_TASK: users-pagination\nAdd pagination to GET /users', routing), '')
  assert.equal(tiers.lightHint('Add pagination to GET /users', defaultRouting({ light_path: 'off' })), '')
  assert.equal(tiers.lightHint(`Add pagination to GET /users ${'and more '.repeat(20)}`, routing), '')
  assert.equal(tiers.lightHint('Rename the login handler', routing, { conserve: true }), '')
  assert.equal(tiers.lightHint('change the login error message', routing), '')
  const sonnetStart = defaultRouting({ hard_start: 'sonnet' })
  assert.equal(tiers.lightHint('change the login error message', sonnetStart), '')
  assert.equal(tiers.lightHint('change the login error message', sonnetStart, { conserve: true }), '')
  assert.equal(tiers.lightHint('Rename fetchUser and then update the docs', routing), '')
  assert.equal(tiers.lightHint('Rename the login handler', routing), '')
  assert.equal(tiers.lightHint('/cc-tiers:route fix a typo', routing), '')
  assert.equal(tiers.lightHint('fix a typo in README', defaultRouting({ light_path: 'off' })), '')
  const history = tiers.noteHaikuFailure(tiers.emptyHistory(), { task: 'readme-typo', prompt: 'fix a typo in README', reason: 'missed one', now: '2026-10-19T12:00:00.000Z' })
  assert.equal(tiers.decideTier('fix a typo in README', routing, { history }).because, 'history')
  assert.ok(tiers.lightHint('fix a typo in README', routing, { history }).includes('cc-tiers small path'))
  const opusPhrase = 'cross-cutting work the orchestrator cannot hand off cleanly'
  assert.equal(tiers.decideTier(opusPhrase, routing, { conserve: true }).because, 'budget')
  assert.equal(tiers.lightHint(opusPhrase, routing, { conserve: true }), '')
  const context = (user) => tiers.formatSessionContext(defaultRouting(user), 'not present', { ccCost: { installed: false } })
  assert.ok(context({}).includes('When a request is one small change, cc-tiers says so too'))
  assert.ok(context({ light_path: 'delegate' }).includes('When a request is one small change: one cc-tiers:implementer call'))
})

test('every light-path note tells the session to answer a request that only asks for an answer', () => {
  const routing = defaultRouting()
  const delegate = defaultRouting({ light_path: 'delegate' })
  const answer = 'If it only asks for an answer, an explanation, a study or an opinion and changes nothing, answer it in this session: no slug, no spec, no implementer.'
  for (const ask of ['e o Muster', 'estude o CodeShell e veja se tem algo que podemos consumir', 'how does the verify gate work?', 'fix a typo in README', 'where is fetchUser defined?', 'Add pagination to GET /users']) {
    for (const note of [tiers.lightHint(ask, routing), tiers.lightHint(ask, delegate), tiers.lightHint(ask, routing, { conserve: true })]) {
      if (note) assert.ok(note.endsWith(answer), ask)
      assert.ok(!note.includes('direct path'), 'no keyword list decides that a request is a question')
    }
  }
})

test('the light path keeps the small and trivial notes for a change request, however it is phrased', () => {
  const routing = defaultRouting()
  const delegate = defaultRouting({ light_path: 'delegate' })
  const small = (note) => note.startsWith('cc-tiers small path: this request looks like one small change.')
  assert.ok(tiers.lightHint('Vamos fazer a Prioridade 1', routing).includes('cc-tiers small path'))
  assert.ok(tiers.lightHint('Add pagination to GET /users', routing).includes('cc-tiers small path'))
  assert.ok(tiers.lightHint('fix a typo in README', routing).includes('cc-tiers light path'))
  // A question mark or a study word never changes the routing note of a change request.
  for (const change of [
    'corrige isso?',
    'arruma o teste que quebrou?',
    'ajusta o layout do header?',
    'muda a cor do botão?',
    'commita isso?',
    'pode subir a versão?',
    'pode commitar, pushar e montar a release?',
    'analise o erro e ajuste o código',
    'revise o PR e mescle',
    'veja se o teste passa e conserta',
    'can you make the button blue?',
    'can you bump the version to 1.2?',
    'make the tests pass?',
    'should we move the helper to utils? do it',
  ]) {
    for (const note of [tiers.lightHint(change, routing), tiers.lightHint(change, delegate), tiers.lightHint(change, routing, { conserve: true })]) {
      assert.ok(small(note), change)
    }
  }
  assert.equal(tiers.lightHint('coloca um log no login?', routing), '', 'a request the small path never took stays empty')
  for (const change of ['Estude a lib zod e migre a validação do formulário de cadastro para ela', 'Which file has the bug? Clean it up.', 'por que esse teste falha? deixa ele verde', 'when you get a chance, convert the config to yaml']) {
    const note = tiers.lightHint(change, routing)
    assert.ok(note === '' || note.startsWith('cc-tiers small path') || note.startsWith('cc-tiers light path'), change)
  }
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
    const small = runHook('stop.mjs', { session_id: 'sess-2', hook_event_name: 'UserPromptSubmit', prompt: 'Add pagination to GET /users' }, env)
    assert.ok(JSON.parse(small.stdout).hookSpecificOutput.additionalContext.includes('cc-tiers small path'))
    const plain = runHook('stop.mjs', { session_id: 'sess-2', hook_event_name: 'UserPromptSubmit', prompt: 'Rename the login handler' }, env)
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
    assert.ok(proc.stdout.includes('| users-pagination | sonnet | 2 | 0 | sonnet xhigh | — | — | done on sonnet | $0.014 |'))
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

test('the tree check is skipped while another non-isolated writer shares the tree', async () => {
  const { registerActive } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'parallel.mjs')).href)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-tree-'))
  try {
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' })
    git('init', '-q')
    writeFileSync(path.join(dir, 'writes.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('made.txt', 'x')\n")
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    const routing = { ...defaultRouting({ specify: 'off' }), verifyAllow: [['node', 'writes.mjs']] }
    const ctx = { routing, projectDir: dir }
    const text = `${report('implementer', 'sonnet', 'pass', 'skip')}\nCC_TIERS_VERIFY: node writes.mjs`
    const run = (others) => {
      rmSync(path.join(dir, 'made.txt'), { force: true })
      const state = tiers.emptyState('s')
      registerActive(state, { task: 'users-pagination', role: 'implementer', files: [] })
      for (const [task, isolated] of Object.entries(others)) registerActive(state, { task, role: 'implementer', files: [], isolated })
      const normalized = tiers.normalizeEvent(event('w', 'implementer', text))
      const peek = tiers.peekFor(state, normalized)
      const prepared = tiers.prepareReport(ctx, normalized, {}, { peek })
      return { peek, gate: prepared.gate, message: tiers.applyEvent(state, prepared, routing).message }
    }

    const alone = run({})
    assert.deepEqual(alone.peek.writing, [], 'the reporting task itself is not another writer')
    assert.equal(alone.gate.status, 'unverified')
    assert.equal(alone.gate.unverified[0].reason, 'changed the tree: made.txt')
    assert.equal(alone.gate.treeCheck, undefined)

    const isolated = run({ 'in-worktree': true })
    assert.deepEqual(isolated.peek.writing, [])
    assert.equal(isolated.gate.unverified[0].reason, 'changed the tree: made.txt')

    const shared = run({ 'in-worktree': true, 'other-writer': false, 'third-writer': false })
    assert.deepEqual(shared.peek.writing, ['other-writer', 'third-writer'])
    assert.equal(shared.gate.status, 'pass')
    assert.deepEqual(shared.gate.verified, ['node writes.mjs'])
    assert.equal(shared.gate.treeCheck, 'skipped: other-writer, third-writer still writing')
    assert.match(shared.message, /cc-tiers gate: users-pagination tree check skipped: other-writer, third-writer still writing in this tree/)

    const stale = tiers.emptyState('s')
    registerActive(stale, { task: 'gone', role: 'implementer', files: [], now: Date.now() - 3 * 60 * 60 * 1000 })
    assert.deepEqual(tiers.peekFor(stale, tiers.normalizeEvent(event('w', 'implementer', text))).writing, [], 'a stale entry is not a writer')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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

const CEILING = (status, extra = '') =>
  `CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: opus\nCC_TIERS_ROLE: orchestrator\nCC_TIERS_STATUS: ${status}\nCC_TIERS_REVIEW: skip\nCC_TIERS_REASON: done${extra}`

test('a ceiling pass waits for the Stop gate', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const transcript = path.join(dir, 'main.jsonl')
    const row = assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: CEILING('pass', '\nCC_TIERS_VERIFY: npm test') }], { id: 'm1', uuid: 'u1' })
    writeFileSync(transcript, `${row}\n`)
    const ctx = { routing: defaultRouting(), file: path.join(dir, 'data', 'session-s.json'), sessionId: 's', env: {}, projectDir: '', ccCost: false }
    let state = tiers.withSession(ctx, { transcript_path: transcript }, (s) => s)
    assert.equal(state.log['users-pagination'], undefined)
    assert.equal(state.pending.length, 0)
    assert.deepEqual(state.awaiting, [{ id: 'row:u1', role: 'orchestrator', text: CEILING('pass', '\nCC_TIERS_VERIFY: npm test') }])
    // A later scan of the same rows does not park the report twice.
    tiers.withSession(ctx, { transcript_path: transcript }, (s) => {
      s.cursor.offset = 0
    })
    state = tiers.withSession(ctx, { transcript_path: transcript }, (s) => s)
    // Reading the parked list leaves it parked, so a Stop killed mid-gate loses nothing.
    const parked = tiers.peekAwaiting(state)
    assert.equal(parked.length, 1)
    assert.equal(state.awaiting.length, 1)
    // Only the ids the Stop counted leave; one parked meanwhile stays.
    state.awaiting.push({ id: 'row:later', role: 'orchestrator', text: CEILING('pass') })
    tiers.dropAwaiting(state, [parked[0].id])
    assert.deepEqual(state.awaiting.map((item) => item.id), ['row:later'])
    tiers.dropAwaiting(state, ['row:later'])
    // Once gated and counted, the same id is a duplicate.
    const prepared = { kind: 'report', id: parked[0].id, role: parked[0].role, prompt: '', text: parked[0].text, gate: { status: 'pass', verified: ['npm test'], flaky: [], unverified: [], failure: null } }
    assert.ok(tiers.processReport(ctx, state, prepared).includes('cc-tiers gate: users-pagination verified: npm test'))
    assert.equal(tiers.processReport(ctx, state, prepared), '')
    // A session-role pass without a gate still counts as before (only parking keeps it from arriving ungated).
    const plain = tiers.applyEvent(tiers.emptyState('s'), { kind: 'report', id: 'row:u2', role: 'dispatcher', prompt: '', text: CEILING('pass') }, defaultRouting())
    assert.equal(plain.meta.outcome, 'pass')
    assert.equal(plain.message.includes('cc-tiers gate'), false)
    const off = tiers.withSession({ ...ctx, file: null, routing: defaultRouting({ verify: 'off' }) }, { transcript_path: transcript }, (s) => s)
    assert.equal((off.awaiting || []).length, 0)
    assert.equal(off.log['users-pagination'].attempts, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parked reports of one Stop share one verify budget', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = ceilingProject(dir)
    const ctx = { routing: defaultRouting({ verify_allow: 'node fail.mjs', verify_budget: 30 }), projectDir: project }
    const parked = ['a', 'b'].map((id) => ({ id: `row:${id}`, role: 'orchestrator', text: CEILING('pass', '\nCC_TIERS_VERIFY: node fail.mjs') }))
    // The first report takes the whole budget by the clock; the second gets nothing left.
    const clock = [0, 0, 31000]
    const [first, second] = tiers.prepareParked(ctx, parked, {}, { now: () => clock.shift() ?? 31000 })
    assert.equal(first.id, 'row:a')
    assert.equal(first.gate.status, 'fail')
    assert.equal(second.gate.status, 'unverified')
    assert.deepEqual(second.gate.unverified, [{ raw: 'node fail.mjs', reason: 'budget exhausted: node fail.mjs' }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function ceilingProject(dir) {
  const project = path.join(dir, 'project')
  mkdirSync(project)
  writeFileSync(path.join(project, 'fail.mjs'), "console.log('cursor test red')\nprocess.exit(1)\n")
  writeFileSync(
    path.join(project, 'probe.mjs'),
    "import { existsSync, writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[3], String(existsSync(process.argv[2])))\n",
  )
  return project
}

test('Stop verifies the ceiling and blocks once on failure', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = ceilingProject(dir)
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node fail.mjs' })
    const transcript = path.join(dir, 'main.jsonl')
    const row = assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: CEILING('pass', '\nCC_TIERS_VERIFY: node fail.mjs') }], { id: 'm1', uuid: 'u1' })
    writeFileSync(transcript, `${row}\n`)
    const submit = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'go on', transcript_path: transcript, cwd: project }, env)
    assert.equal(submit.status, 0, submit.stderr)
    assert.equal(submit.stdout.includes('cc-tiers gate'), false)
    const payload = { session_id: 'sess-1', hook_event_name: 'Stop', transcript_path: transcript, cwd: project, stop_hook_active: false }
    const proc = runHook('stop.mjs', payload, env)
    assert.equal(proc.status, 0, proc.stderr)
    const out = JSON.parse(proc.stdout)
    assert.equal(out.decision, 'block')
    assert.ok(out.reason.includes('cc-tiers gate: users-pagination failed: node fail.mjs (exit 1)'), out.reason)
    const state = JSON.parse(readFileSync(path.join(dir, 'data', 'session-sess-1.json'), 'utf8'))
    assert.deepEqual(state.awaiting, [])
    assert.equal(state.log['users-pagination'].attempts, 1)
    assert.equal(state.tasks['users-pagination'].failures.length, 1)
    assert.equal(runHook('stop.mjs', { ...payload, stop_hook_active: true }, env).stdout, '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Stop skips the tree check while a background writer still runs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = ceilingProject(dir)
    writeFileSync(path.join(project, 'writes.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('made.txt', 'x')\n")
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: project, encoding: 'utf8' })
    git('init', '-q')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node writes.mjs' })
    const transcript = path.join(dir, 'main.jsonl')
    const row = assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: CEILING('pass', '\nCC_TIERS_VERIFY: node writes.mjs') }], { id: 'm1', uuid: 'u1' })
    writeFileSync(transcript, `${row}\n`)
    const stop = (session, background) => {
      rmSync(path.join(project, 'made.txt'), { force: true })
      const state = tiers.emptyState(session)
      if (background) {
        state.active = { 'bg-writer': { role: 'implementer', files: ['src/x.js'], isolated: false, since: Date.now() } }
        state.background = { 'agent-7': { role: 'implementer', prompt: 'CC_TIERS_TASK: bg-writer\nCC_TIERS_ROLE: implementer\nEdit src/x.js.', tool_use_id: 'bg7' } }
      }
      mkdirSync(path.join(dir, 'data'), { recursive: true })
      writeFileSync(path.join(dir, 'data', `session-${session}.json`), JSON.stringify(state))
      const proc = runHook('stop.mjs', { session_id: session, hook_event_name: 'Stop', transcript_path: transcript, cwd: project, stop_hook_active: true }, env)
      assert.equal(proc.status, 0, proc.stderr)
      return JSON.parse(proc.stdout).systemMessage
    }

    const idle = stop('idle', false)
    assert.ok(idle.includes('cc-tiers gate: users-pagination not validated: changed the tree: made.txt'), idle)
    const busy = stop('busy', true)
    assert.ok(busy.includes('cc-tiers gate: users-pagination verified: node writes.mjs'), busy)
    assert.ok(busy.includes('cc-tiers gate: users-pagination tree check skipped: bg-writer still writing in this tree'), busy)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a passing ceiling gate clears the counter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-'))
  try {
    const project = ceilingProject(dir)
    const env = hookEnv(dir, { CC_TIERS_CC_COST: '0', CLAUDE_PLUGIN_OPTION_VERIFY_ALLOW: 'node probe.mjs' })
    const lock = path.join(dir, 'data', 'session-sess-1.json.lock')
    const probe = path.join(dir, 'out')
    const transcript = path.join(dir, 'main.jsonl')
    writeFileSync(
      transcript,
      [
        assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: CEILING('fail') }], { id: 'm1', uuid: 'u1' }),
        assistantRow('claude-opus-4-5', { input_tokens: 5 }, [{ type: 'text', text: CEILING('pass', `\nCC_TIERS_VERIFY: node probe.mjs ${lock} ${probe}`) }], { id: 'm2', uuid: 'u2' }),
      ].join('\n') + '\n',
    )
    const proc = runHook('stop.mjs', { session_id: 'sess-1', hook_event_name: 'Stop', transcript_path: transcript, cwd: project, stop_hook_active: true }, env)
    assert.equal(proc.status, 0, proc.stderr)
    assert.equal(readFileSync(probe, 'utf8'), 'false')
    const message = JSON.parse(proc.stdout).systemMessage
    assert.ok(message.includes(`cc-tiers gate: users-pagination verified: node probe.mjs ${lock} ${probe}`), message)
    assert.ok(message.includes('cleared its attempt counter'))
    const state = JSON.parse(readFileSync(path.join(dir, 'data', 'session-sess-1.json'), 'utf8'))
    assert.equal(state.tasks['users-pagination'], undefined)
    assert.equal(state.log['users-pagination'].attempts, 2)
    assert.deepEqual(state.awaiting, [])
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

function findingBlock(fields) {
  const base = { category: 'correctness', severity: 'blocking', evidence: 'trace', where: 'src/a.js:1', expected: 'closed', observed: 'stays open' }
  return ['CC_TIERS_FINDING_BEGIN', ...Object.entries({ ...base, ...fields }).map(([key, value]) => `${key}: ${value}`), 'CC_TIERS_FINDING_END'].join('\n')
}

const SPEC_PROMPT = 'Review it.\nCC_TIERS_SPEC_BEGIN\nCriteria:\n- the slot is freed\nCC_TIERS_SPEC_END'

/** prepareReport then applyEvent on a task already waiting for review, like the entrypoints do. */
async function reviewFlow(role, text, { prompt = '', routing = defaultRouting({ specify: 'off', verify: 'off' }), probes = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-review-'))
  try {
    for (const [name, code] of Object.entries(probes)) writeFileSync(path.join(dir, name), `process.exit(${code})\n`)
    const ctx = { routing: { ...routing, verifyAllow: [['node', 'ok.mjs'], ['node', 'bad.mjs']] }, projectDir: dir }
    const state = tiers.emptyState('s')
    state.tasks = { 'users-pagination': { tier: 'sonnet', failures: [], carried: [] } }
    const prepared = tiers.prepareReport(ctx, tiers.normalizeEvent(event('r', role, text, prompt)))
    return { prepared, applied: tiers.applyEvent(state, prepared, ctx.routing) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('specText returns the first spec block', () => {
  assert.equal(tiers.specText(SPEC_PROMPT), 'Criteria:\n- the slot is freed')
  assert.equal(tiers.specText('no block here'), '')
})

test('review fail without evidence is approved with notes', async () => {
  const text = `${report('reviewer', 'sonnet', 'fail', '', 'looks wrong')}\n${findingBlock({ evidence: 'trace', observed: '' })}\n${findingBlock({ severity: 'note', where: 'src/n.js:2' })}`
  const { applied } = await reviewFlow('reviewer', text)
  assert.equal(applied.meta.outcome, 'pass')
  assert.equal(applied.state.tasks['users-pagination'], undefined)
  assert.match(applied.message, /^cc-tiers review: users-pagination rejected without evidence; 2 finding\(s\) became notes\n/)
  assert.match(applied.message, /Notes:\n- correctness @ src\/n\.js:2/)
  assert.match(applied.message, /passed Opus review/)
  assert.deepEqual(applied.meta.review, { blocking: 0, discarded: 0, notes: 1, invalid: 1 })
  const bare = await reviewFlow('reviewer', report('reviewer', 'sonnet', 'fail', '', 'no idea'))
  assert.equal(bare.applied.meta.outcome, 'pass')
  assert.match(bare.applied.message, /rejected without evidence; 0 finding\(s\) became notes/)
})

test('review fail with a failing evidence command counts against the writer tier', async () => {
  const text = `${report('reviewer', 'sonnet', 'fail', '', 'broken')}\n${findingBlock({ evidence: 'command', command: 'node bad.mjs' })}`
  const { applied } = await reviewFlow('reviewer', text, { probes: { 'bad.mjs': 1 } })
  assert.equal(applied.meta.outcome, 'retry')
  assert.deepEqual(applied.meta.review, { blocking: 1, discarded: 0, notes: 0, invalid: 0 })
  assert.deepEqual(applied.state.tasks['users-pagination'].failures, ['sonnet/reviewer: correctness @ src/a.js:1: closed / stays open'])
  const many = `${text}\n${findingBlock({ where: 'src/b.js:2' })}`
  const two = await reviewFlow('reviewer', many, { probes: { 'bad.mjs': 1 } })
  const failure = two.applied.state.tasks['users-pagination'].failures[0]
  assert.match(failure, /^sonnet\/reviewer: correctness @ src\/a\.js:1: closed \/ stays open \(\+1 more\)\ncorrectness @ src\/a\.js:1: .*\ncorrectness @ src\/b\.js:2: /)
})

test('discarded finding is reported', async () => {
  const text = `${report('reviewer', 'sonnet', 'fail', '', 'broken')}\n${findingBlock({ evidence: 'command', command: 'node ok.mjs' })}`
  const { applied } = await reviewFlow('reviewer', text, { probes: { 'ok.mjs': 0 } })
  assert.equal(applied.meta.outcome, 'pass')
  assert.match(applied.message, /^cc-tiers review: users-pagination discarded 1 finding\(s\): the evidence command passed\ncc-tiers review: users-pagination rejected without evidence; 1 finding\(s\) became notes\n/)
  assert.equal(applied.meta.review.discarded, 1)
})

test('coverage finding counts only with the criterion in the spec block', async () => {
  const finding = findingBlock({ evidence: 'coverage', criterion: 'the slot is freed', expected: '', observed: '' })
  const text = `${report('reviewer', 'sonnet', 'fail', '', 'gap')}\n${finding}`
  const listed = await reviewFlow('reviewer', text, { prompt: SPEC_PROMPT })
  assert.equal(listed.applied.meta.outcome, 'retry')
  const unlisted = await reviewFlow('reviewer', text.replace('the slot is freed', 'something else'), { prompt: SPEC_PROMPT })
  assert.equal(unlisted.applied.meta.outcome, 'pass')
  const noSpec = await reviewFlow('reviewer', text)
  assert.equal(noSpec.applied.meta.outcome, 'pass')
})

test('checker follows the same rule', async () => {
  const none = await reviewFlow('checker', report('checker', 'haiku', 'fail', '', 'nope'))
  assert.equal(none.applied.meta.outcome, 'pass')
  assert.match(none.applied.message, /passed Sonnet review/)
  const blocking = await reviewFlow('checker', `${report('checker', 'haiku', 'fail', '', 'nope')}\n${findingBlock({})}`)
  assert.equal(blocking.applied.meta.outcome, 'retry')
})

test('review pass keeps its note findings', async () => {
  const text = `${report('reviewer', 'sonnet', 'pass')}\n${findingBlock({ severity: 'note', where: 'src/n.js:2' })}\n${findingBlock({ where: 'src/b.js:1' })}`
  const { applied } = await reviewFlow('reviewer', text)
  assert.equal(applied.meta.outcome, 'pass')
  assert.doesNotMatch(applied.message, /rejected without evidence/)
  assert.match(applied.message, /^Notes:\n- correctness @ src\/n\.js:2\n/)
  assert.deepEqual(applied.meta.review, { blocking: 0, discarded: 0, notes: 1, invalid: 0 })
})

test('review_evidence off keeps 0.6 behavior', async () => {
  const routing = defaultRouting({ specify: 'off', verify: 'off', review_evidence: 'off' })
  const text = `${report('reviewer', 'sonnet', 'fail', '', 'cursor is not validated')}\n${findingBlock({ severity: 'note' })}`
  const { prepared, applied } = await reviewFlow('reviewer', text, { routing })
  assert.equal(prepared.judged, undefined)
  assert.equal(applied.meta.outcome, 'retry')
  assert.equal(applied.meta.review, undefined)
  assert.equal(applied.message.includes('cc-tiers review'), false)
})

test('contract_approval defaults to critical and comes from /config, env and the project file', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  assert.equal(defaultRouting().contractApproval, 'critical')
  assert.equal(defaultRouting({ contract_approval: 'high' }).contractApproval, 'high')
  assert.equal(defaultRouting({ contract_approval: 'off' }).contractApproval, 'off')
  assert.equal(defaultRouting({ contract_approval: 'bogus' }).contractApproval, 'critical')
  assert.equal(tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_CONTRACT_APPROVAL: 'off' }).contract_approval, 'off')
  assert.equal(tiers.userFromEnv({}).contract_approval, null)
  assert.equal(tiers.mergeRouting(defaults, null, tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_CONTRACT_APPROVAL: 'high' })).contractApproval, 'high')
  assert.equal(tiers.mergeRouting(defaults, { contractApproval: 'off' }).contractApproval, 'off')
  assert.equal(tiers.mergeRouting(defaults, { contractApproval: 'off' }, { contract_approval: 'high' }).contractApproval, 'high')
  assert.equal(tiers.mergeRouting(defaults, { contractApproval: 'bogus' }).contractApproval, 'critical')
})

test('manifest declares contract_approval', () => {
  const option = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).userConfig.contract_approval
  assert.equal(option.type, 'string')
  assert.deepEqual(option.options, ['critical', 'high', 'off'])
  assert.equal(option.default, 'critical')
  assert.ok(option.title && option.description)
})

const PREEXISTING_GATE = { ...GATE_BASE, status: 'fail', preexisting: { raw: 'npm test', code: 1, timedOut: false, tail: 'AssertionError: boom', seconds: 3 } }
const preexistingReport = (declaration) => `${report('implementer', 'sonnet', 'pass')}\nCC_TIERS_VERIFY: npm test\n${declaration}`

test('a failure the writer declares pre-existing is not counted once, and goes to an Opus review', () => {
  const state = tiers.emptyState('s')
  const text = preexistingReport('CC_TIERS_PREEXISTING: npm test - fails on main too, see the CI run')
  const applied = tiers.applyEvent(state, gateEvent('a', text, PREEXISTING_GATE), defaultRouting())
  assert.equal(applied.meta.outcome, 'review')
  assert.equal(applied.message, 'cc-tiers gate: users-pagination failed: npm test (exit 1)\n' +
    'users-pagination: `npm test` failed, and the writer declares it fails without this change too (fails on main too, see the CI run). ' +
    'Not counted as a failure (1 of 1). Send it to cc-tiers:reviewer (Opus): the review must confirm the failure exists without this change; a review that cannot confirm it rejects.')
  const entry = state.tasks['users-pagination']
  assert.equal(entry.preexisting, 1)
  assert.deepEqual(entry.failures, [])
  assert.equal(applied.meta.floor, 'its failing check was declared pre-existing and a review must confirm it')
  assert.deepEqual(state.evidence['users-pagination'].preexisting, { command: 'npm test', evidence: 'fails on main too, see the CI run' })
})

test('a second, mismatched, empty or unreviewable pre-existing declaration counts the failure as today', () => {
  const routing = defaultRouting()
  const declared = preexistingReport('CC_TIERS_PREEXISTING: npm test - fails on main too')
  const state = tiers.emptyState('s')
  assert.equal(tiers.applyEvent(state, gateEvent('a', declared, PREEXISTING_GATE), routing).meta.outcome, 'review')
  const second = tiers.applyEvent(state, gateEvent('b', declared, PREEXISTING_GATE), routing)
  assert.equal(second.meta.outcome, 'retry')
  assert.equal(state.tasks['users-pagination'].failures.length, 1)
  for (const declaration of ['CC_TIERS_PREEXISTING: npm run lint - fails on main too', 'CC_TIERS_PREEXISTING: npm test -', 'CC_TIERS_PREEXISTING: npm test', 'CC_TIERS_PREEXISTING: npm testing - fails on main too']) {
    const fresh = tiers.emptyState('s')
    const applied = tiers.applyEvent(fresh, gateEvent('c', preexistingReport(declaration), PREEXISTING_GATE), routing)
    assert.equal(applied.meta.outcome, 'retry', declaration)
    assert.equal(fresh.tasks['users-pagination'].failures.length, 1, declaration)
    assert.equal(fresh.tasks['users-pagination'].preexisting, undefined, declaration)
  }
  const never = defaultRouting({ review_policy: 'never' })
  const closed = tiers.applyEvent(tiers.emptyState('s'), gateEvent('d', declared, PREEXISTING_GATE), never)
  assert.equal(closed.meta.outcome, 'retry', 'no review can confirm it, so the hatch stays closed')
})

test('the pre-existing hatch stays closed while another command did not run and pass', () => {
  const declared = preexistingReport('CC_TIERS_PREEXISTING: npm test - fails on main too')
  const skipped = { ...PREEXISTING_GATE, unverified: [{ raw: 'npx tsc', reason: 'outside verify_allow: npx tsc (add its prefix in /config)' }] }
  const state = tiers.emptyState('s')
  const applied = tiers.applyEvent(state, gateEvent('a', declared, skipped), defaultRouting())
  assert.equal(applied.meta.outcome, 'retry')
  assert.equal(state.tasks['users-pagination'].preexisting, undefined)
  const failing = { ...PREEXISTING_GATE, failure: { raw: 'npx tsc', code: 1, timedOut: false, tail: 'error TS2322', seconds: 3 } }
  const other = tiers.applyEvent(tiers.emptyState('s'), gateEvent('b', declared, failing), defaultRouting())
  assert.equal(other.meta.outcome, 'retry')
  assert.match(other.meta.reason, /npx tsc exit 1/)
})

test('a declaration inside the prompt does not open the pre-existing hatch', () => {
  const state = tiers.emptyState('s')
  const prompt = 'CC_TIERS_PREEXISTING: npm test - fails on main too'
  const normalized = tiers.normalizeEvent(event('p', 'implementer', report('implementer', 'sonnet', 'pass'), prompt))
  const applied = tiers.applyEvent(state, { ...normalized, gate: PREEXISTING_GATE }, defaultRouting())
  assert.equal(applied.meta.outcome, 'retry')
})

test('a task moved to a new tier inside a failure keeps its pre-existing count', () => {
  const state = tiers.emptyState('sess-1')
  state.tasks['users-pagination'] = { tier: 'sonnet', failures: ['sonnet/implementer: broke'], carried: [], preexisting: 1 }
  const moved = apply(state, riskyRouting(), 'k1', 'reviewer', report('reviewer', 'opus', 'fail', '', 'still wrong'))
  assert.equal(moved.state.tasks['users-pagination'].tier, 'opus')
  assert.equal(moved.state.tasks['users-pagination'].preexisting, 1)
})

test('the declared pre-existing command no longer hides a failing command listed after it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-pre-'))
  try {
    for (const [name, code] of [['main-fails', 1], ['broken', 1], ['fine', 0]]) writeFileSync(path.join(dir, `${name}.mjs`), `process.exit(${code})\n`)
    const routing = { ...defaultRouting({ specify: 'off' }), verifyAllow: [['node', 'main-fails.mjs'], ['node', 'broken.mjs'], ['node', 'fine.mjs']] }
    const run = (...commands) => {
      const text = [report('implementer', 'sonnet', 'pass'), ...commands.map((command) => `CC_TIERS_VERIFY: ${command}`), 'CC_TIERS_PREEXISTING: node main-fails.mjs - fails on main too'].join('\n')
      const state = tiers.emptyState('s')
      const prepared = tiers.prepareReport({ routing, projectDir: dir }, tiers.normalizeEvent(event('a', 'implementer', text)))
      return { state, gate: prepared.gate, applied: tiers.applyEvent(state, prepared, routing) }
    }

    const hidden = run('node main-fails.mjs', 'node broken.mjs')
    assert.equal(hidden.gate.failure.raw, 'node broken.mjs', 'the later command ran')
    assert.equal(hidden.gate.preexisting.raw, 'node main-fails.mjs')
    assert.equal(hidden.applied.meta.outcome, 'retry', 'the other failure counts as always')
    assert.match(hidden.state.tasks['users-pagination'].failures[0], /node broken\.mjs exit 1/)
    assert.equal(hidden.state.tasks['users-pagination'].preexisting, undefined)
    assert.equal(Object.hasOwn(hidden.state.evidence, 'users-pagination'), false, 'nothing was declared away')

    const reversed = run('node broken.mjs', 'node main-fails.mjs')
    assert.equal(reversed.gate.failure.raw, 'node broken.mjs')
    assert.equal(reversed.gate.preexisting, undefined, 'the gate stopped at the first failure')
    assert.equal(reversed.applied.meta.outcome, 'retry')

    const clean = run('node main-fails.mjs', 'node fine.mjs')
    assert.equal(clean.gate.failure, null)
    assert.deepEqual(clean.gate.verified, ['node fine.mjs'])
    assert.equal(clean.applied.meta.outcome, 'review', 'every other command passed, so the hatch applies')
    assert.deepEqual(clean.state.evidence['users-pagination'].verified, ['node fine.mjs'])
    const reviewed = apply(clean.state, routing, 'k', 'reviewer', report('reviewer', 'opus', 'pass'))
    assert.equal(reviewed.meta.outcome, 'pass')
    assert.equal(reviewed.meta.completion.status, 'partial')
    assert.match(reviewed.message, /Checks run 2, passed 1, failed 1, not run 0\./)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a checker can neither be delegated nor finish a task whose failure was declared pre-existing', () => {
  const routing = defaultRouting({ specify: 'off', research: 'off' })
  const state = tiers.emptyState('s')
  const written = tiers.applyEvent(state, gateEvent('a', preexistingReport('CC_TIERS_PREEXISTING: npm test - fails on main too'), PREEXISTING_GATE), routing)
  assert.equal(written.meta.outcome, 'review')
  const prompt = (role, tier) => `CC_TIERS_TASK: users-pagination\nCC_TIERS_TIER: ${tier}\nCC_TIERS_ROLE: ${role}\ndiff --git a/src/users.js`
  const call = (role, tier) => tiers.checkDelegation(state, { subagent_type: `cc-tiers:${role}`, prompt: prompt(role, tier) }, routing)
  assert.equal(
    call('checker', 'haiku').deny,
    'cc-tiers: users-pagination has a failure declared pre-existing; only cc-tiers:reviewer (Opus) can confirm it. Delegate the review to cc-tiers:reviewer.',
  )
  assert.equal(call('reviewer', 'sonnet').deny, '')

  const passed = apply(state, routing, 'c', 'checker', report('checker', 'haiku', 'pass'))
  assert.equal(passed.meta.outcome, 'review', 'a checker pass does not finish it')
  assert.equal(passed.meta.completion, undefined)
  assert.match(passed.message, /needs cc-tiers:reviewer \(Opus\) to confirm it/)
  assert.equal(passed.meta.floor, 'its failing check was declared pre-existing and a review must confirm it')
  const unfounded = tiers.applyEvent(state, { ...tiers.normalizeEvent(event('d', 'checker', report('checker', 'haiku', 'fail', '', 'unsure'))), judged: { blocking: [], discarded: [], notes: [], invalid: [] } }, routing)
  assert.equal(unfounded.meta.outcome, 'review', 'a rejection with no blocking finding is a pass, and still not enough')
  assert.ok(state.tasks['users-pagination'], 'the task stays open')
  assert.ok(state.evidence['users-pagination'].preexisting)

  const confirmed = apply(state, routing, 'e', 'reviewer', report('reviewer', 'opus', 'pass'))
  assert.equal(confirmed.meta.outcome, 'pass')
  assert.equal(state.tasks['users-pagination'], undefined)
  assert.equal(call('checker', 'haiku').deny, '', 'once the task is finished nothing is declared')
})

test('failure research is a /config and project option: on by default, 1 search per task, 0 behaves like off', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  assert.equal(defaults.failureResearch, true)
  assert.equal(defaults.failureResearchMax, 1)
  const merged = tiers.mergeRouting(defaults)
  assert.equal(merged.failureResearch, true)
  assert.equal(merged.failureResearchMax, 1)
  assert.equal(tiers.mergeRouting(defaults, { failureResearch: false }).failureResearch, false)
  assert.equal(tiers.mergeRouting(defaults, { failureResearch: false }, { failure_research: 'on' }).failureResearch, true)
  assert.equal(tiers.mergeRouting(defaults, null, { failure_research: 'off' }).failureResearch, false)
  assert.equal(tiers.mergeRouting(defaults, { failureResearchMax: 3 }).failureResearchMax, 3)
  assert.equal(tiers.mergeRouting(defaults, { failureResearchMax: 3 }, { failure_research_max: 2 }).failureResearchMax, 2)
  assert.equal(tiers.mergeRouting(defaults, null, { failure_research_max: 9 }).failureResearchMax, 5)
  assert.equal(tiers.mergeRouting(defaults, null, { failure_research_max: -1 }).failureResearchMax, 0)
  assert.equal(tiers.mergeRouting(defaults, null, { failure_research_max: 'x' }).failureResearchMax, 1)
  assert.deepEqual(
    [{}, { failure_research: 'off' }, { failure_research_max: 0 }, { failure_research_max: 4 }].map((user) => tiers.failureSearchCap(tiers.mergeRouting(defaults, null, user))),
    [1, 0, 0, 4],
  )
  assert.equal(tiers.failureSearchCap({}), 0, 'a routing built without the fields means off')
  const env = tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_FAILURE_RESEARCH: 'off', CLAUDE_PLUGIN_OPTION_FAILURE_RESEARCH_MAX: '3' })
  assert.equal(env.failure_research, 'off')
  assert.equal(env.failure_research_max, '3')
  assert.equal(tiers.userFromEnv({}).failure_research, null)
  assert.equal(tiers.userFromEnv({}).failure_research_max, null)
})

test('the manifest declares failure_research and failure_research_max', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
  const toggle = manifest.userConfig.failure_research
  assert.equal(toggle.type, 'string')
  assert.deepEqual(toggle.options, ['on', 'off'])
  assert.equal(toggle.default, 'on')
  const max = manifest.userConfig.failure_research_max
  assert.equal(max.type, 'number')
  assert.equal(max.default, 1)
  assert.equal(max.min, 0)
  assert.equal(max.max, 5)
  for (const option of [toggle, max]) assert.ok(option.title && option.description)
})

test('the session summary says failure research is on with its cap, or off', () => {
  const defaults = tiers.loadJson(path.join(ROOT, 'config/routing.default.json'))
  const summary = (user) => tiers.formatSessionContext(tiers.mergeRouting(defaults, null, user), 'not present', { ccCost: { installed: false } })
  const on = summary({})
  assert.ok(on.includes('Failure research: on, up to 1 per task.'))
  assert.ok(on.indexOf('Failure research: on') > on.indexOf('Research: on'))
  assert.ok(summary({ failure_research_max: 3 }).includes('Failure research: on, up to 3 per task.'))
  assert.ok(summary({ failure_research: 'off' }).includes('Failure research: off. A failure note never asks for a web search.'))
  assert.ok(summary({ failure_research_max: 0 }).includes('Failure research: off. A failure note never asks for a web search.'))
})

test('the orchestrator, dispatcher and tiers skill list both failure research options', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    assert.ok(text.includes('- Failure research: ${user_config.failure_research}'), file)
    assert.ok(text.includes('- Failure searches per task: ${user_config.failure_research_max}'), file)
    assert.ok(text.includes('failure research `on` with 1 search per task'), file)
  }
})

test('a review rejection with a blocking finding of a searchable category gets the failure search, one that is not gets none', async () => {
  const block = (category) => `${report('reviewer', 'sonnet', 'fail', '', 'broken')}\n${findingBlock({ category, evidence: 'command', command: 'node bad.mjs' })}`
  for (const [category, diagnosed] of [['api-usage', 'docs-version'], ['correctness', 'test'], ['regression', 'regression']]) {
    const { applied } = await reviewFlow('reviewer', block(category), { probes: { 'bad.mjs': 1 } })
    assert.equal(applied.meta.outcome, 'retry', category)
    assert.match(applied.message, new RegExp(`Diagnosis: ${diagnosed} `), category)
    assert.match(applied.message, /Failure research: run cc-tiers:researcher for users-pagination before the next attempt/, category)
    assert.match(applied.message, /\nCC_TIERS_FAILURE: /, category)
    assert.equal(applied.state.tasks['users-pagination'].searches, 1, category)
  }
  for (const category of ['security', 'scope']) {
    const { applied } = await reviewFlow('reviewer', block(category), { probes: { 'bad.mjs': 1 } })
    assert.equal(applied.meta.outcome, 'retry', category)
    assert.equal(applied.message.includes('Failure research:'), false, category)
    assert.equal(applied.state.tasks['users-pagination'].searches, undefined, category)
  }
  const off = await reviewFlow('reviewer', block('api-usage'), { probes: { 'bad.mjs': 1 }, routing: defaultRouting({ specify: 'off', verify: 'off', failure_research: 'off' }) })
  assert.equal(off.applied.message.includes('Failure research:'), false)
})

// A local noon of the first even and the first odd day number (days since 1970-01-01 in local time) in October 2026.
function localNoon(parity) {
  for (let day = 1; day < 4; day += 1) {
    const number = Math.floor(Date.UTC(2026, 9, day) / 86400000)
    if (number % 2 === parity) return new Date(2026, 9, day, 12).getTime()
  }
  throw new Error('no day')
}

test('writer: option, env, manifest and default file agree, and a bad value falls back to tiers', () => {
  assert.equal(defaultRouting().writer, 'tiers')
  for (const value of ['tiers', 'opus', 'alternate']) assert.equal(defaultRouting({ writer: value }).writer, value)
  assert.equal(defaultRouting({ writer: ' OPUS ' }).writer, 'opus')
  assert.equal(defaultRouting({ writer: 'bogus' }).writer, 'tiers')
  assert.equal(tiers.userFromEnv({ CLAUDE_PLUGIN_OPTION_WRITER: 'alternate' }).writer, 'alternate')
  assert.equal(tiers.userFromEnv({}).writer, null)
  const option = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).userConfig.writer
  assert.equal(option.type, 'string')
  assert.deepEqual(option.options, ['tiers', 'opus', 'alternate'])
  assert.equal(option.default, 'tiers')
  assert.equal(tiers.loadJson(path.join(ROOT, 'config/routing.default.json')).writer, 'tiers')
})

test('writerMode: alternate is opus on an even local day number and tiers on an odd one', () => {
  assert.equal(tiers.writerMode(defaultRouting({ writer: 'tiers' })), 'tiers')
  assert.equal(tiers.writerMode(defaultRouting({ writer: 'opus' })), 'opus')
  const alternate = defaultRouting({ writer: 'alternate' })
  const even = localNoon(0)
  const odd = localNoon(1)
  assert.equal(tiers.writerMode(alternate, even), 'opus')
  assert.equal(tiers.writerMode(alternate, odd), 'tiers')
  const midnight = new Date(even)
  midnight.setHours(0, 0, 0, 0)
  const lastMinute = new Date(even)
  lastMinute.setHours(23, 59, 59, 999)
  assert.equal(tiers.writerMode(alternate, midnight.getTime()), 'opus')
  assert.equal(tiers.writerMode(alternate, lastMinute.getTime()), 'opus')
  assert.equal(tiers.writerMode(alternate, lastMinute.getTime() + 2), 'tiers')
  assert.equal(tiers.writerMode(defaultRouting({ writer: 'opus' }), odd), 'opus')
})

test('writer: in opus mode decideTier sends every new task to Opus, and the budget guard still wins', () => {
  const routing = defaultRouting({ writer: 'opus' })
  for (const text of ['fix a typo in README', 'Add pagination to GET /users', 'Write a database migration for the users table']) {
    const decision = tiers.decideTier(text, routing)
    assert.deepEqual([decision.tier, decision.because, decision.effort], ['opus', 'writer', 'high'], text)
  }
  const conserved = tiers.decideTier('fix a typo in README', routing, { conserve: true })
  assert.deepEqual([conserved.tier, conserved.because], ['sonnet', 'budget'])
  assert.equal(tiers.decideTier('fix a typo in README', defaultRouting()).tier, 'haiku')
  assert.equal(tiers.decideTier('fix a typo in README', defaultRouting({ writer: 'alternate' }), { ceiling: true }).because, 'ceiling')
})

test('writer: in opus mode the light path and small path notes never say to delegate', () => {
  const routing = defaultRouting({ writer: 'opus', light_path: 'delegate' })
  const trivial = tiers.lightHint('fix a typo in README', routing)
  assert.ok(trivial.includes('Do it yourself in this session'))
  assert.ok(!trivial.includes('cc-tiers:worker'))
  const small = tiers.lightHint('Add pagination to GET /users', routing)
  assert.ok(small.includes('do it yourself in this session'))
  assert.ok(!small.includes('cc-tiers:implementer'))
  assert.ok(tiers.lightHint('Add pagination to GET /users', defaultRouting({ writer: 'opus' })).includes('do it yourself in this session'))
  assert.ok(tiers.lightHint('Add pagination to GET /users', defaultRouting({ light_path: 'delegate' })).includes('cc-tiers:implementer'))
})

test('writer: the session summary has a Writer line that names the mode of the day', () => {
  const context = (routing) => tiers.formatSessionContext(routing, 'not present', { ccCost: { installed: false } })
  assert.ok(context(defaultRouting()).includes('Writer: tiers.'))
  assert.ok(context(defaultRouting({ writer: 'opus' })).includes('Writer: opus.'))
  assert.match(context(defaultRouting({ writer: 'alternate' })), /Writer: alternate \((opus|tiers) today\)\./)
  assert.equal(tiers.writerLine(defaultRouting({ writer: 'alternate' }), localNoon(0)).startsWith('Writer: alternate (opus today).'), true)
  assert.equal(tiers.writerLine(defaultRouting({ writer: 'alternate' }), localNoon(1)).startsWith('Writer: alternate (tiers today).'), true)
})
