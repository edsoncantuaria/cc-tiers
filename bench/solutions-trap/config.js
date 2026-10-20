import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

const ENTRY = /^(\s*[\w.-]+\s*=\s*)(.*)$/

// dotenv 8.6.0 parses one line at a time and keeps ' #' in unquoted values,
// so each entry is reduced to one plain line before it reaches dotenv.parse.
function read(file) {
  if (!existsSync(file)) return {}
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(ENTRY)
    if (!match) continue
    let [, head, value] = match
    const quote = value[0]
    if (quote === '"') {
      while (value.indexOf('"', 1) < 0 && i + 1 < lines.length) value += `\\n${lines[(i += 1)]}`
    }
    if (quote === '"' || quote === "'") value = value.slice(0, value.indexOf(quote, 1) + 1)
    else value = value.split(' #')[0]
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
