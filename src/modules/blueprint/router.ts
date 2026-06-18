import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import {
  blueprints,
  blueprintVersions,
} from '../../lib/db/schema/index.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { NotFoundError } from '../../middleware/errors.ts'
import { anthropic, openai } from '../../lib/ai/client.ts'
import { BlueprintGenerationService } from '../../services/blueprint-generation-service.ts'
import { BlueprintContentSchema } from '../../lib/contracts/blueprint.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const blueprintRouter = new Hono<HonoEnv>()

// ── Constants ─────────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache',
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

// ── Param schemas ─────────────────────────────────────────────────────────────

const startupIdParam = z.object({
  id: z.string().uuid('Invalid startup ID'),
})

const versionIdParam = z.object({
  id:        z.string().uuid('Invalid startup ID'),
  versionId: z.string().uuid('Invalid version ID'),
})

// ── POST /:id/blueprints/generate  ← SSE ─────────────────────────────────────
// Validates startup ownership, then streams GenerationEvents as SSE via
// BlueprintGenerationService. Prerequisite: an opportunity assessment must exist.
blueprintRouter.post(
  '/:id/blueprints/generate',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const service = new BlueprintGenerationService(db, anthropic, openai)
    const stream  = await service.generateStream(startupId, userId)

    return c.body(stream, 200, SSE_HEADERS)
  },
)

// ── GET /:id/blueprints/current  ──────────────────────────────────────────────
// Returns the current blueprint version (isCurrent = true). Content is validated
// against BlueprintContentSchema before returning — guards against stale JSONB.
blueprintRouter.get(
  '/:id/blueprints/current',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const [row] = await db
      .select({
        blueprintId:   blueprints.id,
        versionId:     blueprintVersions.id,
        versionNumber: blueprintVersions.versionNumber,
        content:       blueprintVersions.content,
        generatedAt:   blueprintVersions.createdAt,
      })
      .from(blueprints)
      .innerJoin(
        blueprintVersions,
        eq(blueprintVersions.blueprintId, blueprints.id),
      )
      .where(
        and(
          eq(blueprints.startupId, startupId),
          eq(blueprintVersions.isCurrent, true),
        ),
      )
      .limit(1)

    if (!row) throw new NotFoundError('No blueprint found for this startup')

    const parsed = BlueprintContentSchema.safeParse(row.content)
    if (!parsed.success) {
      console.error('[blueprint GET /current] content failed schema validation', parsed.error.format())
      throw new Error('Blueprint content is corrupted')
    }

    return c.json({
      data: {
        blueprintId:   row.blueprintId,
        versionId:     row.versionId,
        versionNumber: row.versionNumber,
        content:       parsed.data,
        generatedAt:   row.generatedAt,
      },
    })
  },
)

// ── GET /:id/blueprints  ──────────────────────────────────────────────────────
// Returns version history headers (no content), newest first. Used by the UI
// version history panel — content is fetched lazily per version.
blueprintRouter.get(
  '/:id/blueprints',
  requireAuth,
  zValidator('param', startupIdParam),
  async (c) => {
    const { id: startupId } = c.req.valid('param')
    const userId            = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const blueprint = await db.query.blueprints.findFirst({
      where: eq(blueprints.startupId, startupId),
    })
    if (!blueprint) throw new NotFoundError('No blueprint found for this startup')

    const versions = await db
      .select({
        versionId:     blueprintVersions.id,
        versionNumber: blueprintVersions.versionNumber,
        isCurrent:     blueprintVersions.isCurrent,
        generatedAt:   blueprintVersions.createdAt,
      })
      .from(blueprintVersions)
      .where(eq(blueprintVersions.blueprintId, blueprint.id))
      .orderBy(desc(blueprintVersions.versionNumber))

    return c.json({ data: versions })
  },
)

// ── GET /:id/blueprints/:versionId  ──────────────────────────────────────────
// Returns the full content for a specific version. Joins through the blueprints
// parent to ensure the version belongs to a startup the user owns.
blueprintRouter.get(
  '/:id/blueprints/:versionId',
  requireAuth,
  zValidator('param', versionIdParam),
  async (c) => {
    const { id: startupId, versionId } = c.req.valid('param')
    const userId                       = c.var.user.id

    await requireStartupOwner(startupId, userId)

    const [row] = await db
      .select({
        versionId:     blueprintVersions.id,
        versionNumber: blueprintVersions.versionNumber,
        isCurrent:     blueprintVersions.isCurrent,
        content:       blueprintVersions.content,
        generatedAt:   blueprintVersions.createdAt,
      })
      .from(blueprintVersions)
      .innerJoin(
        blueprints,
        eq(blueprintVersions.blueprintId, blueprints.id),
      )
      .where(
        and(
          eq(blueprintVersions.id, versionId),
          eq(blueprints.startupId, startupId),
        ),
      )
      .limit(1)

    if (!row) throw new NotFoundError('Blueprint version not found')

    const parsed = BlueprintContentSchema.safeParse(row.content)
    if (!parsed.success) throw new Error('Blueprint version content is corrupted')

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
