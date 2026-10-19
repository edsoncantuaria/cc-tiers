import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimShift, createShift, createUser, reset, shiftsCsv, toCsv } from '../src/index.js'

/** A strict RFC 4180 reader with LF records, so the check does not trust the writer. */
function parse(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
        assert.ok([',', '\n', undefined].includes(text[index + 1]), `text after a closing quote at ${index}`)
      } else field += char
    } else if (char === '"') {
      assert.equal(field, '', `quote inside an unquoted field at ${index}`)
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      assert.notEqual(char, '\r', `bare CR at ${index}`)
      field += char
    }
  }
  assert.equal(quoted, false, 'unterminated quote')
  assert.equal(field, '', 'missing final line separator')
  return rows
}

const columns = [
  { label: 'name', value: (row) => row.name },
  { label: 'note, free text', value: (row) => row.note },
  { label: 'n', value: (row) => row.n },
]

test('fields that need quoting are quoted, the rest stay bare', () => {
  const rows = [
    { name: 'Dock, north', note: 'say "hi"', n: 3 },
    { name: 'line\nbreak', note: 'cr\rhere', n: 0 },
    { name: 'plain', note: null, n: undefined },
    { name: ' spaced ', note: '""', n: -1.5 },
  ]
  const text = toCsv(rows, columns)
  assert.equal(text.split('\n')[0], 'name,"note, free text",n')
  assert.ok(text.includes('\n"Dock, north","say ""hi""",3\n'))
  assert.ok(text.includes('\nplain,,\n'))
  assert.ok(text.includes('\n spaced ,"""""",-1.5\n'))
  assert.deepEqual(parse(text), [
    ['name', 'note, free text', 'n'],
    ['Dock, north', 'say "hi"', '3'],
    ['line\nbreak', 'cr\rhere', '0'],
    ['plain', '', ''],
    [' spaced ', '""', '-1.5'],
  ])
})

test('the shifts report survives awkward titles and names', async () => {
  reset()
  const worker = await createUser({ name: 'Ana "Nina" Lima', email: 'ana@shiftboard.test' })
  const shift = await createShift({ title: 'Dock, north', location: 'Pier "4"\nGate B', start: '2026-03-02T09:00:00Z', end: '2026-03-02T17:00:00Z' })
  await claimShift(shift.id, worker.id)
  const [header, row] = parse(await shiftsCsv())
  assert.deepEqual(header, ['id', 'title', 'location', 'start', 'end', 'zone', 'workers'])
  assert.deepEqual(row, ['shf_1', 'Dock, north', 'Pier "4"\nGate B', '2026-03-02 09:00', '2026-03-02 17:00', 'UTC', 'Ana "Nina" Lima'])
})
