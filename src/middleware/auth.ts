import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types/hono.ts'
import { verifyAccessToken } from '../modules/auth/jwt.ts'

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
} as const

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(UNAUTHENTICATED, 401)
  }

  const token = authHeader.slice(7)

  try {
    const { userId, email } = await verifyAccessToken(token)
    c.set('user', { id: userId, email })
    await next()
  } catch {
    return c.json(UNAUTHENTICATED, 401)
  }
}
