import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409)
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super('BUSINESS_RULE', message, 422)
  }
}

export function errorResponse(
  err: unknown,
): { json: { error: { code: string; message: string } }; status: ContentfulStatusCode } {
  if (err instanceof AppError) {
    return {
      json: { error: { code: err.code, message: err.message } },
      status: err.status as ContentfulStatusCode,
    }
  }
  console.error('[xenysis-api] Unhandled error:', err)
  return {
    json: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    status: 500,
  }
}
