import { existsSync, readFileSync } from 'node:fs'
import dotenv from 'dotenv'

// dotenv 8 reads one line per value, so a quoted value spanning lines (the PEM
// key) comes back cut at its first line. Fold those line breaks into \n, which
// dotenv expands inside double quotes. Real environment variables still win.
if (existsSync('.env')) {
  const text = readFileSync('.env', 'utf8').replace(/"[^"]*"/g, (quoted) => quoted.replace(/\r?\n/g, '\\n'))
  for (const [key, value] of Object.entries(dotenv.parse(text))) process.env[key] ??= value
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  issuer: process.env.TOKEN_ISSUER || 'shiftlite',
  privateKey: process.env.PRIVATE_KEY,
}
