import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { RISK_LEVELS, riskRank, assessRisk, testsAvailableIn } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'risk.mjs')).href)

const dims = (input) => assessRisk(input).dimensions
const withTests = { testsAvailable: true }

test('levels are ordered and ranked', () => {
  assert.deepEqual(RISK_LEVELS, ['low', 'medium', 'high', 'critical'])
  assert.equal(riskRank('low'), 0)
  assert.equal(riskRank('critical'), 3)
  assert.equal(riskRank('nope'), -1)
})

test('result shape: integer dimensions and a factor list', () => {
  const result = assessRisk({ text: 'rename a helper', testsAvailable: true })
  assert.deepEqual(Object.keys(result.dimensions), ['complexity', 'regression', 'sensitivity', 'ambiguity', 'evidence'])
  for (const value of Object.values(result.dimensions)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 3)
  assert.ok(Array.isArray(result.factors))
})

test('complexity dimension maps the score', () => {
  const at = (score) => dims({ complexity: { score, signals: [] } }).complexity
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(at), [0, 1, 2, 2, 3, 3])
})

test('sensitivity: risk keyword, sensitive path, data wording, none', () => {
  assert.equal(dims({ keywordRisk: true }).sensitivity, 3)
  assert.ok(assessRisk({ keywordRisk: true }).factors.includes('risk keyword'))
  const byPath = assessRisk({ files: ['src/auth/login.js'] })
  assert.equal(byPath.dimensions.sensitivity, 3)
  assert.ok(byPath.factors.includes('sensitive path: src/auth/login.js'))
  for (const file of ['db/migrations/001.sql', 'config/.env', 'lib/Billing.php', 'x/rbac.ts', 'a/password_reset.py']) {
    assert.equal(dims({ files: [file] }).sensitivity, 3, file)
  }
  for (const text of ['change the database layer', 'run a SQL query', 'persist the state', 'delete data older than a year', 'drop the old table', 'alterar o banco de dados', 'storage format of the cache']) {
    assert.equal(dims({ text }).sensitivity, 2, text)
  }
  assert.equal(dims({ text: 'rename a helper', files: ['src/util.js'] }).sensitivity, 0)
})

test('an ordinary path whose word only starts with a sensitive stem is not sensitive', () => {
  const ordinary = [
    'docs/author.md', 'README_authors.md', 'lib/authority.js', 'src/tokenizer.js', 'src/tokens/colors.css',
    'hooks/secretary.js', 'src/schemaless.js', 'src/environment.js', 'src/sessionless/x.js',
  ]
  for (const file of ordinary) {
    const result = assessRisk({ files: [file], testsAvailable: true })
    assert.equal(result.dimensions.sensitivity, 0, file)
    assert.notEqual(result.level, 'critical', file)
  }
})

test('a sensitive word in a path is critical, however the path spells it', () => {
  const sensitive = [
    'src/auth/login.js', 'src/auth-service/x.js', 'src/oauth.js', 'src/session.js', 'db/migrations/001.sql',
    'src/jwt-token.js', 'config/.env', 'config/.env.production', 'src/AuthService.ts', 'src/OAuthClient.php',
    'src/oauth2/client.js', 'app/UserSession.php', 'lib/JWTToken.js', 'src/password_reset.py', 'ops/payments/run.sh',
    'src/ui/Login.vue', 'web/login.html',
  ]
  for (const file of sensitive) {
    const result = assessRisk({ files: [file], testsAvailable: true })
    assert.equal(result.dimensions.sensitivity, 3, file)
    assert.equal(result.level, 'critical', file)
  }
  assert.equal(dims({ files: ['src/.environment'] }).sensitivity, 0)
})

