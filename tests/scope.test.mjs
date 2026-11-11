import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tiers = await import(pathToFileURL(path.join(ROOT, 'hooks', 'cc_tiers.mjs')).href)
const { workspaceSnapshot } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'workspace.mjs')).href)
const DEFAULTS = JSON.parse(readFileSync(path.join(ROOT, 'config', 'routing.default.json'), 'utf8'))
const ctxFor = (projectDir) => ({ projectDir, dataDir: '', routing: { ...tiers.mergeRouting(DEFAULTS, null, {}), verify: false } })

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })

async function repoWithChanges(files) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-scope-'))
  const repo = path.join(base, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  writeFileSync(path.join(repo, 'README.md'), 'x\n')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  const before = workspaceSnapshot(repo)
  for (const file of files) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), 'changed\n')
  }
  return { base, repo: realpathSync(repo), before }
}

const edit = (file, at, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), ...extra, message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } })

function writeRows(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${rows.join('\n')}\n`)
}

function writerReport(task, files) {
  const prompt = `CC_TIERS_TASK: ${task}\nCC_TIERS_FILES: ${files}\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\nChange src/a.js`
  const text = `CC_TIERS_TASK: ${task}\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_VERIFY: npm test\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done`
  return { kind: 'report', id: 'r1', tool_use_id: 'r1', session_id: 's', role: 'implementer', prompt, text, error: '' }
}

test('scope: a sensitive file listed in CC_TIERS_FILES is named, even with no extension', async () => {
  const { base, repo, before } = await repoWithChanges(['src/a.js', 'Jenkinsfile'])
  try {
    const listed = tiers.prepareReport(ctxFor(repo), writerReport('jenk', 'src/a.js, Jenkinsfile'), {}, { peek: { snapshot: before } })
    assert.deepEqual(listed.workspace.sensitive, [])
    assert.deepEqual(listed.workspace.outOfScope, [])
    const unlisted = tiers.prepareReport(ctxFor(repo), writerReport('jenk', 'src/a.js'), {}, { peek: { snapshot: before } })
    assert.deepEqual(unlisted.workspace.sensitive.map((item) => item.file), ['Jenkinsfile'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('scope: a listed dir names the sensitive files under it, a test-name match does not', async () => {
  const { base, repo, before } = await repoWithChanges(['.env.example', 'config/.env.test.local', 'ci/Jenkinsfile'])
  try {
    const event = tiers.prepareReport(ctxFor(repo), writerReport('env', '.env.example, ci/'), {}, { peek: { snapshot: before } })
    assert.deepEqual(event.workspace.sensitive.map((item) => item.file), ['config/.env.test.local'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("scope: edits by your own turns or another session after the delegation are not the writer's", async () => {
  const changed = ['src/a.js', '.claude/settings.json', 'Makefile', 'Jenkinsfile', 'lib/b.js', 'docs/c.md', 'lib/d.js']
  const { base, repo, before } = await repoWithChanges(changed)
  try {
    const at = Date.now() - 60_000
    const snapshot = { ...before, at }
    const dir = path.join(base, 'projects')
    const own = path.join(dir, 'own.jsonl')
    const abs = (file) => path.join(repo, file)
    writeRows(own, [edit(abs('.claude/settings.json'), at + 1000), edit(abs('lib/d.js'), at + 1000, { isSidechain: true }), 'not json'])
    writeRows(path.join(dir, 'own', 'subagents', 'agent-w.jsonl'), [edit(abs('lib/b.js'), at + 1000)])
    writeRows(path.join(dir, 'other.jsonl'), [edit(abs('Makefile'), at + 1000), edit(abs('docs/c.md'), at - 1000)])
    writeRows(path.join(dir, 'other', 'subagents', 'agent-x.jsonl'), [edit(abs('Jenkinsfile'), at + 2000)])

    const event = tiers.prepareReport(ctxFor(repo), writerReport('mine', 'src/a.js'), { transcript_path: own }, { peek: { snapshot } })
    assert.deepEqual(event.workspace.sensitive, [], "settings.json was yours, the Jenkinsfile another session's")
    assert.deepEqual([...event.workspace.outOfScope].sort(), ['docs/c.md', 'lib/b.js', 'lib/d.js'], "this session's subagents, sidechain rows and older edits still count")
    assert.deepEqual([...event.workspace.elsewhere].sort(), ['.claude/settings.json', 'Jenkinsfile', 'Makefile'])

    // An old snapshot with no time, or no transcript, judges as before.
    const old = tiers.prepareReport(ctxFor(repo), writerReport('mine', 'src/a.js'), { transcript_path: own }, { peek: { snapshot: before } })
    assert.deepEqual(old.workspace.sensitive.map((item) => item.file).sort(), ['.claude/settings.json', 'Jenkinsfile'])
    assert.equal(old.workspace.elsewhere, undefined)
    const blind = tiers.prepareReport(ctxFor(repo), writerReport('mine', 'src/a.js'), {}, { peek: { snapshot } })
    assert.equal(blind.workspace.sensitive.length, 2)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('scope: files edited elsewhere are said apart and do not force a review', () => {
  const routing = tiers.mergeRouting(DEFAULTS, null, {})
  const state = tiers.emptyState('s')
  const prompt = 'CC_TIERS_TASK: tweak\nCC_TIERS_RESEARCH: none - x\nCC_TIERS_SPEC: none - x\nFix src/x.js'
  tiers.checkDelegation(state, { subagent_type: 'cc-tiers:implementer', prompt }, routing)
  const text = 'CC_TIERS_TASK: tweak\nCC_TIERS_TIER: sonnet\nCC_TIERS_ROLE: implementer\nCC_TIERS_VERIFY: npm test\nCC_TIERS_REVIEW: skip\nCC_TIERS_STATUS: pass\nCC_TIERS_REASON: done'
  const gate = { status: 'pass', verified: ['npm test'], flaky: [], unverified: [], failure: null, cached: [] }
  const workspace = { changed: ['src/x.js', 'Jenkinsfile'], sensitive: [], outOfScope: [], elsewhere: ['Jenkinsfile'] }
  const out = tiers.applyEvent(state, { kind: 'report', id: 'e1', tool_use_id: 'e1', session_id: 's', role: 'implementer', prompt, text, error: '', gate, workspace }, routing)
  assert.equal(out.meta.outcome, 'pass')
  assert.match(out.message, /you or another Claude session edited Jenkinsfile while tweak ran, so they are not counted against it/)
  assert.doesNotMatch(out.message, /sensitive file/)
})
