import { getConfig } from './config.js'
import { ConflictError, NotFoundError, ValidationError } from './errors.js'
import { emit } from './events.js'
import { nextId } from './ids.js'
import { db } from './store.js'
import { isValidZone } from './time.js'
import { requireEmail, requireOneOf, requireString } from './validate.js'

export const ROLES = ['worker', 'manager']

export async function createUser({ name, email, role = 'worker', zone } = {}) {
  const user = {
    id: '',
    name: requireString(name, 'name', { max: 80 }),
    email: requireEmail(email),
    role: requireOneOf(role, 'role', ROLES),
    zone: zone ?? getConfig().defaultZone,
    active: true,
  }
  if (!isValidZone(user.zone)) throw new ValidationError(`unknown time zone: ${user.zone}`)
  const existing = await db.list('user:')
  if (existing.some((other) => other.email === user.email)) throw new ConflictError(`email already in use: ${user.email}`)
  user.id = nextId('usr')
  await db.put(`user:${user.id}`, user)
  await emit('user.created', { userId: user.id })
  return user
}

export async function getUser(id) {
  return db.get(`user:${id}`)
}

/** An active user, or a NotFoundError: a deactivated worker cannot be booked. */
export async function requireUser(id) {
  const user = await getUser(id)
  if (!user || !user.active) throw new NotFoundError(`no such user: ${id}`)
  return user
}

export async function listUsers({ role } = {}) {
  const users = await db.list('user:')
  return role ? users.filter((user) => user.role === role) : users
}

export async function deactivateUser(id) {
  const user = await requireUser(id)
  user.active = false
  await db.put(`user:${id}`, user)
  await emit('user.deactivated', { userId: id })
  return user
}
