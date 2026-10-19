import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimShift, configure, failedMessages, flush, releaseShift, sentMessages, setTransport } from '../src/index.js'
import { nyShift, seed } from './seed.mjs'

test('managers hear about claims and releases', async () => {
  const { ana } = await seed()
  const shift = await nyShift('2026-03-02')
  await claimShift(shift.id, ana.id)
  await releaseShift(shift.id, ana.id)
  await flush()
  assert.deepEqual(sentMessages(), [
    { to: 'marta@shiftboard.test', subject: `${ana.id} claimed Desk 2026-03-02` },
    { to: 'marta@shiftboard.test', subject: `${ana.id} released Desk 2026-03-02` },
  ])
})

test('deliveries respect notifyConcurrency and failures are kept', async () => {
  const { ana, bruno } = await seed()
  configure({ notifyConcurrency: 1 })
  let active = 0
  let peak = 0
  setTransport(async (message) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    if (message.subject.includes(bruno.id)) throw new Error('mailbox full')
  })
  const first = await nyShift('2026-03-02', '09:00', '17:00', { capacity: 2 })
  await claimShift(first.id, ana.id)
  await claimShift(first.id, bruno.id)
  await flush()
  assert.equal(peak, 1)
  assert.equal(failedMessages().length, 1)
  assert.equal(failedMessages()[0].error, 'mailbox full')
})
