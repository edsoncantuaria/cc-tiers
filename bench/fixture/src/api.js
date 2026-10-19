import { fetchUser, listUsers, validateEmail } from './users.js'
import { chunk, slugify } from './text.js'

export function getProfile(id) {
  if (!Number.isInteger(id)) throw new TypeError(`Recieved invalid id: ${id}`)
  const user = fetchUser(id)
  if (!user) return null
  return { ...user, slug: slugify(user.name) }
}

export function inviteUser(email) {
  if (!validateEmail(email)) return { ok: false, error: 'invalid email' }
  return { ok: true, email }
}

export function directoryPages(pageSize = 5) {
  return chunk(listUsers(), pageSize).map((page) => page.map((user) => user.name))
}
