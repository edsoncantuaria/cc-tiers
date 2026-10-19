const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fabio', 'Gabi', 'Hugo', 'Iris', 'Joao', 'Kai', 'Lia', 'Mauro', 'Nina', 'Otto', 'Paula', 'Quim', 'Rita', 'Saulo', 'Tina', 'Ugo', 'Vera', 'Wagner']

export const USERS = NAMES.map((name, index) => ({
  id: index + 1,
  name,
  email: `${name.toLowerCase()}@example.com`,
}))

export function fetchUser(id) {
  return USERS.find((user) => user.id === id) ?? null
}

export function listUsers() {
  return USERS.slice()
}

export function validateEmail(email) {
  return typeof email === 'string' && /^[^@\s]+@[^@\s]+$/.test(email)
}
