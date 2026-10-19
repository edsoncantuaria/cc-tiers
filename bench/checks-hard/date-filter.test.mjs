import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimShift, createShift, createUser, handle, listShifts, reset } from '../src/index.js'

async function seed() {
  reset()
  const worker = await createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  // 23:30 in New York on 31 March is already 1 April in UTC.
  const lateNy = await createShift({ title: 'late NY', start: '2026-03-31T23:30:00-04:00', end: '2026-04-01T03:00:00-04:00', zone: 'America/New_York' })
  // 08:00 in Tokyo on 1 April is still 31 March in UTC.
  const earlyTokyo = await createShift({ title: 'early Tokyo', start: '2026-04-01T08:00:00+09:00', end: '2026-04-01T12:00:00+09:00', zone: 'Asia/Tokyo' })
  const midUtc = await createShift({ title: 'mid UTC', start: '2026-04-02T12:00:00Z', end: '2026-04-02T14:00:00Z', zone: 'UTC' })
  await claimShift(midUtc.id, worker.id)
  return { worker, lateNy, earlyTokyo, midUtc }
}

const titles = (shifts) => shifts.map((shift) => shift.title).sort()

test('from and to compare local dates in each shift zone', async () => {
  await seed()
  assert.deepEqual(titles(await listShifts({ to: '2026-03-31' })), ['late NY'])
  assert.deepEqual(titles(await listShifts({ from: '2026-04-01' })), ['early Tokyo', 'mid UTC'])
  assert.deepEqual(titles(await listShifts({ from: '2026-04-01', to: '2026-04-01' })), ['early Tokyo'])
  assert.deepEqual(titles(await listShifts({ from: '2026-03-31', to: '2026-04-02' })), ['early Tokyo', 'late NY', 'mid UTC'])
  assert.deepEqual(titles(await listShifts()), ['early Tokyo', 'late NY', 'mid UTC'])
})

test('date filters combine with status and assignee', async () => {
  const { worker } = await seed()
  assert.deepEqual(titles(await listShifts({ from: '2026-04-01', status: 'full' })), ['mid UTC'])
  assert.deepEqual(titles(await listShifts({ to: '2026-04-01', assignee: worker.id })), [])
})

test('bad dates are validation errors, even ones Date.parse would accept', async () => {
  await seed()
  for (const bad of ['2026-02-30', '2026-13-01', '2026-4-1', '04/01/2026', '2026-04-01T00:00:00Z']) {
    await assert.rejects(listShifts({ from: bad }), { status: 400 }, `from=${bad}`)
    await assert.rejects(listShifts({ to: bad }), { status: 400 }, `to=${bad}`)
  }
})

test('GET /shifts takes from and to', async () => {
  const { worker } = await seed()
  const { body } = await handle({ method: 'POST', path: '/tokens', body: { userId: worker.id } })
  const headers = { authorization: `Bearer ${body.token}` }
  const response = await handle({ path: '/shifts?from=2026-04-01&to=2026-04-01', headers })
  assert.equal(response.status, 200)
  assert.deepEqual(titles(response.body), ['early Tokyo'])
  assert.equal((await handle({ path: '/shifts?to=2026-03-31', headers })).body.length, 1)
  assert.equal((await handle({ path: '/shifts?from=2026-02-30', headers })).status, 400)
  assert.equal((await handle({ path: '/shifts?to=soon', headers })).status, 400)
})
