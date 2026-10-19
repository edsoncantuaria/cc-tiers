import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const load = async () => (await import('../src/calc.js')).evaluate

test('precedence, associativity, parentheses, unary minus, decimals and whitespace', async () => {
  const evaluate = await load()
  const cases = [
    ['8-3-2', 3], ['8/4/2', 1], ['2+3*4', 14], ['(2+3)*4', 20], ['((1+2)*(3+4))', 21],
    ['-(2+3)', -5], ['2*-3', -6], ['--2', 2], ['-2*-2', 4], ['.5+1', 1.5], ['1.25*4', 5],
    ['  7 *  ( 1 + 1 ) ', 14],
  ]
  for (const [expression, expected] of cases) assert.equal(evaluate(expression), expected, expression)
})

test('division by zero throws a RangeError', async () => {
  const evaluate = await load()
  for (const expression of ['1/0', '1/(2-2)']) assert.throws(() => evaluate(expression), RangeError, expression)
})

test('malformed input throws a SyntaxError', async () => {
  const evaluate = await load()
  for (const expression of ['', '2+', '(1', '1)', '1 2', 'abc', '1..2', '2*/3']) {
    assert.throws(() => evaluate(expression), SyntaxError, JSON.stringify(expression))
  }
})

test('the source does not use eval or Function', () => {
  const source = readFileSync(new URL('../src/calc.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/)
})
