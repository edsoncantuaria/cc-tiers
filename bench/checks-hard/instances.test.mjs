import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import * as top from '../src/index.js'

// The top-level API of src/index.js before the task.
const API = [
  'configure', 'getConfig', 'now', 'setClock', 'resetClock',
  'createUser', 'getUser', 'listUsers', 'deactivateUser',
  'createShift', 'getShift', 'listShifts', 'updateShift', 'createRecurring',
  'claimShift', 'releaseShift', 'swapShift', 'hoursForUser', 'splitByLocalDay',
  'toCsv', 'shiftsCsv', 'payrollCsv', 'signToken', 'verifyToken',
  'saveAttachment', 'readAttachment', 'on', 'auditLog',
  'flush', 'sentMessages', 'failedMessages', 'setTransport', 'handle', 'reset',
]

const dirs = []
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

async function crew(app, prefix) {
  const manager = await app.createUser({ name: `${prefix} boss`, email: `boss@${prefix}.test`, role: 'manager' })
  const worker = await app.createUser({ name: `${prefix} worker`, email: `worker@${prefix}.test` })
  const shift = await app.createShift({ title: `${prefix} desk`, start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z', capacity: 2 })
  return { manager, worker, shift }
}

test('createApp returns the whole API, and the top level keeps it', () => {
  assert.equal(typeof top.createApp, 'function')
  const app = top.createApp()
  for (const name of API) {
    assert.equal(typeof top[name], 'function', `top-level ${name}`)
    assert.equal(typeof app[name], 'function', `app.${name}`)
  }
})

test('data, ids, and the shift cache are per app', async () => {
  const a = top.createApp()
  const b = top.createApp()
  assert.equal((await a.createUser({ name: 'Ana', email: 'ana@a.test' })).id, 'usr_1')
  assert.equal((await b.createUser({ name: 'Bia', email: 'bia@b.test' })).id, 'usr_1')
  assert.deepEqual((await a.listUsers()).map((user) => user.name), ['Ana'])
  assert.equal((await b.getUser('usr_1')).name, 'Bia')
  const first = await a.createShift({ title: 'A desk', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z' })
  assert.equal(first.id, 'shf_1')
  assert.equal((await a.getShift('shf_1')).title, 'A desk')
  assert.equal(await b.getShift('shf_1'), null)
  await b.createShift({ title: 'B desk', start: '2026-03-03T09:00:00Z', end: '2026-03-03T17:00:00Z' })
  assert.equal((await b.getShift('shf_1')).title, 'B desk')
  assert.equal((await a.getShift('shf_1')).title, 'A desk')
  assert.equal((await a.listShifts()).length, 1)
})

test('listeners, audit log, and outgoing messages are per app', async () => {
  const a = top.createApp()
  const b = top.createApp()
  const seen = []
  a.on('shift.claimed', (payload) => void seen.push(payload))
  await crew(a, 'a')
  const { worker, shift } = await crew(b, 'b')
  await b.claimShift(shift.id, worker.id)
  await b.flush()
  await a.flush()
  assert.deepEqual(seen, [])
  assert.equal(a.auditLog({ type: 'shift.claimed' }).length, 0)
  assert.equal(b.auditLog({ type: 'shift.claimed' }).length, 1)
  assert.deepEqual(a.sentMessages(), [])
  assert.equal(b.sentMessages().length, 1)
  assert.equal(b.sentMessages()[0].to, 'boss@b.test')
  const sent = []
  a.setTransport(async (message) => void sent.push(message))
  await b.releaseShift(shift.id, worker.id)
  await b.flush()
  assert.deepEqual(sent, [])
  assert.equal(b.sentMessages().length, 2)
})

test('configuration, secrets, and clocks are per app', async () => {
  const a = top.createApp({ secret: 'alpha', tokenTtlMs: 60_000 })
  const b = top.createApp({ secret: 'beta' })
  const fresh = top.createApp()
  assert.equal(a.getConfig().tokenTtlMs, 60_000)
  assert.equal(b.getConfig().tokenTtlMs, fresh.getConfig().tokenTtlMs)
  a.configure({ weeklyHoursLimit: 1 })
  assert.equal(b.getConfig().weeklyHoursLimit, 40)
  const token = a.signToken({ sub: 'usr_1', role: 'worker' })
  assert.equal(a.verifyToken(token).sub, 'usr_1')
  assert.throws(() => b.verifyToken(token), { status: 401 })
  a.setClock(() => 0)
  assert.equal(a.now(), 0)
  assert.ok(b.now() > 1e12)
  assert.ok(top.now() > 1e12)
  const { worker } = await crew(a, 'a')
  const login = await a.handle({ method: 'POST', path: '/tokens', body: { userId: worker.id } })
  const headers = { authorization: `Bearer ${login.body.token}` }
  assert.equal((await a.handle({ path: '/shifts', headers })).status, 200)
  assert.equal((await b.handle({ path: '/shifts', headers })).status, 401)
})

test('attachments go under each app filesRoot', async () => {
  const rootA = mkdtempSync(path.join(os.tmpdir(), 'shiftboard-a-'))
  const rootB = mkdtempSync(path.join(os.tmpdir(), 'shiftboard-b-'))
  dirs.push(rootA, rootB)
  const a = top.createApp({ filesRoot: rootA })
  const b = top.createApp({ filesRoot: rootB })
  const { shift } = await crew(a, 'a')
  await crew(b, 'b')
  await a.saveAttachment(shift.id, 'notes.txt', 'for a')
  assert.ok(existsSync(path.join(rootA, shift.id, 'notes.txt')))
  assert.equal((await a.readAttachment(shift.id, 'notes.txt')).toString(), 'for a')
  await assert.rejects(b.readAttachment(shift.id, 'notes.txt'), { status: 404 })
})

test('a top-level call made from inside an app callback still reaches the top-level app', async () => {
  top.reset()
  await top.createUser({ name: 'Top', email: 'top@top.test' })
  const a = top.createApp()
  const { worker, shift } = await crew(a, 'a')
  let seen = null
  a.on('shift.claimed', async () => {
    seen = (await top.listUsers()).map((user) => user.name)
  })
  await a.claimShift(shift.id, worker.id)
  assert.deepEqual(seen, ['Top'])
  let count = null
  top.on('user.created', async () => {
    count = (await a.listUsers()).length
  })
  await top.createUser({ name: 'Top 2', email: 'top2@top.test' })
  assert.equal(count, 2)
  top.reset()
})

test('the top-level API is its own app, as before', async () => {
  const a = top.createApp()
  await a.createUser({ name: 'Ana', email: 'ana@a.test' })
  top.reset()
  top.configure({ weeklyHoursLimit: 5 })
  assert.equal(top.createApp().getConfig().weeklyHoursLimit, 40)
  assert.equal(a.getConfig().weeklyHoursLimit, 40)
  const { manager, worker, shift } = await crew(top, 'top')
  assert.equal(manager.id, 'usr_1')
  assert.equal(shift.id, 'shf_1')
  assert.equal((await a.listUsers()).length, 1)
  await assert.rejects(top.claimShift(shift.id, worker.id), /5 hours/)
  top.reset()
  assert.equal((await top.listUsers()).length, 0)
  assert.equal((await a.listUsers()).length, 1)
  await crew(top, 'top')
  await top.claimShift('shf_1', 'usr_2')
  await top.flush()
  assert.equal(top.auditLog({ type: 'shift.claimed' }).length, 1)
  assert.equal(top.sentMessages().length, 1)
})
