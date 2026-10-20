import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

const ENTRY = /^(\s*[\w.-]+\s*=)(.*)$/

// dotenv 8.6.0 parses one line at a time and keeps ' #' in unquoted values,
// so each entry is reduced to one plain line before it reaches dotenv.parse.
function read(file) {
  if (!existsSync(file)) return {}
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(ENTRY)
    if (!match) continue
    const [, head, raw] = match
    let value = raw.trim()
    if (value[0] === '"' && value.indexOf('"', 1) < 0) {
      // The value goes on until a line with the closing quote; reaching another entry first means it was never closed.
      let end = i + 1
      while (end < lines.length && !ENTRY.test(lines[end]) && !lines[end].includes('"')) end += 1
      if (end < lines.length && !ENTRY.test(lines[end])) {
        // Joined with an escaped \n, which dotenv 8.6.0 expands inside double quotes.
        value = [value, ...lines.slice(i + 1, end + 1)].join('\\n')
        i = end
      }
    }
    const close = value.indexOf(value[0], 1)
    if (value[0] === '"' || value[0] === "'") value = close > 0 ? value.slice(0, close + 1) : value
    else value = raw.split(' #')[0]
    out.push(head + value)
  }
  return dotenv.parse(out.join('\n'))
}

export function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const files = { ...read(path.join(cwd, '.env')), ...read(path.join(cwd, '.env.local')) }
  const result = {}
  for (const [key, value] of Object.entries(files)) result[key] = env[key] ?? value
  return result
}
