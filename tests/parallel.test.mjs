import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const par = await import(pathToFileURL(path.join(ROOT, 'hooks', 'parallel.mjs')).href)

const NOW = 1_800_000_000_000

test('declaredFiles prefers the header, else the paths in the prompt, and refuses escapes', () => {
  assert.deepEqual(par.declaredFiles({ FILES: 'src/a.js, ./src/b.js' }, 'ignored src/c.js'), { files: ['src/a.js', 'src/b.js'], declared: true })
  assert.deepEqual(par.declaredFiles({ FILES: 'src/a.js, ../etc/passwd' }, '').files, ['.'], 'a path that leaves the project widens to all of it')
  assert.deepEqual(par.declaredFiles({ FILES: '/home/me/repo/src/b.js' }, '').files, ['.'], 'an absolute path widens to all of it')
  assert.deepEqual(par.declaredFiles({}, 'edit `src/users.js` and src\\x.js then tests/users.test.mjs').files, ['src/users.js', 'src/x.js', 'tests/users.test.mjs'])
  assert.deepEqual(par.declaredFiles({}, 'no paths here').files, [])
})

test('overlapping writers conflict; disjoint or isolated ones run together', () => {
  const state = {}
  par.registerActive(state, { task: 'users', role: 'implementer', files: ['src/users.js'], now: NOW })
  const same = par.checkParallel(state, { task: 'paging', files: ['src/users.js'], now: NOW })
  assert.equal(same.ok, false)
  assert.match(same.reason, /users \(src\/users\.js\)/)
  assert.match(same.reason, /isolation: "worktree"/)
  assert.equal(par.checkParallel(state, { task: 'paging', files: ['src/'], now: NOW }).ok, false, 'a directory covers its files')
  assert.equal(par.checkParallel(state, { task: 'css', files: ['web/app.css'], now: NOW }).ok, true)
  assert.equal(par.checkParallel(state, { task: 'paging', files: ['src/users.js'], isolated: true, now: NOW }).ok, true)
  assert.equal(par.checkParallel(state, { task: 'users', files: ['src/users.js'], now: NOW }).ok, true, 'a retry of the same task is not its own conflict')
  const isolated = {}
  par.registerActive(isolated, { task: 'wt', role: 'implementer', files: ['src/users.js'], isolated: true, now: NOW })
  assert.equal(par.checkParallel(isolated, { task: 'paging', files: ['src/users.js'], now: NOW }).ok, true, 'a running isolated writer does not block the shared tree')
})

test('two writers with unknown scope run one at a time', () => {
  const state = {}
  par.registerActive(state, { task: 'a', role: 'implementer', files: [], now: NOW })
  const result = par.checkParallel(state, { task: 'b', files: [], now: NOW })
  assert.equal(result.ok, false)
  assert.match(result.reason, /unknown scope/)
  assert.equal(par.checkParallel(state, { task: 'b', files: ['src/b.js'], now: NOW }).ok, false, 'one unknown side cannot be shown apart')
  const known = {}
  par.registerActive(known, { task: 'a', role: 'implementer', files: ['src/a.js'], now: NOW })
  assert.equal(par.checkParallel(known, { task: 'b', files: [], now: NOW }).ok, false, 'the new side unknown, too')
})

test('the concurrency cap and dependencies hold a writer back', () => {
  const state = {}
  for (const task of ['a', 'b']) par.registerActive(state, { task, role: 'implementer', files: [`${task}.js`], now: NOW })
  const capped = par.checkParallel(state, { task: 'c', files: ['c.js'], maxParallel: 2, now: NOW })
  assert.equal(capped.ok, false)
  assert.match(capped.reason, /max_parallel is 2/)
  assert.equal(par.checkParallel(state, { task: 'c', files: ['c.js'], maxParallel: 0, now: NOW }).ok, true, '0 means no cap')
  const blocked = par.checkParallel({}, { task: 'c', files: [], depends: ['a', 'b'], done: (name) => name === 'a', now: NOW })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /depends on b/)
})

test('release frees the slot and stale entries are pruned', () => {
  const state = {}
  par.registerActive(state, { task: 'a', role: 'implementer', files: ['a.js'], now: NOW })
  assert.equal(par.releaseActive(state, 'a'), true)
  assert.equal(par.releaseActive(state, 'a'), false)
  par.registerActive(state, { task: 'old', role: 'implementer', files: ['a.js'], now: NOW - par.STALE_MS - 1 })
  state.active.broken = 'x'
  assert.deepEqual(par.pruneActive(state, NOW).sort(), ['broken', 'old'])
  assert.equal(par.checkParallel(state, { task: 'new', files: ['a.js'], now: NOW }).ok, true)
})

test('a whole-project or glob scope overlaps what it covers', () => {
  const state = {}
  par.registerActive(state, { task: 'a', role: 'implementer', files: ['src/users.js'], now: NOW })
  for (const scope of ['.', './', 'src/*.js', '**/*.js', 'src/**', '{src,lib}/x.js']) {
    const files = par.declaredFiles({ FILES: scope }, '').files
    assert.equal(par.checkParallel(state, { task: 'b', files, now: NOW }).ok, false, scope)
  }
  assert.deepEqual(par.declaredFiles({ FILES: 'src/*.js, lib/x.js' }, '').files, ['src/', 'lib/x.js'])
  assert.equal(par.checkParallel(state, { task: 'b', files: par.declaredFiles({ FILES: 'web/*.css' }, '').files, now: NOW }).ok, true, 'a glob elsewhere does not overlap')
})

test('a scope longer than the cap is the whole project, never cut short', () => {
  const many = Array.from({ length: 41 }, (_, i) => `src/f${i}.js`)
  const declared = par.declaredFiles({ FILES: many.join(', ') }, '')
  assert.deepEqual(declared.files, ['.'])
  const state = {}
  par.registerActive(state, { task: 'a', role: 'implementer', files: declared.files, now: NOW })
  assert.equal(par.checkParallel(state, { task: 'b', files: ['src/f40.js'], now: NOW }).ok, false)
  assert.deepEqual(par.declaredFiles({}, many.join(' ')).files, ['.'], 'the prompt fallback widens too')
  const direct = {}
  par.registerActive(direct, { task: 'a', role: 'implementer', files: many, now: NOW })
  assert.equal(par.checkParallel(direct, { task: 'b', files: ['src/f40.js'], now: NOW }).ok, false, 'registerActive never truncates')
})
