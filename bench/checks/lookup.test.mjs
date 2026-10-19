import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('the lookup changed no files and named the caller', () => {
  const diff = execFileSync('git', ['status', '--porcelain', '--', 'src', 'test'], { encoding: 'utf8' })
  assert.equal(diff.trim(), '')
  assert.match(process.env.BENCH_RESULT || '', /api\.js/)
  assert.match(process.env.BENCH_RESULT || '', /inviteUser/)
})
