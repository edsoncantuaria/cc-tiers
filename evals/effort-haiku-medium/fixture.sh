#!/usr/bin/env bash
# Tiny node repo for the effort sweep. Three mechanical edits; haiku ladder medium, high.
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

cat > README.md <<'MD'
# text-utils

Small helpers. We hope you recieve them well.
MD

cat > LICENSE <<'TXT'
MIT License

Copyright (c) 2024 text-utils authors
TXT

# The effort ladder under test; cc-tiers reads this project file from the run workspace.
mkdir -p .claude
printf '%s\n' '{"effort": {"haiku": ["medium", "high"]}}' > .claude/cc-tiers.json
echo '.claude/' >> .git/info/exclude

git add .
git commit -qm init
