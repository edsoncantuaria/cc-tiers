#!/usr/bin/env bash
# Tiny node repo for the reviewer check (issue #27): a base commit, then the commit under review.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "profile-sync",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > profile.js <<'JS'
export function toPayload(user) {
  return { id: user.id, name: user.name.trim(), email: user.email.toLowerCase() }
}
JS

cat > profile.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toPayload } from './profile.js'

test('toPayload trims the name and lower-cases the email', () => {
  const user = { id: 7, name: ' Ana ', email: 'ANA@example.com' }
  assert.deepEqual(toPayload(user), { id: 7, name: 'Ana', email: 'ana@example.com' })
})
JS

git add .
git commit -qm init

cat >> profile.js <<'JS'

export async function syncProfile(user, api) {
  if (!user.email) return { ok: false, error: 'email required' }
  try {
    api.update(user.id, toPayload(user))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
JS

cat > profile.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncProfile, toPayload } from './profile.js'

test('toPayload trims the name and lower-cases the email', () => {
  const user = { id: 7, name: ' Ana ', email: 'ANA@example.com' }
  assert.deepEqual(toPayload(user), { id: 7, name: 'Ana', email: 'ana@example.com' })
})

test('syncProfile sends the payload to the api', async () => {
  const calls = []
  const api = { update: async (id, payload) => { calls.push([id, payload]) } }
  const result = await syncProfile({ id: 7, name: ' Ana ', email: 'ANA@example.com' }, api)
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [[7, { id: 7, name: 'Ana', email: 'ana@example.com' }]])
})

test('syncProfile rejects a user without an email', async () => {
  const calls = []
  const api = { update: async (id, payload) => { calls.push([id, payload]) } }
  const result = await syncProfile({ id: 7, name: 'Ana', email: '' }, api)
  assert.deepEqual(result, { ok: false, error: 'email required' })
  assert.deepEqual(calls, [])
})
JS

git add .
git commit -qm "add syncProfile"
