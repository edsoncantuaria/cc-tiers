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
