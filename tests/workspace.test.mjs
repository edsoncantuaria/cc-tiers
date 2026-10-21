import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ws = await import(pathToFileURL(path.join(ROOT, 'hooks', 'workspace.mjs')).href)

function git(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

async function repo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-ws-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@example.invalid')
  git(dir, 'config', 'user.name', 't')
  writeFileSync(path.join(dir, 'a.js'), 'one\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

test('the fingerprint changes with the files and is empty outside git', async () => {
  const dir = await repo()
  const outside = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-ws-'))
  try {
    const clean = ws.treeFingerprint(dir)
    assert.match(clean, /^[0-9a-f]{20}$/)
    assert.equal(ws.treeFingerprint(dir), clean, 'stable while nothing changes')
    writeFileSync(path.join(dir, 'a.js'), 'two\n')
    const edited = ws.treeFingerprint(dir)
    assert.notEqual(edited, clean)
    writeFileSync(path.join(dir, 'a.js'), 'three\n')
    assert.notEqual(ws.treeFingerprint(dir), edited, 'a second edit of a dirty file changes it again')
    assert.equal(ws.treeFingerprint(outside), '')
    assert.equal(ws.treeFingerprint(''), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('attemptChanges sees new files and new edits to files that were already dirty', async () => {
  const dir = await repo()
  try {
    writeFileSync(path.join(dir, 'a.js'), 'dirty before\n')
    const before = ws.workspaceSnapshot(dir)
    assert.deepEqual(before.files, ['a.js'])
    assert.deepEqual(ws.attemptChanges(before, ws.workspaceSnapshot(dir)), [], 'nothing changed during the attempt')
    writeFileSync(path.join(dir, 'a.js'), 'edited again\n')
    writeFileSync(path.join(dir, '.env'), 'X=1\n')
    const after = ws.workspaceSnapshot(dir)
    assert.deepEqual(ws.attemptChanges(before, after).sort(), ['.env', 'a.js'])
    assert.equal(ws.workspaceSnapshot(path.join(os.tmpdir(), 'no-such-cc-tiers-dir')), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a snapshot taken from a subdirectory hashes root-relative paths, and truncation drops the fingerprint', async () => {
  const { mkdirSync } = await import('node:fs')
  const dir = await repo()
  try {
    mkdirSync(path.join(dir, 'src'))
    writeFileSync(path.join(dir, 'src', 'a.js'), 'one\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-qm', 'src')
    writeFileSync(path.join(dir, 'src', 'a.js'), 'two\n')
    const sub = path.join(dir, 'src')
    const before = ws.workspaceSnapshot(sub)
    assert.notEqual(before.hashes['src/a.js'], 'gone')
    const print = ws.treeFingerprint(sub)
    writeFileSync(path.join(dir, 'src', 'a.js'), 'three\n')
    assert.deepEqual(ws.attemptChanges(before, ws.workspaceSnapshot(sub)), ['src/a.js'])
    assert.notEqual(ws.treeFingerprint(sub), print)
    const many = Array.from({ length: ws.MAX_FILES + 1 }, (_, i) => `?? f${i}.js`).join('\0')
    const fake = (cwd, args) => (args[0] === 'rev-parse' ? (args[1] === 'HEAD' ? 'abc\n' : `${cwd}\n`) : many)
    assert.equal(ws.treeFingerprint(dir, fake), '', 'a truncated list gives no fingerprint')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parsePorcelainZ keeps spaces and non-ASCII, skips the old path of a rename, and flags truncation', () => {
  const out = ws.parsePorcelainZ(' M src/a.js\0R  new name.js\0old.js\0?? é.js\0')
  assert.deepEqual(out, { files: ['src/a.js', 'new name.js', 'é.js'], truncated: false })
  const many = Array.from({ length: ws.MAX_FILES + 2 }, (_, i) => `?? f${i}.js`).join('\0')
  assert.equal(ws.parsePorcelainZ(many).truncated, true)
})

test('a second edit to an untracked or spaced file changes the snapshot and the fingerprint; a revert counts too', async () => {
  const dir = await repo()
  try {
    writeFileSync(path.join(dir, 'new.js'), 'one\n')
    writeFileSync(path.join(dir, 'a b.js'), 'one\n')
    git(dir, 'add', 'a b.js')
    git(dir, 'commit', '-qm', 'spaced')
    writeFileSync(path.join(dir, 'a b.js'), 'two\n')
    const before = ws.workspaceSnapshot(dir)
    const print = ws.treeFingerprint(dir)
    writeFileSync(path.join(dir, 'new.js'), 'two\n')
    writeFileSync(path.join(dir, 'a b.js'), 'three\n')
    assert.deepEqual(ws.attemptChanges(before, ws.workspaceSnapshot(dir)).sort(), ['a b.js', 'new.js'])
    assert.notEqual(ws.treeFingerprint(dir), print)
    writeFileSync(path.join(dir, 'a b.js'), 'one\n')
    const reverted = ws.attemptChanges(before, ws.workspaceSnapshot(dir))
    assert.ok(reverted.includes('a b.js'), 'a file reverted to HEAD changed during the attempt')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sensitiveFiles names secrets, CI, lockfiles and agent settings', () => {
  const found = ws.sensitiveFiles(['src/app.js', '.env.local', 'config/.env', 'certs/server.pem', '.github/workflows/ci.yml', 'package-lock.json', '.claude/settings.local.json', 'docs/environment.md', 'src\\keys\\id_rsa'])
  assert.deepEqual(found.map((item) => item.file), ['.env.local', 'config/.env', 'certs/server.pem', '.github/workflows/ci.yml', 'package-lock.json', '.claude/settings.local.json', 'src/keys/id_rsa'])
  assert.equal(found[0].why, 'environment file')
})

test('outOfScope allows the own test of a declared file and declared dirs, nothing else', () => {
  assert.deepEqual(ws.outOfScope(['src/users.js', 'src/lib/x.js', 'test/users.test.mjs', 'tests/test_users.py', 'README.md'], ['src/users.js', 'src/lib/']), ['README.md'])
  assert.deepEqual(ws.outOfScope(['scripts/tests/deploy.sh', 'hooks/evil.test.mjs'], ['src/a.js']), ['scripts/tests/deploy.sh', 'hooks/evil.test.mjs'])
  assert.deepEqual(ws.outOfScope(['SRC/x.js'], ['src/']), ['SRC/x.js'], 'case-sensitive like git')
  assert.deepEqual(ws.outOfScope(['anything.js'], []), [], 'no declared scope, nothing to compare')
  assert.deepEqual(ws.outOfScope(['src/../README.md'], ['src/']), ['src/../README.md'], '../ is resolved before comparing')
})

test('validateState drops entries that cannot be trusted and reports them', () => {
  const state = {
    tasks: {
      ok: { tier: 'sonnet', failures: ['sonnet/implementer: x'], carried: [] },
      'Bad Slug': { tier: 'sonnet', failures: [] },
      tier: { tier: 'gpt', failures: [] },
      notes: { tier: 'haiku', failures: [1] },
      many: { tier: 'haiku', failures: ['a', 'b', 'c'] },
      carried: { tier: 'opus', failures: [], carried: 'x' },
      carriednotes: { tier: 'opus', failures: [], carried: [{}] },
    },
  }
  const problems = ws.validateState(state, { maxAttempts: 2 })
  assert.deepEqual(Object.keys(state.tasks), ['ok'])
  assert.equal(problems.length, 6)
  assert.match(problems.join('\n'), /many: 3 failures over the limit 2/)
  assert.deepEqual(ws.validateState({}), [])
})

test('sensitiveFiles covers credentials, registry rc files, git internals and container config', () => {
  const cases = {
    'config/credentials.json': 'credentials file',
    'secrets.yaml': 'credentials file',
    '.npmrc': 'registry credentials',
    'home/.pypirc': 'registry credentials',
    '.netrc': 'registry credentials',
    '.git/config': 'git internals',
    'Dockerfile': 'container config',
    'deploy/docker-compose.prod.yml': 'container config',
  }
  for (const [file, why] of Object.entries(cases)) assert.deepEqual(ws.sensitiveFiles([file]), [{ file, why }], file)
  assert.deepEqual(ws.sensitiveFiles(['src/credentialsForm.vue', 'docs/docker.md']), [])
})

test('validateState keeps a stopped Opus entry with more failures than the limit', () => {
  const state = { tasks: { stopped: { tier: 'opus', failures: ['a', 'b', 'c', 'd', 'e', 'f'], carried: [] }, lower: { tier: 'sonnet', failures: ['a', 'b', 'c'] } } }
  const problems = ws.validateState(state, { maxAttempts: 5 })
  assert.deepEqual(problems, [])
  assert.equal(state.tasks.stopped.failures.length, 6)
})

test('an edit to an untracked file alone changes the fingerprint', async () => {
  const dir = await repo()
  try {
    writeFileSync(path.join(dir, 'only.js'), 'one\n')
    const print = ws.treeFingerprint(dir)
    writeFileSync(path.join(dir, 'only.js'), 'two\n')
    assert.notEqual(ws.treeFingerprint(dir), print)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
