import { createShift, createUser, handle, reset } from '../src/index.js'

/** A clean app with one manager (usr_1) and two workers (usr_2, usr_3). */
export async function seed() {
  reset()
  const manager = await createUser({ name: 'Marta', email: 'marta@shiftboard.test', role: 'manager', zone: 'America/New_York' })
  const ana = await createUser({ name: 'Ana', email: 'ana@shiftboard.test', zone: 'America/New_York' })
  const bruno = await createUser({ name: 'Bruno', email: 'bruno@shiftboard.test', zone: 'America/New_York' })
  return { manager, ana, bruno }
}

/** A shift in New York on a given day, from `from` to `to` local hours. */
export function nyShift(day, from = '09:00', to = '17:00', extra = {}) {
  return createShift({ title: `Desk ${day}`, start: `${day}T${from}:00-05:00`, end: `${day}T${to}:00-05:00`, zone: 'America/New_York', ...extra })
}

export async function tokenFor(userId) {
  const response = await handle({ method: 'POST', path: '/tokens', body: { userId } })
  return { authorization: `Bearer ${response.body.token}` }
}
