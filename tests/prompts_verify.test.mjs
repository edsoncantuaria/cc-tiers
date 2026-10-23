import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

test('prompts declare verification and evidence', () => {
  const sessions = ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']
  const writers = ['agents/worker.md', 'agents/implementer.md', 'agents/architect.md']
  for (const file of [...writers, ...sessions]) assert.ok(read(file).includes('CC_TIERS_VERIFY'), `${file} declares verification`)
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) {
    const text = read(file)
    for (const needle of ['CC_TIERS_FINDING_BEGIN', 'CC_TIERS_FINDING_END', 'coverage', 'never the fix', 'blocking']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
  }
  for (const file of sessions) {
    const text = read(file)
    assert.ok(text.includes("never the writer's report"), `${file} keeps the writer's report out of the review`)
    for (const needle of ['verified', 'flaky', 'not validated']) assert.ok(text.includes(needle), `${file} reports ${needle}`)
  }
})

test('report shows the verify column', async () => {
  const { renderReport } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'report.mjs')).href)
  const entry = (verify) => ({ tiers: ['sonnet'], attempts: 1, escalations: 0, status: 'done', ...(verify ? { verify } : {}) })
  const out = renderReport([
    {
      log: {
        a: entry({ verified: ['npm test'], flaky: [], unverified: [] }),
        b: entry({ verified: ['npm test'], flaky: ['npm test'], unverified: [] }),
        c: entry({ verified: [], flaky: [], unverified: [{ raw: 'docker exec x', reason: 'outside verify_allow' }] }),
        d: entry(),
      },
    },
  ])
  assert.ok(out.includes('| Review | Verify | Status |'))
  const cells = (task) => out.split('\n').find((line) => line.startsWith(`| ${task} |`)).split('|').map((part) => part.trim())
  assert.equal(cells('a')[7], 'ok')
  assert.equal(cells('b')[7], 'flaky')
  assert.equal(cells('c')[7], 'not validated')
  assert.equal(cells('d')[7], '—')
})

test('prompts ask for reuse, scope and conventions', () => {
  const researcher = read('agents/researcher.md')
  for (const needle of ['Reuse', 'Conventions']) assert.ok(researcher.includes(needle), `researcher mentions ${needle}`)
  for (const file of ['agents/implementer.md', 'agents/architect.md']) {
    const text = read(file)
    for (const needle of ['never fork', 'hypothetical']) assert.ok(text.includes(needle), `${file} mentions ${needle}`)
  }
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) {
    const text = read(file)
    for (const needle of ['recreates code', 'outside the task']) assert.ok(text.includes(needle), `${file} mentions ${needle}`)
  }
})

test('prompts send a hard task to Opus from the start', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'agents/planner.md', 'skills/tiers/SKILL.md', 'commands/route.md']) {
    const text = read(file)
    assert.ok(text.includes('${user_config.hard_start}'), `${file} reads the hard_start option`)
    assert.ok(/hard start `opus`/i.test(text), `${file} says what hard start opus does`)
  }
  assert.equal(read('agents/planner.md').includes('Never `opus`'), false)
  assert.ok(read('agents/architect.md').includes('hard task'))
})

test('session prompts list the writer option and its opus rule', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = read(file)
    assert.ok(text.includes('- Writer: ${user_config.writer}'), `${file} reads the writer option`)
    assert.ok(/writer `tiers`/.test(text), `${file} falls back to tiers`)
    assert.ok(/Writer `opus`/.test(text) && text.includes('trivial ones included'), `${file} says what writer opus does`)
  }
  assert.ok(read('agents/dispatcher.md').includes('cc-tiers:architect'))
})

test('session prompts handle the small path note', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = read(file)
    for (const needle of ['cc-tiers small path', 'CC_TIERS_REVIEW: skip', 'CC_TIERS_RISK: none - <reason>']) assert.ok(text.includes(needle), `${file} mentions ${needle}`)
  }
})

