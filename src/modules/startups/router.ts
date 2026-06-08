import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import { startups } from '../../lib/db/schema/index.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { logActivity } from '../../agents/base/utils.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const startupsRouter = new Hono<HonoEnv>()

// ── Shared Zod schemas ────────────────────────────────────────────────────────

const categoryEnum = z.enum([
  'saas',
  'marketplace',
  'fintech',
  'healthcare',
  'ecommerce',
  'developer-tool',
  'ai-tool',
  'social',
  'other',
])

const idParam = z.object({ id: z.string().uuid('Invalid startup ID') })

const createStartupBody = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(500).optional(),
  category: categoryEnum.optional(),
})

const updateStartupBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(500).nullable().optional(),
    category: categoryEnum.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  })

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/v1/startups
startupsRouter.get('/', requireAuth, async (c) => {
  const userId = c.var.user.id

  const rows = await db
    .select()
    .from(startups)
    .where(and(eq(startups.userId, userId), isNull(startups.deletedAt)))
    .orderBy(desc(startups.createdAt))

  return c.json({ data: rows })
})

// POST /api/v1/startups
startupsRouter.post(
  '/',
  requireAuth,
  zValidator('json', createStartupBody),
  async (c) => {
    const userId = c.var.user.id
    const body = c.req.valid('json')

    const [startup] = await db
      .insert(startups)
      .values({
        userId,
        name: body.name,
        description: body.description,
        category: body.category,
        lifecycleStage: 'founder-session',
      })
      .returning()

    await logActivity(db, {
      userId,
      startupId: startup.id,
      type: 'startup.created',
      description: `Startup "${startup.name}" created`,
      meta: { startupId: startup.id },
    })

    return c.json({ data: startup }, 201)
  },
)

// GET /api/v1/startups/:id
startupsRouter.get(
  '/:id',
  requireAuth,
  zValidator('param', idParam),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.var.user.id

    const startup = await requireStartupOwner(id, userId)
    return c.json({ data: startup })
  },
)

// PATCH /api/v1/startups/:id
startupsRouter.patch(
  '/:id',
  requireAuth,
  zValidator('param', idParam),
  zValidator('json', updateStartupBody),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.var.user.id
    const body = c.req.valid('json')

    await requireStartupOwner(id, userId)

    const [updated] = await db
      .update(startups)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(startups.id, id), eq(startups.userId, userId)))
      .returning()

    return c.json({ data: updated })
  },
)

// DELETE /api/v1/startups/:id  (soft delete)
startupsRouter.delete(
  '/:id',
  requireAuth,
  zValidator('param', idParam),
  async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.var.user.id

    await requireStartupOwner(id, userId)

    await db
      .update(startups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(startups.id, id), eq(startups.userId, userId)))

    return c.body(null, 204)
  },
)
