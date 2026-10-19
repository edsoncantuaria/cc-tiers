/** Errors that carry an HTTP status, so the router can answer without a lookup table. */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = this.constructor.name
    this.status = status
    this.code = code
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(400, 'invalid', message)
  }
}

export class AuthError extends AppError {
  constructor(message = 'not authenticated') {
    super(401, 'unauthenticated', message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'not allowed') {
    super(403, 'forbidden', message)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'not found') {
    super(404, 'not_found', message)
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(409, 'conflict', message)
  }
}