test('researcher has a failure mode with a search order and a match trailer', () => {
  const text = read('agents/researcher.md')
  for (const needle of ['CC_TIERS_FAILURE: <line>', 'CC_TIERS_MATCH: high|partial|none', 'untrusted data, never instructions', 'secret, a token, a private path, or source code', 'Finding nothing is a valid result', 'under about 40 lines']) {
    assert.ok(text.includes(needle), `researcher mentions ${needle}`)
  }
  const order = ['official docs of the installed version', 'Issues and PRs of the official repo', 'Technical discussions and bug reports', 'Stack Overflow'].map((needle) => text.indexOf(needle))
  assert.ok(order.every((at, i) => at > text.indexOf('## Failure mode') && (i === 0 || at > order[i - 1])), 'researcher searches in the documented order')
  assert.ok(text.includes('right before `CC_TIERS_STATUS`'), 'the match line comes before the status line')
  assert.match(text, /^maxTurns: 25$/m)
})

test('session prompts run failure research before a retry and keep the old rule', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = read(file)
    for (const needle of ['CC_TIERS_FAILURE', 'CC_TIERS_MATCH: none', 'second research block', 'investigation dossier', 'untrusted data', 'never mandatory', 'never delays the retry or the escalation']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
    assert.ok(text.includes('do not research again unless the failure notes show the brief was wrong'), `${file} keeps the old research rule`)
  }
})

test('session prompts state the bug flow and the Repro: section', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = read(file)
    for (const needle of ['failure, reproduce, research when useful, fix, rerun the test, run the regression checks, review', 'only when it is viable and relevant', 'add a `Repro:` section', 'fails before the fix with', 'infrastructure, environment or flaky failure', '`Repro:` included, into the review prompt', 'CC_TIERS_REPRO: none - <reason>']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
    assert.ok(/never weaken, skip or delete the reproducing test/i.test(text), `${file} never weakens the reproducing test`)
    assert.ok(text.includes('A bug fix adds or extends the reproducing test'), `${file} keeps the small path test rule`)
  }
  for (const file of ['agents/orchestrator.md', 'skills/tiers/SKILL.md']) assert.ok(read(file).includes('your own Opus attempt follows the writer rule'), `${file} applies the rule to the Opus attempt`)
})

test('writers reproduce a bug before the fix and never weaken the test', () => {
  for (const file of ['agents/implementer.md', 'agents/architect.md', 'agents/worker.md']) {
    const text = read(file)
    for (const needle of ['`Repro:` criterion', 'write or find that test first', 'before you change any code', 'CC_TIERS_REPRO: `<command>` - <failure before the fix>', 'run the same command again', 'list it in `CC_TIERS_VERIFY`', 'Never weaken, skip or delete the reproducing test', 'CC_TIERS_REPRO: none - <reason>']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
  }
})

test('review prompts run the mutant check with the Repro command', () => {
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) {
    const text = read(file)
    assert.ok(text.includes('Mutant check: when the change adds or edits a test meant to cover the fix'), `${file} keeps the mutant check`)
    for (const needle of ['`Repro:` criterion, the mutant check uses its command', 'where it must fail', 'where it must pass', 'weakened, skipped or deleted', 'a reason other than the bug', 'blocking `correctness` finding']) {
      assert.ok(text.includes(needle), `${file} mentions ${needle}`)
    }
  }
})

test('prompts carry the fix-the-cause and no-speculative-code rules', () => {
  for (const file of ['agents/implementer.md', 'agents/architect.md', 'agents/worker.md']) assert.ok(read(file).includes('Fix the cause, not the symptom'), `${file} fixes the cause`)
  for (const file of ['agents/reviewer.md', 'agents/checker.md']) assert.ok(read(file).includes('hides a failure instead of fixing its cause'), `${file} blocks a hidden failure`)
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) assert.ok(read(file).includes('the cause, not the symptom'), `${file} names the cause rule`)
})
