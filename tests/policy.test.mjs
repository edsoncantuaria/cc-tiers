import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { PROFILES, PROFILE_NAMES, availableChecks, evidenceRule, parseProfile, profileSettings, reviewRequired, selectChecks } = await import(
  pathToFileURL(path.join(ROOT, 'hooks', 'policy.mjs')).href
)

async function withProject(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-policy-'))
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
      await writeFile(path.join(dir, name), content)
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const commands = (checks) => checks.map((check) => check.command)

test('profile settings of the four profiles', () => {
  assert.deepEqual(PROFILE_NAMES, ['balanced', 'quality', 'budget', 'fast'])
  const expected = {
    balanced: [0, 'medium', 'critical', 4, 5, 0],
    quality: [1, 'low', 'high', 3, 8, 1],
    budget: [0, 'medium', 'critical', 2, 3, 0],
    fast: [0, 'high', 'critical', 6, 3, -1],
  }
  for (const [name, values] of Object.entries(expected)) {
    const keys = ['effortBoost', 'strictFrom', 'reviewFloor', 'maxParallel', 'memoryItems', 'checkDepth']
    assert.deepEqual(profileSettings(name), Object.fromEntries(keys.map((key, i) => [key, values[i]])), name)
  }
  assert.deepEqual(Object.keys(PROFILES), PROFILE_NAMES)
})

test('profileSettings returns a frozen copy and falls back to balanced', () => {
  const settings = profileSettings('quality')
  assert.ok(Object.isFrozen(settings))
  assert.notEqual(settings, PROFILES.quality)
  assert.deepEqual(profileSettings('nope'), profileSettings('balanced'))
  assert.deepEqual(profileSettings(undefined), profileSettings('balanced'))
})

test('parseProfile trims, lowercases and falls back', () => {
  assert.equal(parseProfile('  Quality '), 'quality')
  assert.equal(parseProfile('FAST'), 'fast')
  assert.equal(parseProfile('nope'), 'balanced')
  assert.equal(parseProfile('', 'budget'), 'budget')
  assert.equal(parseProfile(undefined, 'fast'), 'fast')
})

test('availableChecks reads package.json scripts', async () => {
  const manifest = JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .', typecheck: 'tsc', 'type-check': 'tsc -b' } })
  await withProject({ 'package.json': manifest }, (dir) => {
    assert.deepEqual(availableChecks(dir), [
      { kind: 'test', command: 'npm test' },
      { kind: 'lint', command: 'npm run lint' },
      { kind: 'typecheck', command: 'npm run typecheck' },
      { kind: 'typecheck', command: 'npm run type-check' },
    ])
  })
})

test('availableChecks ignores the npm placeholder test script', async () => {
  const manifest = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
  await withProject({ 'package.json': manifest }, (dir) => assert.deepEqual(availableChecks(dir), []))
})

test('availableChecks detects tsconfig, eslint config and the lock file', async () => {
  await withProject({ 'tsconfig.json': '{}', 'eslint.config.mjs': '', 'package-lock.json': '{}' }, (dir) => {
    assert.deepEqual(availableChecks(dir), [
      { kind: 'typecheck', command: 'npx tsc --noEmit' },
      { kind: 'lint', command: 'npx eslint .' },
      { kind: 'security', command: 'npm audit --omit=dev' },
    ])
  })
  await withProject({ '.eslintrc.json': '{}' }, (dir) => assert.deepEqual(commands(availableChecks(dir)), ['npx eslint .']))
})

test('availableChecks skips npx eslint when scripts.lint exists', async () => {
  const files = { 'package.json': JSON.stringify({ scripts: { lint: 'eslint src' } }), 'eslint.config.js': '' }
  await withProject(files, (dir) => assert.deepEqual(commands(availableChecks(dir)), ['npm run lint']))
})

test('availableChecks detects php, python, go and rust projects', async () => {
  await withProject({ 'phpunit.xml.dist': '', 'phpstan.neon': '' }, (dir) => {
    assert.deepEqual(availableChecks(dir), [
      { kind: 'test', command: 'vendor/bin/phpunit' },
      { kind: 'static', command: 'vendor/bin/phpstan analyse' },
    ])
  })
  await withProject({ 'pytest.ini': '' }, (dir) => assert.deepEqual(commands(availableChecks(dir)), ['pytest']))
  await withProject({ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' }, (dir) => {
    assert.deepEqual(commands(availableChecks(dir)), ['pytest'])
  })
  await withProject({ 'pyproject.toml': '[project]\nname = "x"\n' }, (dir) => assert.deepEqual(availableChecks(dir), []))
  await withProject({ 'go.mod': 'module x', 'Cargo.toml': '' }, (dir) => {
    assert.deepEqual(availableChecks(dir), [
      { kind: 'test', command: 'go test ./...' },
      { kind: 'static', command: 'go vet ./...' },
      { kind: 'test', command: 'cargo test' },
    ])
  })
})

test('availableChecks never throws and has no duplicates', async () => {
  assert.deepEqual(availableChecks(''), [])
  assert.deepEqual(availableChecks(undefined), [])
  await withProject({}, (dir) => assert.deepEqual(availableChecks(path.join(dir, 'missing')), []))
  await withProject({ 'package.json': '{not json' }, (dir) => assert.deepEqual(availableChecks(dir), []))
  await withProject({ 'package.json': '{"scripts": "x"}', 'go.mod': '' }, (dir) => {
    assert.deepEqual(commands(availableChecks(dir)), ['go test ./...', 'go vet ./...'])
  })
  const files = { 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'tsconfig.json': '{}', 'phpunit.xml': '', 'phpunit.xml.dist': '' }
  await withProject(files, (dir) => {
    const found = commands(availableChecks(dir))
    assert.equal(new Set(found).size, found.length)
  })
})

const ALL = [
  { kind: 'test', command: 'npm test' },
  { kind: 'lint', command: 'npm run lint' },
  { kind: 'typecheck', command: 'npx tsc --noEmit' },
  { kind: 'static', command: 'vendor/bin/phpstan analyse' },
  { kind: 'security', command: 'npm audit --omit=dev' },
]
const kindsOf = (checks) => checks.map((check) => check.kind)

test('selectChecks depth by risk under balanced', () => {
  assert.deepEqual(kindsOf(selectChecks('low', ALL)), ['test'])
  assert.deepEqual(kindsOf(selectChecks('medium', ALL)), ['test'])
  assert.deepEqual(kindsOf(selectChecks('high', ALL)), ['test', 'lint', 'typecheck'])
  assert.deepEqual(kindsOf(selectChecks('critical', ALL)), kindsOf(ALL))
  assert.match(selectChecks('low', ALL)[0].why, /^low risk, depth 0: targeted: the tests that cover the change$/)
  assert.match(selectChecks('medium', ALL)[0].why, /medium risk, depth 1/)
  assert.match(selectChecks('high', ALL)[0].why, /high risk, depth 2/)
  assert.match(selectChecks('critical', ALL)[0].why, /critical risk, depth 3/)
})

test('selectChecks shifts depth by profile and clamps it', () => {
  assert.deepEqual(kindsOf(selectChecks('medium', ALL, { profile: 'quality' })), ['test', 'lint', 'typecheck'])
  assert.deepEqual(kindsOf(selectChecks('high', ALL, { profile: 'quality' })), kindsOf(ALL))
  assert.deepEqual(kindsOf(selectChecks('low', ALL, { profile: 'quality' })), ['test'])
  assert.match(selectChecks('low', ALL, { profile: 'quality' })[0].why, /depth 1/)
  assert.match(selectChecks('low', ALL, { profile: 'fast' })[0].why, /depth 0/)
  assert.match(selectChecks('medium', ALL, { profile: 'fast' })[0].why, /depth 0/)
  assert.deepEqual(kindsOf(selectChecks('high', ALL, { profile: 'fast' })), ['test'])
  for (const profile of ['budget', 'balanced']) assert.deepEqual(kindsOf(selectChecks('high', ALL, { profile })), ['test', 'lint', 'typecheck'])
})

test('selectChecks keeps critical at depth 3 under every profile', () => {
  for (const profile of PROFILE_NAMES) {
    const checks = selectChecks('critical', ALL, { profile })
    assert.deepEqual(kindsOf(checks), kindsOf(ALL), profile)
    assert.match(checks[0].why, /depth 3/, profile)
  }
})

test('selectChecks treats an unknown risk as medium and skips kinds the project lacks', () => {
  assert.match(selectChecks('whatever', ALL)[0].why, /^medium risk, depth 1/)
  assert.deepEqual(selectChecks('high', [{ kind: 'static', command: 'go vet ./...' }]), [])
  assert.deepEqual(selectChecks('low', undefined), [])
})

test('selectChecks lists the detected commands as they are, with no allow flag: the gate runs them all', () => {
  const checks = selectChecks('critical', ALL)
  assert.deepEqual(checks.map((check) => check.command), ['npm test', 'npm run lint', 'npx tsc --noEmit', 'vendor/bin/phpstan analyse', 'npm audit --omit=dev'])
  assert.ok(checks.every((check) => !('allowed' in check)))
})

test('evidenceRule follows strictFrom and strong from high', () => {
  assert.equal(evidenceRule('low', 'balanced'), 'light')
  assert.equal(evidenceRule('medium', 'balanced'), 'standard')
  assert.equal(evidenceRule('high', 'balanced'), 'strong')
  assert.equal(evidenceRule('critical', 'balanced'), 'strong')
  assert.equal(evidenceRule('low', 'quality'), 'standard')
  assert.equal(evidenceRule('low', 'fast'), 'light')
  assert.equal(evidenceRule('medium', 'fast'), 'light')
  assert.equal(evidenceRule('high', 'fast'), 'strong')
  assert.equal(evidenceRule('unknown', 'balanced'), 'standard')
  assert.equal(evidenceRule('low', 'nope'), 'light')
})

test('reviewRequired follows reviewFloor, and critical always needs review', () => {
  assert.equal(reviewRequired('high', 'balanced'), false)
  assert.equal(reviewRequired('critical', 'balanced'), true)
  assert.equal(reviewRequired('medium', 'quality'), false)
  assert.equal(reviewRequired('high', 'quality'), true)
  for (const profile of PROFILE_NAMES) assert.equal(reviewRequired('critical', profile), true, profile)
  assert.equal(reviewRequired('unknown', 'balanced'), false)
})
