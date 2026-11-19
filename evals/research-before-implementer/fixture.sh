#!/usr/bin/env bash
# Tiny node repo for the eval: one module, one test, one commit.
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

git add .
git commit -qm init
