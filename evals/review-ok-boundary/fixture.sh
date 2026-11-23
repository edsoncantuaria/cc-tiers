#!/usr/bin/env bash
# Tiny node repo for the reviewer check (issue #27): a base commit, then the commit under review.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "usage-quota",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > quota.js <<'JS'
export function remaining(quota, used) {
  return Math.max(quota - used, 0)
}
JS

cat > quota.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remaining } from './quota.js'

test('remaining subtracts the usage from the quota', () => {
  assert.equal(remaining(10, 3), 7)
})

test('remaining never goes below zero', () => {
  assert.equal(remaining(10, 12), 0)
})
JS

git add .
git commit -qm init

cat >> quota.js <<'JS'

export function canConsume(quota, used, amount = 1) {
  return used + amount <= quota
}
JS

cat > quota.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canConsume, remaining } from './quota.js'

test('remaining subtracts the usage from the quota', () => {
  assert.equal(remaining(10, 3), 7)
})

test('remaining never goes below zero', () => {
  assert.equal(remaining(10, 12), 0)
})

test('canConsume accepts a request that fits', () => {
  assert.equal(canConsume(10, 9), true)
  assert.equal(canConsume(10, 5, 5), true)
})

test('canConsume refuses a request that does not fit', () => {
  assert.equal(canConsume(10, 10), false)
  assert.equal(canConsume(10, 9, 5), false)
})
JS

git add .
git commit -qm "add canConsume"
