import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { configure, handle, saveAttachment } from '../src/index.js'
import { nyShift, seed, tokenFor } from './seed.mjs'

const root = mkdtempSync(path.join(os.tmpdir(), 'shiftboard-http-'))
after(() => rmSync(root, { recursive: true, force: true }))

test('routes need a token, and managers for manager routes', async () => {
  const { manager, ana } = await seed()
  assert.equal((await handle({ path: '/shifts' })).status, 401)
  const worker = await tokenFor(ana.id)
  assert.equal((await handle({ path: '/shifts', headers: worker })).status, 200)
  assert.equal((await handle({ path: '/users', headers: worker })).status, 403)
  assert.equal((await handle({ path: '/users', headers: await tokenFor(manager.id) })).body.length, 3)
  assert.equal((await handle({ path: '/nowhere', headers: worker })).status, 404)
  assert.equal((await handle({ method: 'DELETE', path: '/shifts', headers: worker })).status, 405)
  assert.equal((await handle({ method: 'POST', path: '/tokens', body: { userId: 'usr_9' } })).status, 404)
})

test('a manager publishes a shift and a worker claims it', async () => {
  const { manager, ana } = await seed()
  const boss = await tokenFor(manager.id)
  const worker = await tokenFor(ana.id)
  const created = await handle({
    method: 'POST',
    path: '/shifts',
    headers: boss,
    body: { title: 'Bar', start: '2026-03-02T18:00:00-05:00', end: '2026-03-02T23:00:00-05:00', zone: 'America/New_York' },
  })
  assert.equal(created.status, 201)
  const claimed = await handle({ method: 'POST', path: `/shifts/${created.body.id}/claim`, headers: worker })
  assert.deepEqual(claimed.body.assignees, [ana.id])
  const again = await handle({ method: 'POST', path: `/shifts/${created.body.id}/claim`, headers: worker })
  assert.equal(again.status, 409)
  const listed = await handle({ path: `/shifts?assignee=${ana.id}`, headers: worker })
  assert.equal(listed.body.length, 1)
  assert.equal((await handle({ path: '/shifts?status=bogus', headers: worker })).status, 400)
  const payroll = await handle({ path: `/payroll/${ana.id}?from=2026-03-01&to=2026-03-31`, headers: worker })
  assert.equal(payroll.body.totalHours, 5)
  assert.equal((await handle({ path: `/payroll/${manager.id}`, headers: worker })).status, 403)
})

test('attachments over HTTP', async () => {
  const { manager, ana } = await seed()
  configure({ filesRoot: root })
  const shift = await nyShift('2026-03-02')
  await saveAttachment(shift.id, 'plan.txt', 'stock the fridge')
  const worker = await tokenFor(ana.id)
  const ok = await handle({ path: `/shifts/${shift.id}/attachments/plan.txt`, headers: worker })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.toString(), 'stock the fridge')
  assert.equal((await handle({ path: `/shifts/${shift.id}/attachments/nope.txt`, headers: worker })).status, 404)
  const put = await handle({ method: 'PUT', path: `/shifts/${shift.id}/attachments/map.txt`, headers: await tokenFor(manager.id), body: { content: 'x' } })
  assert.equal(put.status, 201)
  assert.equal((await handle({ method: 'PUT', path: `/shifts/${shift.id}/attachments/map.txt`, headers: worker, body: { content: 'x' } })).status, 403)
})
