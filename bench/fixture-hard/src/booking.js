import { getConfig } from './config.js'
import { ConflictError, NotFoundError } from './errors.js'
import { emit } from './events.js'
import { splitByLocalDay, sumMinutes, weekMinutes } from './payroll.js'
import { listShifts, requireShift, saveShift } from './shifts.js'
import { localDate, weekStart } from './time.js'
import { requireUser } from './users.js'

/**
 * The rules for putting a worker on a shift, apart from capacity: no two
 * overlapping shifts, and no more than weeklyHoursLimit in one local week.
 */
async function checkAvailability(user, shift) {
  const mine = await listShifts({ assignee: user.id })
  const clash = mine.find((other) => other.id !== shift.id && other.start < shift.end && shift.start < other.end)
  if (clash) throw new ConflictError(`${shift.id} overlaps ${clash.id} for ${user.id}`)
  const date = localDate(shift.start, shift.zone)
  const limit = getConfig().weeklyHoursLimit
  const booked = await weekMinutes(user.id, date)
  if (booked + sumMinutes(splitByLocalDay(shift)) > limit * 60) {
    throw new ConflictError(`${user.id} would work more than ${limit} hours in the week of ${weekStart(date)}`)
  }
}

export async function claimShift(shiftId, userId) {
  const shift = await requireShift(shiftId)
  const user = await requireUser(userId)
  if (shift.assignees.includes(user.id)) throw new ConflictError(`${user.id} already works ${shift.id}`)
  if (shift.assignees.length >= shift.capacity) throw new ConflictError('Shift capacity excceded')
  await checkAvailability(user, shift)
  shift.assignees.push(user.id)
  shift.status = shift.assignees.length >= shift.capacity ? 'full' : 'open'
  const saved = await saveShift(shift)
  await emit('shift.claimed', { shiftId: shift.id, userId: user.id })
  return saved
}

export async function releaseShift(shiftId, userId) {
  const shift = await requireShift(shiftId)
  if (!shift.assignees.includes(userId)) throw new NotFoundError(`${userId} does not work ${shiftId}`)
  shift.assignees = shift.assignees.filter((id) => id !== userId)
  shift.status = 'open'
  const saved = await saveShift(shift)
  await emit('shift.released', { shiftId, userId })
  return saved
}

/** Hands one worker's place on a shift to another worker, who must be free for it. */
export async function swapShift(shiftId, fromUserId, toUserId) {
  const shift = await requireShift(shiftId)
  if (!shift.assignees.includes(fromUserId)) throw new NotFoundError(`${fromUserId} does not work ${shiftId}`)
  const user = await requireUser(toUserId)
  if (shift.assignees.includes(user.id)) throw new ConflictError(`${user.id} already works ${shift.id}`)
  await checkAvailability(user, shift)
  shift.assignees = shift.assignees.map((id) => (id === fromUserId ? user.id : id))
  const saved = await saveShift(shift)
  await emit('shift.swapped', { shiftId, from: fromUserId, to: user.id })
  return saved
}
