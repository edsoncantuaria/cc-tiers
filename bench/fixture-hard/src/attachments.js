import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getConfig } from './config.js'
import { AppError, NotFoundError, ValidationError } from './errors.js'
import { emit } from './events.js'
import { requireShift } from './shifts.js'

// Letters, digits, dot, dash, underscore; never starting with a dot.
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/

function root() {
  const dir = getConfig().filesRoot
  if (!dir) throw new AppError(500, 'no_files_root', 'filesRoot is not configured')
  return dir
}

/** Attachments live in <filesRoot>/<shift id>/<name>. */
export async function saveAttachment(shiftId, name, content) {
  const shift = await requireShift(shiftId)
  if (typeof name !== 'string' || !NAME.test(name)) throw new ValidationError(`bad attachment name: ${name}`)
  const data = Buffer.from(content)
  if (data.length > getConfig().maxAttachmentBytes) throw new ValidationError('attachment is too large')
  const dir = path.join(root(), shift.id)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), data)
  await emit('attachment.saved', { shiftId: shift.id, name })
  return { shiftId: shift.id, name, bytes: data.length }
}

export async function readAttachment(shiftId, name) {
  const file = path.resolve(root(), shiftId, name)
  try {
    return await readFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') throw new NotFoundError(`no attachment ${name} on ${shiftId}`)
    throw error
  }
}
