const listeners = new Map()

export function on(type, listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function')
  if (!listeners.has(type)) listeners.set(type, [])
  listeners.get(type).push(listener)
  return () => off(type, listener)
}

export function off(type, listener) {
  const list = listeners.get(type)
  if (!list) return
  const index = list.indexOf(listener)
  if (index >= 0) list.splice(index, 1)
}

/**
 * Calls every listener in order and waits for each. A listener that throws does
 * not stop the others; the errors come back so the caller can log them.
 */
export async function emit(type, payload) {
  const errors = []
  for (const listener of [...(listeners.get(type) || [])]) {
    try {
      await listener(payload)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

export function listenerCount(type) {
  return (listeners.get(type) || []).length
}

export function resetEvents() {
  listeners.clear()
}
