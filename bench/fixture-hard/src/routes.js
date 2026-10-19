import { readAttachment, saveAttachment } from './attachments.js'
import { requireRole, signToken } from './auth.js'
import { claimShift, releaseShift } from './booking.js'
import { ForbiddenError } from './errors.js'
import { hoursForUser } from './payroll.js'
import { createRecurring } from './recurring.js'
import { payrollCsv, shiftsCsv } from './reports.js'
import { createRouter } from './router.js'
import { createShift, listShifts, requireShift, updateShift } from './shifts.js'
import { createUser, listUsers, requireUser } from './users.js'

const MANAGER = ['manager']

/** A worker acts for themselves; a manager may name another user in the body. */
function actingUser(auth, body) {
  if (body?.userId && body.userId !== auth.sub) {
    requireRole(auth, MANAGER)
    return body.userId
  }
  return auth.sub
}

export function buildRoutes() {
  const router = createRouter()

  // Development login: no password, the user id is enough.
  router.add(
    'POST',
    '/tokens',
    async ({ body }) => {
      const user = await requireUser(body?.userId)
      return { status: 201, body: { token: signToken({ sub: user.id, role: user.role }) } }
    },
    { auth: false },
  )

  router.add('GET', '/users', async ({ auth }) => {
    requireRole(auth, MANAGER)
    return { body: await listUsers() }
  })

  router.add('POST', '/users', async ({ auth, body }) => {
    requireRole(auth, MANAGER)
    return { status: 201, body: await createUser(body ?? {}) }
  })

  router.add('GET', '/shifts', async ({ query }) => ({
    body: await listShifts({ status: query.status, assignee: query.assignee }),
  }))

  router.add('POST', '/shifts', async ({ auth, body }) => {
    requireRole(auth, MANAGER)
    return { status: 201, body: await createShift(body ?? {}) }
  })

  router.add('POST', '/shifts/recurring', async ({ auth, body }) => {
    requireRole(auth, MANAGER)
    return { status: 201, body: await createRecurring(body ?? {}) }
  })

  router.add('GET', '/shifts/:id', async ({ params }) => ({ body: await requireShift(params.id) }))

  router.add('PATCH', '/shifts/:id', async ({ auth, params, body }) => {
    requireRole(auth, MANAGER)
    return { body: await updateShift(params.id, body ?? {}) }
  })

  router.add('POST', '/shifts/:id/claim', async ({ auth, params, body }) => ({
    body: await claimShift(params.id, actingUser(auth, body)),
  }))

  router.add('POST', '/shifts/:id/release', async ({ auth, params, body }) => ({
    body: await releaseShift(params.id, actingUser(auth, body)),
  }))

  router.add('GET', '/shifts/:id/attachments/:name', async ({ params }) => ({
    body: await readAttachment(params.id, params.name),
  }))

  router.add('PUT', '/shifts/:id/attachments/:name', async ({ auth, params, body }) => {
    requireRole(auth, MANAGER)
    return { status: 201, body: await saveAttachment(params.id, params.name, body?.content ?? '') }
  })

  router.add('GET', '/payroll/:userId', async ({ auth, params, query }) => {
    if (auth.role !== 'manager' && auth.sub !== params.userId) throw new ForbiddenError('workers see only their own hours')
    return { body: await hoursForUser(params.userId, { from: query.from, to: query.to }) }
  })

  router.add('GET', '/reports/shifts.csv', async ({ auth, query }) => {
    requireRole(auth, MANAGER)
    return { body: await shiftsCsv({ status: query.status }) }
  })

  router.add('GET', '/reports/payroll.csv', async ({ auth, query }) => {
    requireRole(auth, MANAGER)
    return { body: await payrollCsv({ from: query.from, to: query.to }) }
  })

  return router
}
