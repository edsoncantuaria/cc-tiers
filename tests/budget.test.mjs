import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { BUDGET_OVERRIDE_RE, budgetMessage, budgetStatus, parseTaskBudget } = await import(
  pathToFileURL(path.join(ROOT, 'hooks', 'budget.mjs')).href
)

const NOW = 10 * 60000
const limits = (extra) => ({ usd: 0, calls: 0, minutes: 0, warnAt: 0.8, ...extra })

test('parseTaskBudget reads numbers and numeric strings, 0 means off', () => {
  assert.deepEqual(
    parseTaskBudget({ task_budget_usd: '2.5', task_budget_calls: 6, task_budget_minutes: '30', budget_warn_at: '90' }),
    { usd: 2.5, calls: 6, minutes: 30, warnAt: 0.9 },
  )
  assert.deepEqual(parseTaskBudget({}), { usd: 0, calls: 0, minutes: 0, warnAt: 0.8 })
  assert.deepEqual(parseTaskBudget(undefined), { usd: 0, calls: 0, minutes: 0, warnAt: 0.8 })
})

test('parseTaskBudget turns negatives, NaN, empty and junk into 0', () => {
  const parsed = parseTaskBudget({
    task_budget_usd: -1,
    task_budget_calls: NaN,
    task_budget_minutes: '',
    budget_warn_at: 'abc',
  })
  assert.deepEqual(parsed, { usd: 0, calls: 0, minutes: 0, warnAt: 0.8 })
  assert.equal(parseTaskBudget({ task_budget_usd: 'abc' }).usd, 0)
  assert.equal(parseTaskBudget({ task_budget_calls: Infinity }).calls, 0)
  assert.equal(parseTaskBudget({ task_budget_calls: true }).calls, 0)
})

test('parseTaskBudget keeps warnAt within 0.5 and 0.99', () => {
  assert.equal(parseTaskBudget({ budget_warn_at: 50 }).warnAt, 0.5)
  assert.equal(parseTaskBudget({ budget_warn_at: 99 }).warnAt, 0.99)
  assert.equal(parseTaskBudget({ budget_warn_at: 10 }).warnAt, 0.5)
  assert.equal(parseTaskBudget({ budget_warn_at: 150 }).warnAt, 0.99)
  assert.equal(parseTaskBudget({ budget_warn_at: 0 }).warnAt, 0.8)
})

test('budgetStatus is off when every limit is 0 or missing', () => {
  const status = budgetStatus({ usd: 99, calls: 99, startedMs: 1 }, limits(), { now: NOW })
  assert.equal(status.state, 'off')
  assert.deepEqual(status.over, [])
  assert.equal(budgetStatus({ calls: 5 }, undefined).state, 'off')
})

test('budgetStatus is ok below the warning fraction', () => {
  const status = budgetStatus({ calls: 3 }, limits({ calls: 10 }), { now: NOW })
  assert.equal(status.state, 'ok')
  assert.deepEqual(status.over, [])
  assert.deepEqual(status.near, [])
})

test('budgetStatus is near at warnAt * limit and names the limit', () => {
  const status = budgetStatus({ calls: 8, usd: 0.1 }, limits({ calls: 10, usd: 5 }), { now: NOW })
  assert.equal(status.state, 'near')
  assert.deepEqual(status.near, ['calls'])
  assert.deepEqual(status.over, [])
  assert.equal(budgetStatus({ calls: 5 }, limits({ calls: 10, warnAt: 0.5 }), { now: NOW }).state, 'near')
})

test('budgetStatus is near exactly at the warn percent, with no float error at the boundary', () => {
  const at55 = parseTaskBudget({ task_budget_calls: 100, budget_warn_at: 55 })
  assert.equal(budgetStatus({ calls: 55 }, at55, { now: NOW }).state, 'near')
  assert.equal(budgetStatus({ calls: 54 }, at55, { now: NOW }).state, 'ok')
  for (let pct = 50; pct <= 99; pct += 1) {
    const { warnAt } = parseTaskBudget({ budget_warn_at: pct })
    for (let limit = 1; limit <= 500; limit += 1) {
      const first = Math.ceil((pct * limit) / 100)
      const at = budgetStatus({ calls: first }, limits({ calls: limit, warnAt }), { now: NOW }).state
      assert.equal(at, first >= limit ? 'over' : 'near', `warn ${pct} limit ${limit} calls ${first}`)
      const before = budgetStatus({ calls: first - 1 }, limits({ calls: limit, warnAt }), { now: NOW }).state
      assert.equal(before, 'ok', `warn ${pct} limit ${limit} calls ${first - 1}`)
    }
  }
})

