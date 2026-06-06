import { zValidator as honoZValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodSchema } from 'zod'

// Wraps @hono/zod-validator with the project's standard VALIDATION_ERROR envelope.
// All request validation flows through this helper — never use raw honoZValidator.
export function zValidator<T extends ZodSchema>(
  target: keyof ValidationTargets,
  schema: T,
) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: result.error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
        400,
      )
    }
  })
}
