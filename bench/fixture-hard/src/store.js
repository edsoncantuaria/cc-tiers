import { getConfig } from './config.js'
import { ConflictError } from './errors.js'

function pause(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * An async key-value store that behaves like a remote one: every call waits
 * latency() ms, and values are copied in and out, never shared.
 */
export function createMemoryStore({ latency = () => 0 } = {}) {
  const rows = new Map()
  return {
    async get(key) {
      await pause(latency())
      const row = rows.get(key)
      return row ? structuredClone(row.value) : null
    },
    async getVersioned(key) {
      await pause(latency())
      const row = rows.get(key)
      return row ? { value: structuredClone(row.value), version: row.version } : null
    },
    /** With expectedVersion, the write fails with a ConflictError if the key changed since that version. */
    async put(key, value, { expectedVersion } = {}) {
      await pause(latency())
      const current = rows.get(key)
      if (expectedVersion !== undefined && (current?.version ?? 0) !== expectedVersion) {
        throw new ConflictError(`stale write to ${key}`)
      }
      const version = (current?.version ?? 0) + 1
      rows.set(key, { value: structuredClone(value), version })
      return version
    },
    async delete(key) {
      await pause(latency())
      return rows.delete(key)
    },
    async list(prefix) {
      await pause(latency())
      const out = []
      for (const [key, row] of rows) if (key.startsWith(prefix)) out.push(structuredClone(row.value))
      return out
    },
    clear() {
      rows.clear()
    },
  }
}

/** The process-wide store every module uses. */
export const db = createMemoryStore({ latency: () => getConfig().storeLatencyMs })

export function resetStore() {
  db.clear()
}
