#!/usr/bin/env bash
# Tiny node repo for the reviewer check (issue #27): a base commit, then the commit under review.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "row-import",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > rows.js <<'JS'
export function parseRow(line) {
  const [id, name] = line.split(',')
  return { id: Number(id), name: name.trim() }
}
JS

cat > rows.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRow } from './rows.js'

test('parseRow reads the id and the name', () => {
  assert.deepEqual(parseRow('4, Ana'), { id: 4, name: 'Ana' })
})
JS

git add .
git commit -qm init

cat > importer.js <<'JS'
import { parseRow } from './rows.js'

export async function importRows(lines, insert) {
  const imported = []
  for (const line of lines) {
    try {
      imported.push(await insert(parseRow(line)))
    } catch (error) {
      continue
    }
  }
  return imported
}
JS

cat > importer.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importRows } from './importer.js'

test('importRows inserts every row', async () => {
  const insert = async (row) => ({ ...row, saved: true })
  const imported = await importRows(['1,Ana', '2,Bia'], insert)
  assert.deepEqual(imported, [
    { id: 1, name: 'Ana', saved: true },
    { id: 2, name: 'Bia', saved: true },
  ])
})

test('importRows returns nothing for an empty list', async () => {
  assert.deepEqual(await importRows([], async (row) => row), [])
})
JS

git add .
git commit -qm "add importRows"
