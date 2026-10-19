import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimShift, createShift, payrollCsv, shiftsCsv, toCsv } from '../src/index.js'
import { seed } from './seed.mjs'

test('toCsv writes a header and one line per row', () => {
  const text = toCsv([{ a: 1, b: 'x' }, { a: 2, b: null }], [
    { label: 'a', value: (row) => row.a },
    { label: 'b', value: (row) => row.b },
  ])
  assert.equal(text, 'a,b\n1,x\n2,\n')
})

test('shiftsCsv shows local times and worker names', async () => {
  const { ana } = await seed()
  const shift = await createShift({ title: 'Dock', location: 'Pier 4', start: '2026-03-02T09:00:00-05:00', end: '2026-03-02T17:00:00-05:00', zone: 'America/New_York' })
  await claimShift(shift.id, ana.id)
  const lines = (await shiftsCsv()).trim().split('\n')
  assert.equal(lines[0], 'id,title,location,start,end,zone,workers')
  assert.equal(lines[1], 'shf_1,Dock,Pier 4,2026-03-02 09:00,2026-03-02 17:00,America/New_York,Ana')
})

test('payrollCsv sums hours per worker', async () => {
  const { ana } = await seed()
  const shift = await createShift({ title: 'Dock', start: '2026-03-02T09:00:00-05:00', end: '2026-03-02T13:30:00-05:00', zone: 'America/New_York' })
  await claimShift(shift.id, ana.id)
  const lines = (await payrollCsv({ from: '2026-03-01', to: '2026-03-31' })).trim().split('\n')
  assert.deepEqual(lines, ['user,name,hours', 'usr_2,Ana,4.50', 'usr_3,Bruno,0.00'])
})
