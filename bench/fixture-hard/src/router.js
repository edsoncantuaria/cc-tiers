import { verifyToken } from './auth.js'
import { AppError, AuthError, ValidationError } from './errors.js'

function authenticate(headers) {
  const header = headers.authorization || headers.Authorization || ''
  const match = /^Bearer (\S+)$/.exec(header)
  if (!match) throw new AuthError('missing bearer token')
  return verifyToken(match[1])
}

function match(route, segments) {
  if (route.parts.length !== segments.length) return null
  const params = {}
  for (let index = 0; index < segments.length; index += 1) {
    const part = route.parts[index]
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(segments[index])
      } catch {
        throw new ValidationError('bad escape in path')
      }
    } else if (part !== segments[index]) {
      return null
    }
  }
  return params
}

/**
 * A router for plain request objects: { method, path, headers, body } in,
 * { status, body } out. Handlers return { status?, body }. Routes need a bearer
 * token unless added with { auth: false }.
 */
export function createRouter() {
  const routes = []

  function add(method, pattern, handler, { auth = true } = {}) {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler, auth })
  }

  async function handle({ method = 'GET', path = '/', headers = {}, body } = {}) {
    try {
      const [pathname, search = ''] = String(path).split('?')
      const segments = pathname.split('/').filter(Boolean)
      let otherMethod = false
      for (const route of routes) {
        const params = match(route, segments)
        if (!params) continue
        if (route.method !== method) {
          otherMethod = true
          continue
        }
        const auth = route.auth ? authenticate(headers) : null
        const query = Object.fromEntries(new URLSearchParams(search))
        const result = (await route.handler({ params, query, body, auth })) || {}
        return { status: result.status ?? 200, body: result.body ?? null }
      }
      return otherMethod ? { status: 405, body: { error: 'method_not_allowed' } } : { status: 404, body: { error: 'not_found' } }
    } catch (error) {
      if (error instanceof AppError) return { status: error.status, body: { error: error.code, message: error.message } }
      return { status: 500, body: { error: 'internal' } }
    }
  }

  return { add, handle }
}
