import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { claimShift, createShift, createUser, reset } from '../src/index.js'

test('the capacity error is spelled right', async () => {
  reset()
  const ana = await createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  const bruno = await createUser({ name: 'Bruno', email: 'bruno@shiftboard.test' })
  const shift = await createShift({ title: 'Desk', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z' })
  await claimShift(shift.id, ana.id)
  await assert.rejects(claimShift(shift.id, bruno.id), /Shift capacity exceeded/)
  for (const name of readdirSync(new URL('../src/', import.meta.url))) {
    assert.equal(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8').includes('excceded'), false, name)
  }
})
