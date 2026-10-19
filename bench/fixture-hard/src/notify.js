import { getConfig } from './config.js'
import { on } from './events.js'
import { getShift } from './shifts.js'
import { listUsers } from './users.js'

const outbox = []
const failed = []
const queue = []
let running = 0
let waiting = []

async function defaultTransport(message) {
  outbox.push(message)
}

let transport = defaultTransport

/** Replaces the delivery function, e.g. with an SMTP client. It receives { to, subject }. */
export function setTransport(fn) {
  transport = fn
}

/** Queues a message. At most notifyConcurrency deliveries run at once; a failed one is kept in failedMessages(). */
export function notify(message) {
  queue.push(message)
  pump()
}

function pump() {
  while (running < getConfig().notifyConcurrency && queue.length) {
    const message = queue.shift()
    running += 1
    Promise.resolve()
      .then(() => transport(message))
      .catch((error) => void failed.push({ ...message, error: String(error?.message || error) }))
      .finally(() => {
        running -= 1
        pump()
        if (!running && !queue.length) {
          const resolve = waiting
          waiting = []
          resolve.forEach((fn) => fn())
        }
      })
  }
}

/** Resolves once every queued message was delivered or failed. */
export function flush() {
  if (!running && !queue.length) return Promise.resolve()
  return new Promise((resolve) => waiting.push(resolve))
}

async function tellManagers(subject) {
  for (const manager of await listUsers({ role: 'manager' })) notify({ to: manager.email, subject })
}

/** Tells every manager when a worker takes or drops a shift. Returns a function that stops it. */
export function startNotifier() {
  const stops = [
    on('shift.claimed', async ({ shiftId, userId }) => {
      const shift = await getShift(shiftId)
      await tellManagers(`${userId} claimed ${shift?.title ?? shiftId}`)
    }),
    on('shift.released', async ({ shiftId, userId }) => {
      const shift = await getShift(shiftId)
      await tellManagers(`${userId} released ${shift?.title ?? shiftId}`)
    }),
  ]
  return () => stops.forEach((stop) => stop())
}

export function sentMessages() {
  return outbox.map((message) => ({ ...message }))
}

export function failedMessages() {
  return failed.map((message) => ({ ...message }))
}

export function resetNotify() {
  outbox.length = 0
  failed.length = 0
  queue.length = 0
  transport = defaultTransport
}
