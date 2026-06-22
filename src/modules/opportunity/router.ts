import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import {
  founderSessions,
  generationJobs,
  opportunityAssessments,
  opportunityAssessmentVersions,
} from '../../lib/db/schema/index.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { BusinessRuleError, NotFoundError } from '../../middleware/errors.ts'
import { anthropic, openai } from '../../lib/ai/client.ts'
import { runAgent } from '../../agents/base/runner.ts'
import { formatSSE, errorEvent } from '../../agents/base/events.ts'
import { OpportunityAgent } from '../../agents/opportunity-agent/index.ts'
import { PROMPT_VERSION } from '../../agents/opportunity-agent/prompt.ts'
import { buildOpportunityContext } from '../../agents/opportunity-agent/context-builder.ts'
import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const opportunityRouter = new Hono<HonoEnv>()

// ── Constants ─────────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache',
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

// ── Param/body schemas ────────────────────────────────────────────────────────

const startupIdParam = z.object({
  id: z.string().uuid('Invalid startup ID'),
})

const generateBody = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
})

const sessionNestedParam = z.object({
  id:        z.string().uuid('Invalid startup ID'),
  sessionId: z.string().uuid('Invalid session ID'),
})

const versionIdParam = z.object({
  id:        z.string().uuid('Invalid startup ID'),
  versionId: z.string().uuid('Invalid version ID'),
})

// ── Shared generation helper ──────────────────────────────────────────────────
// Validates the session, creates a generation job, builds agent context, and
// returns an SSE ReadableStream. Used by both generate routes so the 40-line
// handler body is not duplicated.
async function runAssessmentStream(
  startupId: string,
  sessionId: string,
  userId:    string,
): Promise<ReadableStream> {
  const session = await db.query.founderSessions.findFirst({
    where: and(
      eq(founderSessions.id, sessionId),
      eq(founderSessions.startupId, startupId),
      eq(founderSessions.userId, userId),
    ),
  })
  if (!session) throw new NotFoundError('Session not found')
  if (session.status !== 'completed') throw new BusinessRuleError(
    'Session must be completed before generating an opportunity assessment',
  )

  const [job] = await db
    .insert(generationJobs)
    .values({
      userId,
      startupId,
      type:          'opportunity',
      status:        'pending',
      model:         'gpt-4o',
      provider:      'openai',
      promptVersion: PROMPT_VERSION,
    })
    .returning()

  const input = await buildOpportunityContext(db, startupId, sessionId, userId, job.id)

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit    = (data: string) => controller.enqueue(encoder.encode(data))

      try {
        for await (const event of runAgent(new OpportunityAgent(), input, db, anthropic, openai)) {
          emit(formatSSE(event))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed'
        emit(formatSSE(errorEvent('GENERATION_FAILED', msg, false)))
      } finally {
        controller.close()
      }
    },
  })
}

// ── POST /:id/opportunity/generate  ← SSE ────────────────────────────────────
// Legacy generation route — sessionId supplied in the request body.
// New callers should prefer POST /:id/sessions/:sessionId/opportunity-assessment.
opportunityRouter.post(
  '/:id/opportunity/generate',
  requireAuth,
  zValidator('param', startupIdParam),
  zValidator('json', generateBody),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const { sessionId }     = c.req.valid('json')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)
    const stream = await runAssessmentStream(startupId, sessionId, userId)
    return c.body(stream, 200, SSE_HEADERS)
  },
)

// ── POST /:id/sessions/:sessionId/opportunity-assessment  ← SSE ──────────────
// REST-canonical generation route — sessionId carried in the URL path.
// Validates session ownership and completion, then streams GenerationEvents as SSE
// via the shared runAssessmentStream helper.
opportunityRouter.post(
  '/:id/sessions/:sessionId/opportunity-assessment',
  requireAuth,
  zValidator('param', sessionNestedParam),
  async (c) => {
    const { id: startupId, sessionId } = c.req.valid('param')
    const userId                       = c.var.user.id

    await requireStartupOwner(startupId, userId)
    const stream = await runAssessmentStream(startupId, sessionId, userId)
    return c.body(stream, 200, SSE_HEADERS)
  },
)

