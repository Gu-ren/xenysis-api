import { Hono } from 'hono'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import {
  founderMemories,
  founderSessions,
  generationJobs,
  sessionAnswers,
  sessionSummaries,
} from '../../lib/db/schema/index.ts'
import { founderUnderstanding } from '../../lib/db/schema/understanding.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { BusinessRuleError, NotFoundError } from '../../middleware/errors.ts'
import { openai } from '../../lib/ai/client.ts'
import {
  CHAT_PROMPT_VERSION,
  SESSION_SUMMARY_SCHEMA,
  FOUNDER_MEMORY_EXTRACTION_SCHEMA,
  buildChatSystemPrompt,
  buildMemoryExtractionSystemPrompt,
} from './chat-prompt.ts'
import { FounderMemorySchema, EMPTY_FOUNDER_MEMORY, mergeFounderMemory, type FounderMemory } from '../../lib/contracts/founder-memory.ts'
import { SessionSummarySchema } from '../../lib/contracts/session-summary.ts'
import {
  FounderUnderstandingSchema,
  EMPTY_UNDERSTANDING,
} from '../../lib/contracts/founder-understanding.ts'
import { logActivity, trackUsage, estimateTokens, fromOpenAI } from '../../agents/base/utils.ts'
import { updateUnderstanding, loadUnderstanding } from '../../services/understanding-engine.ts'
import { chatRateLimit } from '../../middleware/rate-limit.ts'
import type { HonoEnv } from '../../types/hono.ts'

const MAX_SESSION_ANSWERS = Number(process.env.MAX_SESSION_ANSWERS ?? 100)
const MAX_CHAT_MESSAGES_PER_SESSION = Number(process.env.MAX_CHAT_MESSAGES_PER_SESSION ?? 50)

export const founderSessionsRouter = new Hono<HonoEnv>()

// ── Shared Zod schemas ────────────────────────────────────────────────────────

const startupIdParam = z.object({
  id: z.string().uuid('Invalid startup ID'),
})

const sessionIdParam = z.object({
  id:        z.string().uuid('Invalid startup ID'),
  sessionId: z.string().uuid('Invalid session ID'),
})

const createSessionBody = z.object({
  idea: z.string().min(10, 'Idea must be at least 10 characters').max(2000),
})

const addAnswerBody = z.object({
  questionId:    z.string().min(1, 'Question ID is required'),
  questionType:  z.enum([
    'problem', 'customer', 'market', 'competition',
    'revenue', 'team', 'vision', 'assumption',
  ]),
  question:      z.string().min(1).max(500),
  answer:        z.string().min(1).max(2000),
  sequenceOrder: z.number().int().positive(),
})

const sendMessageBody = z.object({
  message: z.string().min(1).max(2000),
})

// ── Ownership helpers ─────────────────────────────────────────────────────────

