import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as payroll from '../src/payroll.js'

test('sumMinutes is now totalMinutes everywhere', () => {
  assert.equal(typeof payroll.totalMinutes, 'function')
  assert.equal('sumMinutes' in payroll, false)
  assert.equal(payroll.totalMinutes([{ minutes: 5 }, { minutes: 7 }]), 12)
  for (const dir of ['src', 'test']) {
    for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      const text = readFileSync(new URL(`../${dir}/${name}`, import.meta.url), 'utf8')
      assert.equal(text.includes('sumMinutes'), false, `${dir}/${name}`)
    }
  }
})
