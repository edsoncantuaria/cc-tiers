import { scryptSync, timingSafeEqual } from 'node:crypto'

const users = [
  {
    id: 'u_8f2c41',
    name: 'Ana Ribeiro',
    email: 'ana@shiftlite.dev',
    passwordHash: 'scrypt:773f6aeb9006804722ce20b84ff41ab7:9e580cf20175b0deecd9447d6d604b57e3b70a9bc664fed788ebdfd41bf0d4b7',
  },
  {
    id: 'u_3b9d07',
    name: 'Bruno Lima',
    email: 'bruno@shiftlite.dev',
    passwordHash: 'scrypt:95db0d4c45416a4e23a03fb4c6b0531a:da04c7bb943e3c0d30f3054bd162873f7374fd1df7f088ca2a44c00cba1e494f',
  },
  {
    id: 'u_c61e5a',
    name: 'Carla Mendes',
    email: 'carla@shiftlite.dev',
    passwordHash: 'scrypt:2c63869d702f400a52d83c004e4f4a1c:b75ae47e97e33db4112ff0d3db889cbb5d34486576b44d309608f44ba18dbb5d',
  },
]

export function findUserById(id) {
  return users.find((user) => user.id === id)
}

export function findUserByEmail(email) {
  const wanted = String(email).trim().toLowerCase()
  return users.find((user) => user.email === wanted)
}

export function checkPassword(user, password) {
  const [, salt, hash] = user.passwordHash.split(':')
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(String(password), salt, expected.length)
  return timingSafeEqual(actual, expected)
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email }
}
