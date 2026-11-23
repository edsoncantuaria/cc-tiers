#!/usr/bin/env bash
# Tiny node repo for the reviewer check (issue #27): a base commit, then the commit under review.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "list-utils",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > pagination.js <<'JS'
export function paginate(items, page, perPage) {
  const start = (page - 1) * perPage
  return items.slice(start, start + perPage)
}
JS

cat > pagination.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paginate } from './pagination.js'

test('paginate returns the items of one page', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6], 2, 3), [4, 5, 6])
})
JS

git add .
git commit -qm init

cat >> pagination.js <<'JS'

export function pageCount(total, perPage) {
  return Math.ceil(total / perPage)
}

export function hasNextPage(page, total, perPage) {
  return page < pageCount(total, perPage)
}
JS

cat > pagination.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasNextPage, pageCount, paginate } from './pagination.js'

test('paginate returns the items of one page', () => {
  assert.deepEqual(paginate([1, 2, 3, 4, 5, 6], 2, 3), [4, 5, 6])
})

test('pageCount divides the total by the page size', () => {
  assert.equal(pageCount(25, 10), 3)
  assert.equal(pageCount(0, 10), 0)
})

test('hasNextPage is true before the last page', () => {
  assert.equal(hasNextPage(2, 25, 10), true)
  assert.equal(hasNextPage(3, 25, 10), false)
})
JS

git add .
git commit -qm "add pageCount and hasNextPage"
