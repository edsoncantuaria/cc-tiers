import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('the lookup changed no files and named both listeners', () => {
  const diff = execFileSync('git', ['status', '--porcelain', '--', 'src', 'test'], { encoding: 'utf8' })
  assert.equal(diff.trim(), '')
  const answer = process.env.BENCH_RESULT || ''
  // audit.js registers it through a list of types, so a grep for the string alone finds only notify.js.
  assert.match(answer, /audit\.js/)
  assert.match(answer, /startAudit/)
  assert.match(answer, /notify\.js/)
  assert.match(answer, /startNotifier/)
})