test('regression: contract, dependency, directory spread, history, cap', () => {
  assert.equal(dims({ text: 'change the public API' }).regression, 2)
  assert.equal(dims({ text: 'mudar o contrato' }).regression, 2)
  assert.equal(dims({ text: 'bump the version' }).regression, 1)
  for (const file of ['package.json', 'web/package-lock.json', 'composer.lock', 'requirements.txt', 'api/requirements-dev.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'yarn.lock', 'pnpm-lock.yaml', 'Gemfile', 'Gemfile.lock']) {
    assert.equal(dims({ files: [file] }).regression, 1, file)
  }
  for (const file of ['src/version.js', 'src/lock/mutex.js', 'docs/requirements.md', 'src/upgrade.js', 'src/package.json.js']) {
    assert.equal(dims({ files: [file] }).regression, 0, file)
  }
  assert.equal(dims({ text: 'change the user interface color' }).regression, 0)
  assert.equal(dims({ text: 'lock the row while saving' }).regression, 0)
  assert.equal(dims({ text: 'change the public interface' }).regression, 2)
  assert.equal(dims({ files: ['a/x.js', 'b/y.js'] }).regression, 0)
  assert.equal(dims({ files: ['a/x.js', 'b/y.js', 'c/z.js'] }).regression, 1)
  assert.equal(dims({ files: ['root.js', 'a/x.js', 'a/y.js', 'b/z.js'] }).regression, 0)
  assert.equal(dims({ history: { sonnet: true } }).regression, 1)
  assert.equal(dims({ text: 'breaking endpoint upgrade', files: ['a/x', 'b/y', 'c/z'], history: { sonnet: true } }).regression, 3)
})

test('ambiguity: hedges, questions, accent folding, cap', () => {
  assert.equal(dims({ text: 'maybe fix it' }).ambiguity, 1)
  assert.equal(dims({ text: 'Maybe, somehow' }).ambiguity, 2)
  assert.equal(dims({ text: 'one question?' }).ambiguity, 0)
  assert.equal(dims({ text: 'why? how?' }).ambiguity, 1)
  assert.equal(dims({ text: 'TALVEZ, não sei, de alguma forma' }).ambiguity, 3)
  assert.equal(dims({ text: 'maybe somehow, something like this etc? not sure?' }).ambiguity, 3)
  assert.equal(dims({ text: 'maybe maybe maybe' }).ambiguity, 1)
})

test('evidence: tests known, unknown, missing, haiku history, cap', () => {
  assert.equal(dims({ testsAvailable: true }).evidence, 0)
  assert.equal(dims({ testsAvailable: null }).evidence, 1)
  assert.equal(dims({}).evidence, 1)
  assert.equal(dims({ testsAvailable: false }).evidence, 2)
  assert.equal(dims({ testsAvailable: false, history: { haiku: true } }).evidence, 3)
  assert.equal(dims({ testsAvailable: true, history: { haiku: true } }).evidence, 1)
})

test('level low: small change with tests', () => {
  assert.equal(assessRisk({ text: 'rename a helper', ...withTests }).level, 'low')
})

test('complexity alone stays below high', () => {
  assert.equal(assessRisk({ text: 'rename a helper', complexity: { score: 1 }, ...withTests }).level, 'low')
  const large = assessRisk({ text: 'format files', complexity: { score: 9 }, ...withTests })
  assert.equal(large.dimensions.complexity, 3)
  assert.equal(large.level, 'medium')
})

test('level medium: sum of 2, regression 1 or sensitivity 1', () => {
  assert.equal(assessRisk({ text: 'rename a helper' }).level, 'low')
  assert.equal(assessRisk({ text: 'rename a helper', testsAvailable: false }).level, 'medium')
  assert.equal(assessRisk({ text: 'bump the version', ...withTests }).level, 'medium')
})

test('level high: data wording, contract with complexity, or a big sum', () => {
  assert.equal(assessRisk({ text: 'persist the settings', ...withTests }).level, 'high')
  assert.equal(assessRisk({ text: 'change the endpoint', complexity: { score: 2 }, ...withTests }).level, 'high')
  assert.equal(assessRisk({ text: 'change the endpoint', complexity: { score: 1 }, ...withTests }).level, 'medium')
  assert.equal(
    assessRisk({ text: 'maybe somehow do it', complexity: { score: 2 }, testsAvailable: false }).level,
    'high',
  )
})

test('level critical: a small change can be critical', () => {
  const result = assessRisk({ text: 'fix typo', files: ['src/session.js'], ...withTests })
  assert.equal(result.level, 'critical')
  assert.equal(assessRisk({ text: 'x', keywordRisk: true, ...withTests }).level, 'critical')
})

test('word matching starts at a word, and a whole word ends at one', () => {
  assert.equal(dims({ text: 'ask the oracle' }).sensitivity, 0)
  assert.equal(dims({ files: ['db/oracle.js'] }).sensitivity, 0)
  assert.equal(dims({ files: ['src/acl.js'] }).sensitivity, 3)
  assert.equal(dims({ text: 'fix the dropdown menu' }).sensitivity, 0)
  assert.equal(dims({ text: 'drop it' }).sensitivity, 2)
  assert.equal(dims({ text: 'a blocker' }).regression, 0)
  assert.equal(dims({ text: 'the versioning scheme' }).regression, 1)
})

test('bad input is treated as empty', () => {
  assert.doesNotThrow(() => assessRisk())
  assert.doesNotThrow(() => assessRisk({ text: 42, files: 'a.js', complexity: null, history: null }))
  assert.doesNotThrow(() => assessRisk({ text: null, files: [null, 7, {}], complexity: { score: 'x' } }))
  const empty = assessRisk({ text: 42, files: 'src/auth.js', complexity: null, history: null, testsAvailable: true })
  assert.deepEqual(empty.dimensions, { complexity: 0, regression: 0, sensitivity: 0, ambiguity: 0, evidence: 0 })
  assert.equal(empty.level, 'low')
})

test('windows paths match like posix ones', () => {
  assert.equal(dims({ files: ['src\\auth\\login.js'] }).sensitivity, 3)
  assert.equal(assessRisk({ files: ['src\\auth\\login.js'] }).factors.includes('sensitive path: src/auth/login.js'), true)
  assert.equal(dims({ files: ['a\\x.js', 'b\\y.js', 'c\\z.js'] }).regression, 1)
  assert.equal(dims({ files: ['C:\\repo\\a\\x.js', 'C:\\repo\\a\\y.js'] }).regression, 0)
  assert.equal(dims({ files: ['config\\.env'] }).sensitivity, 3)
  assert.equal(dims({ files: ['docs\\author.md'] }).sensitivity, 0)
})

test('an absolute path does not crash', () => {
  assert.doesNotThrow(() => assessRisk({ files: ['/home/me/app/src/x.js', 'C:/repo/y.js', '/'] }))
  assert.equal(dims({ files: ['/home/me/app/src/x.js', '/home/me/app/src/y.js'] }).regression, 0)
  assert.equal(dims({ files: ['/home/me/app/src/auth.js'] }).sensitivity, 3)
})

test('testsAvailableIn reads the project directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-tiers-risk-'))
  try {
    const make = async (name, files = {}, dirs = []) => {
      const dir = path.join(root, name)
      await mkdir(dir)
      for (const d of dirs) await mkdir(path.join(dir, d))
      for (const [file, body] of Object.entries(files)) await writeFile(path.join(dir, file), body)
      return dir
    }
    assert.equal(testsAvailableIn(await make('empty')), false)
    for (const dir of ['test', 'tests', '__tests__', 'spec']) assert.equal(testsAvailableIn(await make(`d-${dir}`, {}, [dir])), true, dir)
    for (const file of ['pytest.ini', 'phpunit.xml', 'phpunit.xml.dist', 'go.mod', 'Cargo.toml']) {
      assert.equal(testsAvailableIn(await make(`f-${file}`, { [file]: '' })), true, file)
    }
    assert.equal(testsAvailableIn(await make('script', { 'package.json': '{"scripts":{"test":"node --test"}}' })), true)
    const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
    assert.equal(testsAvailableIn(await make('placeholder', { 'package.json': placeholder })), false)
    assert.equal(testsAvailableIn(await make('noscript', { 'package.json': '{"name":"x"}' })), false)
    assert.equal(testsAvailableIn(await make('broken', { 'package.json': '{nope' })), false)
    assert.equal(testsAvailableIn(await make('file-named-test', { test: 'not a dir' })), false)
    assert.equal(testsAvailableIn(path.join(root, 'missing')), null)
    assert.equal(testsAvailableIn(path.join(root, 'script', 'package.json')), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  for (const value of ['', undefined, null, 42]) assert.equal(testsAvailableIn(value), null)
})

test('login alone makes a path critical, past-tense data wording counts, and a null input does not throw', () => {
  const result = assessRisk({ files: ['src/ui/Login.vue'], testsAvailable: true })
  assert.deepEqual(result.factors.filter((f) => f.startsWith('sensitive path')), ['sensitive path: src/ui/Login.vue'])
  assert.ok(assessRisk({ text: 'we dropped the table', testsAvailable: true }).dimensions.sensitivity >= 2)
  assert.equal(assessRisk(null).level, assessRisk().level)
})
