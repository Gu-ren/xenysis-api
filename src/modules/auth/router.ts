import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../lib/db/index.ts'
import { profiles } from '../../lib/db/schema/index.ts'
import { requireAuth } from '../../middleware/auth.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const authRouter = new Hono<HonoEnv>()

// GET /api/v1/auth/me
authRouter.get('/me', requireAuth, async (c) => {
  const user = c.var.user

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  })

  return c.json({
    data: {
      id: user.id,
      email: user.email ?? null,
      profile: profile ?? null,
    },
  })
})
