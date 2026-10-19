import { ValidationError } from './errors.js'

export function requireString(value, field, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new ValidationError(`${field} is required`)
  if (trimmed.length > max) throw new ValidationError(`${field} is longer than ${max} characters`)
  return trimmed
}

export function optionalString(value, field, options) {
  if (value === undefined || value === null || value === '') return ''
  return requireString(value, field, options)
}

export function requireInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isInteger(value)) throw new ValidationError(`${field} must be an integer`)
  if (value < min || value > max) throw new ValidationError(`${field} must be between ${min} and ${max}`)
  return value
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/

export function requireEmail(value) {
  const email = requireString(value, 'email', { max: 254 }).toLowerCase()
  if (!EMAIL.test(email)) throw new ValidationError('email is not valid')
  return email
}

export function requireOneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
  return value
}

/** Ids look like shf_12: a known prefix and a positive integer. */
export function requireId(value, prefix) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[1-9][0-9]*$`).test(value)) {
    throw new ValidationError(`not a ${prefix} id: ${value}`)
  }
  return value
}
