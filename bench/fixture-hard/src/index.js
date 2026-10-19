import { startAudit, resetAudit } from './audit.js'
import { resetClock } from './clock.js'
import { resetConfig } from './config.js'
import { resetEvents } from './events.js'
import { resetIds } from './ids.js'
import { resetNotify, startNotifier } from './notify.js'
import { buildRoutes } from './routes.js'
import { forgetCached } from './shifts.js'
import { resetStore } from './store.js'

export { configure, getConfig } from './config.js'
export { now, setClock, resetClock } from './clock.js'
export { createUser, getUser, listUsers, deactivateUser } from './users.js'
export { createShift, getShift, listShifts, updateShift } from './shifts.js'
export { createRecurring } from './recurring.js'
export { claimShift, releaseShift, swapShift } from './booking.js'
export { hoursForUser, splitByLocalDay } from './payroll.js'
export { toCsv, shiftsCsv, payrollCsv } from './reports.js'
export { signToken, verifyToken } from './auth.js'
export { saveAttachment, readAttachment } from './attachments.js'
export { on } from './events.js'
export { auditLog } from './audit.js'
export { flush, sentMessages, failedMessages, setTransport } from './notify.js'

const router = buildRoutes()

export function handle(request) {
  return router.handle(request)
}

let stops = []

function start() {
  stops = [startAudit(), startNotifier()]
}

/** Back to a fresh process: default config and clock, empty store, ids from 1, only the built-in listeners. */
export function reset() {
  stops.forEach((stop) => stop())
  resetConfig()
  resetClock()
  resetIds()
  resetStore()
  forgetCached()
  resetEvents()
  resetAudit()
  resetNotify()
  start()
}

start()
