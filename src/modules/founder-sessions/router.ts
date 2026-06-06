import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import { founderSessions, sessionAnswers } from '../../lib/db/schema/index.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { BusinessRuleError, NotFoundError } from '../../middleware/errors.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const founderSessionsRouter = new Hono<HonoEnv>()

// ── Shared Zod schemas ────────────────────────────────────────────────────────

const startupIdParam = z.object({
  id: z.string().uuid('Invalid startup ID'),
})

const sessionIdParam = z.object({
  id: z.string().uuid('Invalid startup ID'),
  sessionId: z.string().uuid('Invalid session ID'),
})

const createSessionBody = z.object({
  idea: z.string().min(10, 'Idea must be at least 10 characters').max(2000),
})

const addAnswerBody = z.object({
  questionId: z.string().min(1, 'Question ID is required'),
  questionType: z.enum([
    'problem',
    'customer',
    'market',
    'competition',
    'revenue',
    'team',
    'vision',
    'assumption',
  ]),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(2000),
  sequenceOrder: z.number().int().positive(),
})

// ── Ownership helpers ─────────────────────────────────────────────────────────

async function requireSessionOwner(
  sessionId: string,
  startupId: string,
  userId: string,
) {
  const session = await db.query.founderSessions.findFirst({
    where: and(
      eq(founderSessions.id, sessionId),
      eq(founderSessions.startupId, startupId),
      eq(founderSessions.userId, userId),
    ),
  })
  if (!session) throw new NotFoundError()
  return session
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/v1/startups/:id/sessions
founderSessionsRouter.post(
  '/:id/sessions',
  requireAuth,
  zValidator('param', startupIdParam),
  zValidator('json', createSessionBody),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId = c.var.user.id
    const body = c.req.valid('json')

    await requireStartupOwner(startupId, userId)

    const [session] = await db
      .insert(founderSessions)
      .values({ startupId, userId, idea: body.idea, status: 'active' })
      .returning()

    return c.json({ data: session }, 201)
  },
)

// GET /api/v1/startups/:id/sessions/:sessionId
founderSessionsRouter.get(
  '/:id/sessions/:sessionId',
  requireAuth,
  zValidator('param', sessionIdParam),
  async (c) => {
    const { id: startupId, sessionId } = c.req.valid('param')
    const userId = c.var.user.id

    await requireStartupOwner(startupId, userId)
    const session = await requireSessionOwner(sessionId, startupId, userId)

    const answers = await db
      .select()
      .from(sessionAnswers)
      .where(eq(sessionAnswers.sessionId, sessionId))
      .orderBy(asc(sessionAnswers.sequenceOrder))

    return c.json({ data: { ...session, answers } })
  },
)

// POST /api/v1/startups/:id/sessions/:sessionId/answers
founderSessionsRouter.post(
  '/:id/sessions/:sessionId/answers',
  requireAuth,
  zValidator('param', sessionIdParam),
  zValidator('json', addAnswerBody),
  async (c) => {
    const { id: startupId, sessionId } = c.req.valid('param')
    const userId = c.var.user.id
    const body = c.req.valid('json')

    await requireStartupOwner(startupId, userId)
    const session = await requireSessionOwner(sessionId, startupId, userId)

    if (session.status !== 'active') {
      throw new BusinessRuleError('Session is no longer active')
    }

    const [answer] = await db
      .insert(sessionAnswers)
      .values({
        sessionId,
        questionId: body.questionId,
        questionType: body.questionType,
        question: body.question,
        answer: body.answer,
        sequenceOrder: body.sequenceOrder,
      })
      .returning()

    return c.json({ data: answer }, 201)
  },
)

// POST /api/v1/startups/:id/sessions/:sessionId/messages
// TODO(sprint-2): AI chat stream endpoint.
// Returns SSE stream of Claude chat completions for the founder session conversation.
// Do NOT proxy through Next.js API routes — call the Railway URL directly.
