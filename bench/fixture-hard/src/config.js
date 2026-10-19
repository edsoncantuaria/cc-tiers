import { ValidationError } from './errors.js'

export const DEFAULTS = Object.freeze({
  secret: 'dev-secret-change-me',
  tokenTtlMs: 15 * 60 * 1000,
  filesRoot: '',
  maxAttachmentBytes: 1024 * 1024,
  defaultZone: 'UTC',
  storeLatencyMs: 0,
  cacheTtlMs: 1000,
  maxShiftHours: 16,
  weeklyHoursLimit: 40,
  notifyConcurrency: 2,
})

const config = { ...DEFAULTS }

/** The live configuration. Modules read it on every call, so configure() takes effect at once. */
export function getConfig() {
  return config
}

export function configure(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) throw new ValidationError(`unknown config key: ${key}`)
    if (typeof value !== typeof DEFAULTS[key]) throw new ValidationError(`config ${key} must be a ${typeof DEFAULTS[key]}`)
    config[key] = value
  }
  return config
}

export function resetConfig() {
  Object.assign(config, DEFAULTS)
}