test('budgetStatus is over at value >= limit, for each limit', () => {
  assert.deepEqual(budgetStatus({ calls: 10 }, limits({ calls: 10 }), { now: NOW }).over, ['calls'])
  assert.deepEqual(budgetStatus({ usd: 2.5 }, limits({ usd: 2.5 }), { now: NOW }).over, ['usd'])
  const timed = budgetStatus({ startedMs: 1 }, limits({ minutes: 5 }), { now: NOW })
  assert.equal(timed.state, 'over')
  assert.deepEqual(timed.over, ['minutes'])
  const both = budgetStatus({ calls: 12, usd: 4 }, limits({ calls: 10, usd: 5 }), { now: NOW })
  assert.equal(both.state, 'over')
  assert.deepEqual(both.over, ['calls'])
  assert.deepEqual(both.near, ['usd'])
})

test('budgetStatus separates measured values from the usd estimate', () => {
  const status = budgetStatus({ usd: 1.5, calls: 4, startedMs: 4 * 60000 }, limits({ calls: 10 }), { now: NOW })
  assert.deepEqual(status.measured, { calls: 4, elapsedMinutes: 6 })
  assert.deepEqual(status.estimated, { usd: 1.5 })
})

test('budgetStatus has 0 elapsed minutes when startedMs is 0', () => {
  const status = budgetStatus({ calls: 1 }, limits({ minutes: 1 }), { now: NOW })
  assert.equal(status.measured.elapsedMinutes, 0)
  assert.equal(status.state, 'ok')
})

test('budgetStatus treats negative or non-finite usage as 0', () => {
  const status = budgetStatus(
    { usd: -3, calls: NaN, startedMs: Infinity },
    limits({ usd: 1, calls: 1, minutes: 1 }),
    { now: NOW },
  )
  assert.equal(status.state, 'ok')
  assert.deepEqual(status.measured, { calls: 0, elapsedMinutes: 0 })
  assert.deepEqual(status.estimated, { usd: 0 })
  assert.equal(budgetStatus(undefined, limits({ calls: 1 })).state, 'ok')
})

test('budgetStatus treats partial or invalid limits as off', () => {
  const status = budgetStatus({ calls: 5 }, { calls: 5, usd: -2, minutes: 'x' }, { now: NOW })
  assert.equal(status.state, 'over')
  assert.deepEqual(status.over, ['calls'])
})

test('budgetMessage is empty for off and ok', () => {
  assert.equal(budgetMessage('t1', budgetStatus({ calls: 9 }, limits(), { now: NOW })), '')
  assert.equal(budgetMessage('t1', budgetStatus({ calls: 1 }, limits({ calls: 10 }), { now: NOW })), '')
})

test('budgetMessage warns in one line for near, with value/limit', () => {
  const status = budgetStatus({ calls: 8, startedMs: 1 }, limits({ calls: 10, minutes: 12 }), { now: NOW })
  const message = budgetMessage('t1', status)
  assert.ok(!message.includes('\n'))
  assert.match(message, /t1/)
  assert.match(message, /calls 8\/10/)
  assert.match(message, /minutes 10\/12/)
  assert.doesNotMatch(message, /refuses/)
})

test('budgetMessage for over names limits, the refusal, what still runs and the override line', () => {
  const status = budgetStatus({ calls: 10, usd: 2.5 }, limits({ calls: 10, usd: 2 }), { now: NOW })
  const message = budgetMessage('t1', status)
  assert.match(message, /t1 reached its budget/)
  assert.match(message, /calls 10\/10/)
  assert.match(message, /usd about \$2\.50 \(estimated\) \/ about \$2\.00/)
  assert.match(message, /refuses new writer calls/)
  assert.match(message, /review and verification calls still run/)
  assert.match(message, /after the user agrees/i)
  assert.ok(message.includes('CC_TIERS_BUDGET: override - <reason>'))
  assert.doesNotMatch(message, /critical/)
})

test('budgetMessage for a critical task asks for the user decision', () => {
  const over = budgetStatus({ calls: 10 }, limits({ calls: 10 }), { now: NOW, critical: true })
  const message = budgetMessage('t1', over)
  assert.match(message, /critical/)
  assert.match(message, /unverified/)
  assert.match(message, /user's decision/)
  const near = budgetStatus({ calls: 8 }, limits({ calls: 10 }), { now: NOW, critical: true })
  assert.doesNotMatch(budgetMessage('t1', near), /critical/)
})

test('BUDGET_OVERRIDE_RE needs override, a dash and a reason', () => {
  assert.ok(BUDGET_OVERRIDE_RE.test('override - user approved 2 more attempts'))
  assert.ok(BUDGET_OVERRIDE_RE.test('Override-ok'))
  assert.ok(BUDGET_OVERRIDE_RE.test('OVERRIDE  -  because'))
  assert.ok(!BUDGET_OVERRIDE_RE.test('override'))
  assert.ok(!BUDGET_OVERRIDE_RE.test('override -'))
  assert.ok(!BUDGET_OVERRIDE_RE.test('override - '))
  assert.ok(!BUDGET_OVERRIDE_RE.test('none - reason'))
})
