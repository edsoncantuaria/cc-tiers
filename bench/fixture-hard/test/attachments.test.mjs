import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { configure, readAttachment, saveAttachment } from '../src/index.js'
import { nyShift, seed } from './seed.mjs'

const root = mkdtempSync(path.join(os.tmpdir(), 'shiftboard-files-'))
after(() => rmSync(root, { recursive: true, force: true }))

test('an attachment round-trips', async () => {
  await seed()
  configure({ filesRoot: root })
  const shift = await nyShift('2026-03-02')
  assert.deepEqual(await saveAttachment(shift.id, 'notes.txt', 'bring keys'), { shiftId: shift.id, name: 'notes.txt', bytes: 10 })
  assert.equal((await readAttachment(shift.id, 'notes.txt')).toString(), 'bring keys')
  await assert.rejects(readAttachment(shift.id, 'missing.txt'), { status: 404 })
})

test('saveAttachment refuses odd names and big files', async () => {
  await seed()
  configure({ filesRoot: root, maxAttachmentBytes: 4 })
  const shift = await nyShift('2026-03-02')
  await assert.rejects(saveAttachment(shift.id, '../x.txt', 'a'), /bad attachment name/)
  await assert.rejects(saveAttachment(shift.id, '.hidden', 'a'), /bad attachment name/)
  await assert.rejects(saveAttachment(shift.id, 'big.txt', 'abcde'), /too large/)
  await assert.rejects(saveAttachment('shf_9', 'a.txt', 'a'), { status: 404 })
})
