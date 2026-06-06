// TODO(sprint-3): Generation rate limiter
//
// Enforces 20 generation jobs per user per 24 hours via a DB count query.
// No Redis required at MVP.
//
// Usage (on generation endpoints only):
//   import { generationRateLimit } from '../middleware/rate-limit.ts'
//   router.post('/generate', requireAuth, generationRateLimit, handler)
//
// Implementation sketch:
//   const jobsToday = await db
//     .select({ count: count() })
//     .from(generationJobs)
//     .where(and(
//       eq(generationJobs.userId, ctx.var.user.id),
//       gte(generationJobs.createdAt, sql`NOW() - INTERVAL '24 hours'`),
//       notInArray(generationJobs.type, ['full']),
//     ))
//   if (jobsToday[0].count >= 20) {
//     return c.json({ error: { code: 'RATE_LIMITED', message: 'Daily generation limit reached' } }, 429)
//   }
