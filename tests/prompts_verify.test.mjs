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

test('session prompts handle the small path note', () => {
  for (const file of ['agents/orchestrator.md', 'agents/dispatcher.md', 'skills/tiers/SKILL.md']) {
    const text = read(file)
    for (const needle of ['cc-tiers small path', 'CC_TIERS_REVIEW: skip']) assert.ok(text.includes(needle), `${file} mentions ${needle}`)
  }
})
