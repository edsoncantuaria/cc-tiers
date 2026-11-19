#!/usr/bin/env bash
# Tiny node repo for the effort sweep. Finish a draft that has two counting defects; run at one CLAUDE_CODE_EFFORT_LEVEL.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "text-utils",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > text.js <<'JS'
export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
JS

cat > text.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capitalize } from './text.js'

test('capitalize upper-cases the first letter', () => {
  assert.equal(capitalize('node'), 'Node')
})
JS

# The user's draft: it counts words with split(' ') and lines with split('\n').length.
cat > cli.js <<'JS'
#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { words: { type: 'boolean' }, lines: { type: 'boolean' } },
})
const [file] = positionals
if (!file || Boolean(values.words) === Boolean(values.lines)) {
  console.error('usage: cli.js <file> --words|--lines')
  process.exit(1)
}
const text = readFileSync(file, 'utf8')
console.log(values.words ? text.split(' ').length : text.split('\n').length)
JS

git add .
git commit -qm init
