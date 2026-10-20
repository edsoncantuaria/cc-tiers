import http from 'node:http'
import { findUserById, publicUser } from './users.js'

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function createServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' })
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
