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

const versionIdParam = z.object({
  id:        z.string().uuid('Invalid startup ID'),
  versionId: z.string().uuid('Invalid version ID'),
})

// ── POST /:id/opportunity/generate  ← SSE ────────────────────────────────────
// Creates a generation_jobs row, builds context from the completed founder session,
// runs OpportunityAgent via the standard runner, and streams GenerationEvents as SSE.
//
// SummaryStep integration: buildOpportunityContext() loads the latest session_summary
// row alongside founder_memory, founder_understanding, and evidence_records. No
// additional summary generation is needed here — the adaptive summary in the chat
// pipeline ensures the summary is current when the session completes.
//
// Job creation order matters: the job row must exist before buildOpportunityContext()
// is called so the jobId is threaded into the input contract and available to the runner.
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

    // Validate session: must belong to this startup/user and be completed.
    // Generating an opportunity assessment against an in-progress session produces
    // unreliable output — the conversation has not reached the understanding threshold.
    const session = await db.query.founderSessions.findFirst({
      where: and(
        eq(founderSessions.id, sessionId),
        eq(founderSessions.startupId, startupId),
        eq(founderSessions.userId, userId),
      ),
    })
    if (!session)                       throw new NotFoundError('Session not found')
    if (session.status !== 'completed') throw new BusinessRuleError(
      'Session must be completed before generating an opportunity assessment',
    )

    // Create generation job. The runner reads model and provider from this row.
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

    // Build context: loads founder_memory, founder_understanding, evidence_records,
    // session_summary for this session. Falls back to safe empty values on any parse
    // failure so the agent always receives a structurally valid input.
    const input = await buildOpportunityContext(db, startupId, sessionId, userId, job.id)

    // Stream agent events as SSE. The runner handles job state updates (active/done/failed)
    // and retries (up to maxAttempts). Any error that escapes the runner is caught here
    // and emitted as a terminal error event before the stream closes.
    return c.body(
      new ReadableStream({
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
      }),
      200,
      SSE_HEADERS,
    )
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
