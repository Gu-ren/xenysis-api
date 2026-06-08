import { count } from 'drizzle-orm'
import { and, eq, gte, sql } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { db } from '../lib/db/index.ts'
import { generationJobs } from '../lib/db/schema/index.ts'
import type { HonoEnv } from '../types/hono.ts'

// Per-user hourly cap on chat messages — protects OpenAI spend.
// Counts founder_chat generation jobs created in the last hour.
// Configurable via MAX_CHAT_MESSAGES_PER_HOUR env var (default 60).
export const chatRateLimit: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const userId = c.var.user.id
  const limit = Number(process.env.MAX_CHAT_MESSAGES_PER_HOUR ?? 60)

  const [{ hourlyCount }] = await db
    .select({ hourlyCount: count() })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        eq(generationJobs.type, 'founder_chat'),
        gte(generationJobs.createdAt, sql`NOW() - INTERVAL '1 hour'`),
      ),
    )

  if (hourlyCount >= limit) {
    return c.json(
      {
        error: {
          code:    'RATE_LIMITED',
          message: 'Too many messages. Please wait before continuing.',
        },
      },
      429,
    )
  }

  await next()
}

// TODO(sprint-3): generationRateLimit — enforces 20 generation jobs per user
// per 24 hours for opportunity/blueprint/workspace generation endpoints.
// Implementation sketch in the original stub above.