// ── GET /:id/opportunity  ─────────────────────────────────────────────────────
// Returns the current opportunity assessment (the version with isCurrent = true).
// Content is validated against OpportunityAssessmentContentSchema before returning —
// this guards against stale JSONB that predates a schema migration.
opportunityRouter.get(
  '/:id/opportunity',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const [row] = await db
      .select({
        assessmentId:  opportunityAssessments.id,
        versionId:     opportunityAssessmentVersions.id,
        versionNumber: opportunityAssessmentVersions.versionNumber,
        content:       opportunityAssessmentVersions.content,
        generatedAt:   opportunityAssessmentVersions.createdAt,
      })
      .from(opportunityAssessments)
      .innerJoin(
        opportunityAssessmentVersions,
        eq(opportunityAssessmentVersions.assessmentId, opportunityAssessments.id),
      )
      .where(
        and(
          eq(opportunityAssessments.startupId, startupId),
          eq(opportunityAssessmentVersions.isCurrent, true),
        ),
      )
      .limit(1)

    if (!row) throw new NotFoundError('No opportunity assessment found for this startup')

    const parsed = OpportunityAssessmentContentSchema.safeParse(row.content)
    if (!parsed.success) {
      console.error('[opportunity GET] content failed schema validation', parsed.error.format())
      throw new Error('Opportunity assessment content is corrupted')
    }

    return c.json({
      data: {
        assessmentId:  row.assessmentId,
        versionId:     row.versionId,
        versionNumber: row.versionNumber,
        content:       parsed.data,
        generatedAt:   row.generatedAt,
      },
    })
  },
)

// ── GET /:id/opportunity-assessment  ─────────────────────────────────────────
// REST-canonical read route — mirrors GET /:id/opportunity with a kebab-case
// resource name consistent with the session-nested POST above.
opportunityRouter.get(
  '/:id/opportunity-assessment',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const [row] = await db
      .select({
        assessmentId:  opportunityAssessments.id,
        versionId:     opportunityAssessmentVersions.id,
        versionNumber: opportunityAssessmentVersions.versionNumber,
        content:       opportunityAssessmentVersions.content,
        generatedAt:   opportunityAssessmentVersions.createdAt,
      })
      .from(opportunityAssessments)
      .innerJoin(
        opportunityAssessmentVersions,
        eq(opportunityAssessmentVersions.assessmentId, opportunityAssessments.id),
      )
      .where(
        and(
          eq(opportunityAssessments.startupId, startupId),
          eq(opportunityAssessmentVersions.isCurrent, true),
        ),
      )
      .limit(1)

    if (!row) throw new NotFoundError('No opportunity assessment found for this startup')

    const parsed = OpportunityAssessmentContentSchema.safeParse(row.content)
    if (!parsed.success) {
      console.error('[opportunity-assessment GET] content failed schema validation', parsed.error.format())
      throw new Error('Opportunity assessment content is corrupted')
    }

    return c.json({
      data: {
        assessmentId:  row.assessmentId,
        versionId:     row.versionId,
        versionNumber: row.versionNumber,
        content:       parsed.data,
        generatedAt:   row.generatedAt,
      },
    })
  },
)

// ── GET /:id/opportunity/versions  ────────────────────────────────────────────
// Returns headers for all assessment versions (no content). Used by the UI
// version history panel — content is fetched lazily per version.
opportunityRouter.get(
  '/:id/opportunity/versions',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const assessment = await db.query.opportunityAssessments.findFirst({
      where: eq(opportunityAssessments.startupId, startupId),
    })
    if (!assessment) throw new NotFoundError('No opportunity assessment found for this startup')

    const versions = await db
      .select({
        versionId:     opportunityAssessmentVersions.id,
        versionNumber: opportunityAssessmentVersions.versionNumber,
        isCurrent:     opportunityAssessmentVersions.isCurrent,
        generatedAt:   opportunityAssessmentVersions.createdAt,
      })
      .from(opportunityAssessmentVersions)
      .where(eq(opportunityAssessmentVersions.assessmentId, assessment.id))
      .orderBy(opportunityAssessmentVersions.versionNumber)

    return c.json({ data: versions })
  },
)

// ── GET /:id/opportunity/versions/:versionId  ─────────────────────────────────
// Returns the full content for a specific version by ID.
opportunityRouter.get(
  '/:id/opportunity/versions/:versionId',
  requireAuth,
  zValidator('param', versionIdParam),
  async (c) => {
    const { id: startupId, versionId } = c.req.valid('param')
    const userId                       = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const [row] = await db
      .select({
        versionId:     opportunityAssessmentVersions.id,
        versionNumber: opportunityAssessmentVersions.versionNumber,
        isCurrent:     opportunityAssessmentVersions.isCurrent,
        content:       opportunityAssessmentVersions.content,
        generatedAt:   opportunityAssessmentVersions.createdAt,
      })
      .from(opportunityAssessmentVersions)
      .innerJoin(
        opportunityAssessments,
        eq(opportunityAssessmentVersions.assessmentId, opportunityAssessments.id),
      )
      .where(
        and(
          eq(opportunityAssessmentVersions.id, versionId),
          eq(opportunityAssessments.startupId, startupId),
        ),
      )
      .limit(1)

    if (!row) throw new NotFoundError('Version not found')

    const parsed = OpportunityAssessmentContentSchema.safeParse(row.content)
    if (!parsed.success) throw new Error('Opportunity assessment version content is corrupted')

    return c.json({
      data: {
        versionId:     row.versionId,
        versionNumber: row.versionNumber,
        isCurrent:     row.isCurrent,
        content:       parsed.data,
        generatedAt:   row.generatedAt,
      },
    })
  },
)
