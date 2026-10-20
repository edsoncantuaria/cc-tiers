import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { outOfScopeFiles, patchFiles, qualityIn, scopeOf, summarize, table } = await import(pathToFileURL(path.join(ROOT, 'bench', 'run.mjs')).href)

const hook = (text) => JSON.stringify({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [text], hookEvent: 'SubagentStop' } })

test('qualityIn counts only hook output', () => {
  const lines = [
    hook('cc-tiers gate: t1 failed: npm test (exit 1)\ncc-tiers gate: t1 flaky: npm test\ncc-tiers gate: t2 timed out: npm test after 300 s'),
    hook('cc-tiers gate: t3 reported pass without CC_TIERS_VERIFY\ncc-tiers gate: t4 not validated: budget exhausted: npm test'),
    hook('cc-tiers review: t5 discarded 2 finding(s): the evidence command passed\ncc-tiers review: t6 discarded 3 finding(s): the evidence command passed'),
    hook('cc-tiers review: t7 rejected without evidence; 1 finding(s) became notes'),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'cc-tiers gate: t1 failed: npm test (exit 1)' }] } }),
    'not json',
  ]
  assert.deepEqual(qualityIn(lines), { gateBlocked: 3, flaky: 1, notValidated: 1, discarded: 5, noEvidence: 1 })
  assert.deepEqual(qualityIn(lines, 3), { gateBlocked: 0, flaky: 0, notValidated: 0, discarded: 0, noEvidence: 1 })
})

test('summarize carries quality and review rounds', () => {
  const task = { id: 'a', kind: 'normal' }
  const verdict = { resolved: true, f2p: 1, p2p: 1, regressions: [] }
  const run = { json: null, seconds: 1, code: 0, stderr: '' }
  const quality = { gateBlocked: 1, flaky: 0, notValidated: 0, discarded: 0, noEvidence: 0 }
  const steps = [{ agent: 'cc-tiers:implementer' }, { agent: 'cc-tiers:reviewer' }, { agent: 'cc-tiers:checker' }]
  const row = summarize('cc-tiers', task, 1, run, verdict, [], { path: 'sonnet', ok: true, steps }, quality)
  assert.deepEqual(row.quality, quality)
  assert.equal(row.reviewRounds, 2)
  const plain = summarize('opus', task, 1, run, verdict)
  assert.equal(plain.quality, null)
  assert.equal(plain.reviewRounds, null)
})

test('table shows the quality layers section', () => {
  const base = { task: 'a', kind: 'normal', resolved: true }
  const rows = [
    { ...base, config: 'opus' },
    { ...base, config: 'cc-tiers', quality: { gateBlocked: 2, flaky: 1, notValidated: 0, discarded: 3, noEvidence: 1 }, reviewRounds: 3 },
    { ...base, config: 'cc-tiers', quality: { gateBlocked: 0, flaky: 0, notValidated: 1, discarded: 0, noEvidence: 0 }, reviewRounds: 2 },
  ]
  const out = table(rows)
  assert.match(out, /\| Configuration \| Pass blocked by gate \| Flaky \| Not validated \| Findings discarded \| Rejections without evidence \| Review rounds per task \|/)
  assert.match(out, /\| cc-tiers \(Opus orchestrator\) \| 2 \| 1 \| 1 \| 3 \| 1 \| 2\.5 \|/)
  assert.doesNotMatch(out, /\| Opus only \| [\d—]+ \| [\d—]+ \| [\d—]+ \| [\d—]+ \| [\d—]+ \| [\d.—]+ \|\n/)
  assert.doesNotMatch(table(rows.filter((row) => row.config === 'opus')), /Quality layers|Pass blocked by gate/)
})

const PATCH = ['diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@', '-x', '+y', 'diff --git a/test/a.test.mjs b/test/a.test.mjs', '--- /dev/null', '+++ b/test/a.test.mjs', ''].join('\n')

test('patchFiles lists the files a patch touches', () => {
  assert.deepEqual(patchFiles(PATCH), ['src/a.js', 'test/a.test.mjs'])
  assert.deepEqual(patchFiles(''), [])
})

test('scopeOf joins the solution files and scopeExtra; lookups have none', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scope-'))
  try {
    writeFileSync(path.join(dir, 'fix.patch'), PATCH)
    assert.deepEqual(scopeOf({ id: 'fix', scopeExtra: ['src/b.js'] }, dir).sort(), ['src/a.js', 'src/b.js', 'test/a.test.mjs'])
    assert.deepEqual(scopeOf({ id: 'lookup' }, dir), [])
    mkdirSync(path.join(dir, 'src'))
    writeFileSync(path.join(dir, 'src', 'server.js'), '')
    assert.deepEqual(scopeOf({ id: 'login' }, dir), ['src/server.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('outOfScopeFiles lists added, modified and deleted files outside the scope', () => {
  const before = new Map([['src/a.js', '1'], ['src/b.js', '1'], ['src/c.js', '1'], ['test/t.mjs', '1']])
  const after = new Map([['src/a.js', '2'], ['src/b.js', '1'], ['src/d.js', 'new'], ['test/t.mjs', '2'], ['test/new.mjs', 'x'], ['.bench-check/z.mjs', 'x'], ['package.json', 'x']])
  assert.deepEqual(outOfScopeFiles(before, after, ['src/a.js']), ['package.json', 'src/c.js', 'src/d.js'])
  assert.deepEqual(outOfScopeFiles(before, before, []), [])
})

test('table shows Touched outside scope, a dash without data', () => {
  const base = { task: 'a', kind: 'normal', resolved: true }
  const rows = [
    { ...base, config: 'opus', outOfScope: [] },
    { ...base, config: 'opus', outOfScope: ['README.md'] },
    { ...base, config: 'cc-tiers', outOfScope: ['a', 'b'] },
    { ...base, config: 'cc-tiers-light' },
  ]
  const out = table(rows)
  assert.match(out, /Recreated existing code \| Touched outside scope \| Tokens per resolved task \|/)
  assert.match(out, /\| Opus only \| .* \| — \| 1 \| /)
  assert.match(out, /\| cc-tiers \(Opus orchestrator\) \| .* \| — \| 1 \| /)
  assert.match(out, /\| cc-tiers light \(Sonnet dispatcher\) \| .* \| — \| — \| /)
})
