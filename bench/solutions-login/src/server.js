import http from 'node:http'
import { config } from './config.js'
import { signToken } from './crypto/sign.js'
import { checkPassword, findUserByEmail, findUserById, publicUser } from './users.js'

const TOKEN_TTL_SECONDS = 60 * 60

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  return JSON.parse(text)
}

async function login(req, res) {
  let body
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' })
  }
  const user = body && findUserByEmail(body.email ?? '')
  if (!user || !checkPassword(user, body.password ?? '')) {
    return sendJson(res, 401, { error: 'invalid email or password' })
  }
  const token = signToken({ sub: user.id, iss: config.issuer }, config.privateKey, { expiresInSeconds: TOKEN_TTL_SECONDS })
  sendJson(res, 200, { token })
}

export function createServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' })
    }

    if (req.method === 'POST' && pathname === '/login') {
      return login(req, res).catch(() => sendJson(res, 500, { error: 'internal error' }))
    }

    const userRoute = pathname.match(/^\/users\/([^/]+)$/)
    if (req.method === 'GET' && userRoute) {
      const user = findUserById(decodeURIComponent(userRoute[1]))
      if (!user) return sendJson(res, 404, { error: 'user not found' })
      return sendJson(res, 200, publicUser(user))
    }

    sendJson(res, 404, { error: 'not found' })
  })
}
