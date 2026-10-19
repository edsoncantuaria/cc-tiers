let source = () => Date.now()

export function now() {
  return source()
}

/** Tests freeze or move time with setClock(() => ms). */
export function setClock(fn) {
  if (typeof fn !== 'function') throw new TypeError('clock must be a function')
  source = fn
}

export function resetClock() {
  source = () => Date.now()
}