async function requireSessionOwner(sessionId: string, startupId: string, userId: string) {
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
    const body   = c.req.valid('json')

    const startup = await requireStartupOwner(startupId, userId)

    const [session] = await db
      .insert(founderSessions)
      .values({ startupId, userId, idea: body.idea, status: 'active' })
      .returning()

    await logActivity(db, {
      userId,
      startupId,
      type:        'session.started',
      description: `Founder session started for "${startup.name}"`,
      meta:        { sessionId: session.id },
    })

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

// GET /api/v1/startups/:id/sessions/:sessionId/understanding
// Returns the current founder understanding state for the progress UI.
founderSessionsRouter.get(
  '/:id/sessions/:sessionId/understanding',
  requireAuth,
  zValidator('param', sessionIdParam),
  async (c) => {
    const { id: startupId, sessionId } = c.req.valid('param')
    const userId = c.var.user.id

    await requireStartupOwner(startupId, userId)
    await requireSessionOwner(sessionId, startupId, userId)

    const understanding = await loadUnderstanding(db, sessionId)

    return c.json({ data: understanding })
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
    const body   = c.req.valid('json')

    await requireStartupOwner(startupId, userId)
    const session = await requireSessionOwner(sessionId, startupId, userId)

    if (session.status !== 'active') {
      throw new BusinessRuleError('Session is no longer active')
    }

    const [{ answerCount }] = await db
      .select({ answerCount: count() })
      .from(sessionAnswers)
      .where(eq(sessionAnswers.sessionId, sessionId))

    if (answerCount >= MAX_SESSION_ANSWERS) {
      throw new BusinessRuleError(
        `Session has reached the maximum of ${MAX_SESSION_ANSWERS} answers`,
      )
    }

    const [answer] = await db
      .insert(sessionAnswers)
      .values({
        sessionId,
        questionId:    body.questionId,
        questionType:  body.questionType,
        question:      body.question,
        answer:        body.answer,
        sequenceOrder: body.sequenceOrder,
      })
      .returning()

    return c.json({ data: answer }, 201)
  },
)

// POST /api/v1/startups/:id/sessions/:sessionId/messages  ← SSE: AI chat stream
founderSessionsRouter.post(
  '/:id/sessions/:sessionId/messages',
  requireAuth,
  chatRateLimit,
  zValidator('param', sessionIdParam),
  zValidator('json', sendMessageBody),
  async (c) => {
    const { id: startupId, sessionId } = c.req.valid('param')
    const userId = c.var.user.id
    const { message } = c.req.valid('json')

    const startup = await requireStartupOwner(startupId, userId)
    const session = await requireSessionOwner(sessionId, startupId, userId)

    if (session.status !== 'active') {
      throw new BusinessRuleError('Session is no longer active')
    }

    if (session.messagesCount >= MAX_CHAT_MESSAGES_PER_SESSION) {
      throw new BusinessRuleError(
        `Session has reached the maximum of ${MAX_CHAT_MESSAGES_PER_SESSION} messages`,
      )
    }

    // ── Load context ──────────────────────────────────────────────────────────

    const [latestSummaryRow, recentAnswers, existingMemoryRow, understandingRow] = await Promise.all([
      db.query.sessionSummaries.findFirst({
        where:   eq(sessionSummaries.sessionId, sessionId),
        orderBy: [desc(sessionSummaries.createdAt)],
      }),
      db
        .select()
        .from(sessionAnswers)
        .where(eq(sessionAnswers.sessionId, sessionId))
        .orderBy(asc(sessionAnswers.sequenceOrder)),
      db.query.founderMemories.findFirst({
        where: eq(founderMemories.sessionId, sessionId),
      }),
      db.query.founderUnderstanding.findFirst({
        where: eq(founderUnderstanding.sessionId, sessionId),
      }),
    ])

    const latestSummary = latestSummaryRow
      ? (SessionSummarySchema.safeParse(latestSummaryRow.summary).data ?? null)
      : null

    const currentUnderstanding = understandingRow
      ? (FounderUnderstandingSchema.safeParse(understandingRow.understanding).data ?? EMPTY_UNDERSTANDING)
      : EMPTY_UNDERSTANDING

    // Parse existing memory now so it can be passed into the extraction prompt as an anchor.
    // This prevents GPT from artificially decaying confidence scores for categories that
    // are not present in the recent-message extraction window.
    const currentMemory: FounderMemory | null = existingMemoryRow
      ? (FounderMemorySchema.safeParse(existingMemoryRow.memory).data ?? null)
      : null

    // Sprint 2.5: system prompt is now gap-aware.
    const systemPrompt = buildChatSystemPrompt(startup, latestSummary, currentUnderstanding)

    // Reconstruct conversation history from session answers.
    const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
      recentAnswers.flatMap((a) => [
        { role: 'user'      as const, content: a.question },
        { role: 'assistant' as const, content: a.answer   },
      ])

    // ── Create founder_chat job ───────────────────────────────────────────────

    const [job] = await db
      .insert(generationJobs)
      .values({
        userId,
        startupId,
        type:          'founder_chat',
        status:        'active',
        model:         'gpt-4o',
        promptVersion: CHAT_PROMPT_VERSION,
        startedAt:     new Date(),
      })
      .returning()

    // ── SSE response ──────────────────────────────────────────────────────────

    return c.body(
      new ReadableStream({
        async start(controller) {
          const encoder      = new TextEncoder()
          let fullResponse   = ''
          let inputTokens    = 0
          let outputTokens   = 0
          let usageModel     = 'gpt-4o'

          const emit = (payload: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }

          try {
            const stream = await openai.chat.completions.create({
              model:          'gpt-4o',
              stream:         true,
              stream_options: { include_usage: true },
              messages: [
                { role: 'system', content: systemPrompt },
                ...historyMessages,
                { role: 'user',   content: `<user_input>${message}</user_input>` },
              ],
            })

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content ?? ''
              if (delta) {
                fullResponse += delta
                emit({ type: 'delta', data: { content: delta } })
              }
              if (chunk.usage) {
                inputTokens  = chunk.usage.prompt_tokens    ?? 0
                outputTokens = chunk.usage.completion_tokens ?? 0
                usageModel   = chunk.model ?? 'gpt-4o'
              }
            }

            // Sprint 2.5: the done event initially emits without understanding state,
            // then the side-effect block updates understanding and nothing re-emits
            // (the client polls GET /understanding for progress UI updates).
            // This keeps the stream fast and the side-effects non-blocking.
            emit({ type: 'done', data: { jobId: job.id } })

          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Stream error'
            emit({ type: 'error', data: { message: msg } })
          } finally {
            controller.close()
          }

          // ── Post-stream side effects (fire-and-forget) ────────────────────
          // All AI side-effect calls run after the stream closes so they never
          // block the founder's experience.

          void (async () => {
            try {
              // 1. Track primary chat AI usage (spec Rule 15).
              await trackUsage(db, {
                userId,
                startupId,
                generationJobId: job.id,
                usage:           { model: usageModel, inputTokens, outputTokens },
                purpose:         'chat',
              })

              // 2. Mark job done + increment messages_count.
              const newCount = (session.messagesCount ?? 0) + 1
              await Promise.all([
                db
                  .update(generationJobs)
                  .set({ status: 'done', progress: 100, completedAt: new Date() })
                  .where(eq(generationJobs.id, job.id)),
                db
                  .update(founderSessions)
                  .set({ messagesCount: newCount, updatedAt: new Date() })
                  .where(eq(founderSessions.id, sessionId)),
              ])

              // 3. Log activity.
              await logActivity(db, {
                userId,
                startupId,
                type:        'session.message_sent',
                description: 'Founder session AI message exchanged',
                meta:        { sessionId, jobId: job.id },
              })

              // 4. Adaptive summary trigger (unchanged from Sprint 2).
              const messagesSinceLastSummary = latestSummaryRow
                ? newCount - (latestSummaryRow.exchangeCount ?? 0)
                : newCount

              const promptText      = systemPrompt + historyMessages.map((m) => m.content).join(' ') + message
              const estimatedTokens = estimateTokens(promptText)

              if (messagesSinceLastSummary >= 15 || estimatedTokens > 12_000) {
                const summaryRes = await openai.chat.completions.create({
                  model:           'gpt-4o',
                  response_format: { type: 'json_schema', json_schema: SESSION_SUMMARY_SCHEMA },
                  messages: [
                    {
                      role:    'system',
                      content: 'Summarize the founder session conversation into a structured JSON object.',
                    },
                    ...historyMessages,
                    { role: 'user',      content: `<user_input>${message}</user_input>` },
                    { role: 'assistant', content: fullResponse },
                  ],
                })

                const summaryContent = summaryRes.choices[0]?.message?.content
                if (summaryContent) {
                  const parsed = SessionSummarySchema.safeParse(JSON.parse(summaryContent))
                  if (!parsed.success) {
                    console.error('[session summary] schema validation failed', parsed.error.format())
                  }
                  if (parsed.success) {
                    const summaryTokenCount = estimateTokens(summaryContent)
                    await db.insert(sessionSummaries).values({
                      sessionId,
                      startupId,
                      userId,
                      exchangeCount:      newCount,
                      sourceMessageCount: recentAnswers.length + 1,
                      summaryTokenCount,
                      summary:            parsed.data,
                    })
                  }
                }

                await trackUsage(db, {
                  userId,
                  startupId,
                  generationJobId: job.id,
                  usage:           fromOpenAI(summaryRes),
                  purpose:         'chat',
                })
              }

              // 5. Sprint 2.5: Extended memory extraction — captures both narrative
              //    memory fields (Sprint 2) AND per-category confidence/evidence (Sprint 2.5).
              const memoryRes = await openai.chat.completions.create({
                model:           'gpt-4o',
                response_format: { type: 'json_schema', json_schema: FOUNDER_MEMORY_EXTRACTION_SCHEMA },
                messages: [
                  {
                    role:    'system',
                    content: buildMemoryExtractionSystemPrompt(startup.name, currentMemory),
                  },
                  ...historyMessages.slice(-10),
                  { role: 'user',      content: `<user_input>${message}</user_input>` },
                  { role: 'assistant', content: fullResponse },
                ],
              })

              const memoryContent = memoryRes.choices[0]?.message?.content
              if (memoryContent) {
                const extracted = FounderMemorySchema.safeParse(JSON.parse(memoryContent))
                if (!extracted.success) {
                  console.error('[founder memory] schema validation failed', extracted.error.format())
                }
                if (extracted.success) {
                  const existing = existingMemoryRow
                    ? (FounderMemorySchema.safeParse(existingMemoryRow.memory).data ?? EMPTY_FOUNDER_MEMORY)
                    : EMPTY_FOUNDER_MEMORY

                  const merged = mergeFounderMemory(existing, extracted.data)

                  if (existingMemoryRow) {
                    await db
                      .update(founderMemories)
                      .set({ memory: merged, updatedAt: new Date() })
                      .where(eq(founderMemories.sessionId, sessionId))
                  } else {
                    await db.insert(founderMemories).values({
                      sessionId,
                      startupId,
                      userId,
                      memory: merged,
                    })
                  }

                  // 6. Sprint 2.5: Update founder understanding from the merged memory.
                  //    This is the core Sprint 2.5 side effect — updates founder_understanding
                  //    and inserts evidence_records. The result drives the progress UI and
                  //    the gap-aware system prompt on the next turn.
                  const understandingResult = await updateUnderstanding({
                    db,
                    sessionId,
                    startupId,
                    userId,
                    memory:          merged,
                    sourceMessageId: job.id,
                  })

                  // 7. Close the session when understanding is complete.
                  //    Prevents further messages via the status guard, finalizes telemetry.
                  if (understandingResult.isComplete) {
                    const durationSeconds = Math.round(
                      (Date.now() - session.createdAt.getTime()) / 1000,
                    )
                    await db
                      .update(founderSessions)
                      .set({
                        status:                 'completed',
                        sessionDurationSeconds: durationSeconds,
                        updatedAt:              new Date(),
                      })
                      .where(eq(founderSessions.id, sessionId))
                  }
                }
              }

              await trackUsage(db, {
                userId,
                startupId,
                generationJobId: job.id,
                usage:           fromOpenAI(memoryRes),
                purpose:         'chat',
              })

            } catch (sideEffectErr) {
              console.error('[chat side effects]', sideEffectErr)
            }
          })()
        },
      }),
      200,
      {
        'Content-Type':    'text/event-stream',
        'Cache-Control':   'no-cache',
        'Connection':      'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    )
  },
)
