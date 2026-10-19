export function evaluate(expression) {
  const tokens = String(expression).match(/\s*(\d+\.?\d*|\.\d+|[-+*/()]|\S)/gy)?.map((t) => t.trim()) ?? []
  let pos = 0

  const fail = () => { throw new SyntaxError(`Unexpected ${tokens[pos] ?? 'end of input'}`) }

  function expr() {
    let value = term()
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++]
      const right = term()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  function term() {
    let value = unary()
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++]
      const right = unary()
      if (op === '*') value *= right
      else if (right === 0) throw new RangeError('Division by zero')
      else value /= right
    }
    return value
  }

  function unary() {
    if (tokens[pos] === '-') { pos++; return -unary() }
    return primary()
  }

  function primary() {
    const token = tokens[pos]
    if (token === '(') {
      pos++
      const value = expr()
      if (tokens[pos] !== ')') fail()
      pos++
      return value
    }
    if (token === undefined || !/^(\d+\.?\d*|\.\d+)$/.test(token)) fail()
    pos++
    return Number(token)
  }

  const result = expr()
  if (pos < tokens.length) fail()
  return result
}
