import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { configure, createShift, createUser, handle, readAttachment, reset, saveAttachment } from '../src/index.js'

// base/secret.txt and base/files/secret.txt sit outside every shift folder; base/files is filesRoot.
const base = mkdtempSync(path.join(os.tmpdir(), 'shiftboard-traversal-'))
const files = path.join(base, 'files')
const SECRET = 'TOP-SECRET'
let headers

before(async () => {
  reset()
  mkdirSync(files)
  writeFileSync(path.join(base, 'secret.txt'), SECRET)
  writeFileSync(path.join(files, 'secret.txt'), SECRET)
  configure({ filesRoot: files })
  const worker = await createUser({ name: 'Ana', email: 'ana@shiftboard.test' })
  for (let day = 1; day <= 10; day += 1) {
    const date = `2026-03-${String(day).padStart(2, '0')}`
    await createShift({ title: `Desk ${day}`, start: `${date}T09:00:00Z`, end: `${date}T17:00:00Z` })
  }
  await saveAttachment('shf_1', 'notes.txt', 'shift one notes')
  await saveAttachment('shf_1', 'plan..v2.txt', 'version two')
  await saveAttachment('shf_10', 'private.txt', 'shift ten only')
  mkdirSync(path.join(files, 'shf_1', 'drafts'))
  symlinkSync(path.join(base, 'secret.txt'), path.join(files, 'shf_1', 'link.txt'))
  const { body } = await handle({ method: 'POST', path: '/tokens', body: { userId: worker.id } })
  headers = { authorization: `Bearer ${body.token}` }
})

after(() => rmSync(base, { recursive: true, force: true }))

const get = (shiftId, name) => handle({ path: `/shifts/${shiftId}/attachments/${name}`, headers })

test('stored attachments are still served', async () => {
  for (const [shiftId, name, content] of [
    ['shf_1', 'notes.txt', 'shift one notes'],
    ['shf_1', 'plan..v2.txt', 'version two'],
    ['shf_10', 'private.txt', 'shift ten only'],
  ]) {
    const response = await get(shiftId, encodeURIComponent(name))
    assert.equal(response.status, 200, `${shiftId}/${name}`)
    assert.equal(Buffer.from(response.body).toString(), content)
    assert.equal((await readAttachment(shiftId, name)).toString(), content)
  }
})

test('nothing outside the shift folder is served over HTTP', async () => {
  const attempts = [
    ['shf_1', '..%2F..%2Fsecret.txt'],
    ['shf_1', '..%2Fsecret.txt'],
    ['shf_1', '%2e%2e%2fsecret.txt'],
    ['shf_1', encodeURIComponent(path.join(base, 'secret.txt'))],
    ['shf_1', '..%2Fshf_10%2Fprivate.txt'],
    ['shf_1', 'link.txt'],
    ['shf_1', 'drafts'],
    ['shf_1', '.'],
    ['shf_1', 'notes.txt%00.png'],
    ['shf_1', 'missing.txt'],
    ['.', 'secret.txt'],
    ['%2e%2e', 'secret.txt'],
    ['shf_1%2F..', 'secret.txt'],
    ['shf_99', 'notes.txt'],
  ]
  for (const [shiftId, name] of attempts) {
    const response = await get(shiftId, name)
    assert.equal(response.status, 404, `/shifts/${shiftId}/attachments/${name} gave ${response.status}`)
    assert.equal(String(Buffer.isBuffer(response.body) ? response.body : JSON.stringify(response.body)).includes(SECRET), false)
  }
})

test('readAttachment itself refuses the same names with a NotFoundError', async () => {
  const attempts = [
    ['shf_1', '../../secret.txt'],
    ['shf_1', '../shf_10/private.txt'],
    ['shf_1', path.join(base, 'secret.txt')],
    ['shf_1', 'link.txt'],
    ['shf_1', 'drafts'],
    ['shf_1', 'notes.txt\0.png'],
    ['shf_1/..', 'secret.txt'],
    ['..', 'secret.txt'],
    ['shf_1', ''],
    [undefined, 'notes.txt'],
  ]
  for (const [shiftId, name] of attempts) {
    await assert.rejects(readAttachment(shiftId, name), { status: 404 }, `${shiftId} ${JSON.stringify(name)}`)
  }
})
