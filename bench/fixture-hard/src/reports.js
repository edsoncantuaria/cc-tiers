import { splitByLocalDay, sumMinutes } from './payroll.js'
import { listShifts } from './shifts.js'
import { formatLocal, parseLocalDate } from './time.js'
import { listUsers } from './users.js'

/** CSV text from rows and columns ({ label, value(row) }): a header line, then one line per row. */
export function toCsv(rows, columns) {
  const lines = [columns.map((column) => column.label).join(',')]
  for (const row of rows) lines.push(columns.map((column) => String(column.value(row) ?? '')).join(','))
  return `${lines.join('\n')}\n`
}

export async function shiftsCsv(filter = {}) {
  const names = new Map((await listUsers()).map((user) => [user.id, user.name]))
  const shifts = await listShifts(filter)
  return toCsv(shifts, [
    { label: 'id', value: (shift) => shift.id },
    { label: 'title', value: (shift) => shift.title },
    { label: 'location', value: (shift) => shift.location },
    { label: 'start', value: (shift) => formatLocal(shift.start, shift.zone) },
    { label: 'end', value: (shift) => formatLocal(shift.end, shift.zone) },
    { label: 'zone', value: (shift) => shift.zone },
    { label: 'workers', value: (shift) => shift.assignees.map((id) => names.get(id) ?? id).join('; ') },
  ])
}

/** One line per worker with the hours worked between from and to, by local date. */
export async function payrollCsv({ from, to } = {}) {
  if (from) parseLocalDate(from, 'from')
  if (to) parseLocalDate(to, 'to')
  const rows = []
  for (const user of await listUsers({ role: 'worker' })) {
    const entries = (await listShifts({ assignee: user.id }))
      .flatMap(splitByLocalDay)
      .filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to))
    rows.push({ user, minutes: sumMinutes(entries) })
  }
  return toCsv(rows, [
    { label: 'user', value: (row) => row.user.id },
    { label: 'name', value: (row) => row.user.name },
    { label: 'hours', value: (row) => (row.minutes / 60).toFixed(2) },
  ])
}
