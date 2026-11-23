#!/usr/bin/env bash
# Tiny node repo for the reviewer check (issue #27): a base commit, then the commit under review.
set -euo pipefail

git init -q
git config user.email t@example.invalid
git config user.name t

cat > package.json <<'JSON'
{
  "name": "project-list",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
JSON

cat > projects.js <<'JS'
export function listProjects(projects) {
  return projects.filter((project) => !project.archived)
}
JS

cat > summary.js <<'JS'
import { listProjects } from './projects.js'

export function projectNames(projects) {
  return listProjects(projects).map((project) => project.name)
}
JS

cat > projects.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listProjects } from './projects.js'

test('listProjects keeps the order of the input', () => {
  const projects = [{ name: 'b' }, { name: 'a' }]
  assert.deepEqual(listProjects(projects), projects)
})
JS

cat > summary.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectNames } from './summary.js'

test('projectNames lists the names', () => {
  assert.deepEqual(projectNames([{ name: 'x' }, { name: 'y' }]), ['x', 'y'])
})
JS

git add .
git commit -qm init

cat > projects.js <<'JS'
export function listProjects(projects, { includeArchived = true } = {}) {
  return projects.filter((project) => includeArchived || !project.archived)
}
JS

cat > projects.test.js <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listProjects } from './projects.js'

test('listProjects keeps the order of the input', () => {
  const projects = [{ name: 'b' }, { name: 'a' }]
  assert.deepEqual(listProjects(projects), projects)
})

test('listProjects can leave out archived projects', () => {
  const projects = [{ name: 'a' }, { name: 'b', archived: true }]
  assert.deepEqual(listProjects(projects, { includeArchived: false }), [{ name: 'a' }])
})

test('listProjects can keep archived projects', () => {
  const projects = [{ name: 'a' }, { name: 'b', archived: true }]
  assert.deepEqual(listProjects(projects, { includeArchived: true }), projects)
})
JS

git add .
git commit -qm "add includeArchived option to listProjects"
