const counters = new Map()

/** Sequential ids per prefix: usr_1, usr_2, shf_1, ... */
export function nextId(prefix) {
  const value = (counters.get(prefix) || 0) + 1
  counters.set(prefix, value)
  return `${prefix}_${value}`
}

export function resetIds() {
  counters.clear()
}
