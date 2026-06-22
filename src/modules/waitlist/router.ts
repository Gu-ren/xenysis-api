import { Hono } from 'hono'
import { and, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../lib/db/index.ts'
import {
  founderSessions,
  workspaceWaitlist,
} from '../../lib/db/schema/index.ts'
import { requireStartupOwner } from '../../lib/db/startup-queries.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { logActivity } from '../../agents/base/utils.ts'
import { sendWaitlistConfirmation, sendWaitlistActivation } from '../../lib/email/index.ts'
import type { HonoEnv } from '../../types/hono.ts'

export const waitlistRouter = new Hono<HonoEnv>()

// ── Schemas ───────────────────────────────────────────────────────────────────

const joinWaitlistBody = z.object({
  startupId:   z.string().uuid('Invalid startup ID'),
  blueprintId: z.string().uuid('Invalid blueprint ID').optional(),
})

const activateBody = z.object({
  waitlistId: z.string().uuid('Invalid waitlist entry ID'),
})

// ── Helper: enforce admin header ──────────────────────────────────────────────

function isAdmin(adminHeader: string | undefined): boolean {
  const adminKey = process.env.ADMIN_SECRET_KEY
  if (!adminKey) return false
  return adminHeader === adminKey
}

// ── POST /api/v1/waitlist/workspace ───────────────────────────────────────────

waitlistRouter.post(
  '/workspace',
  requireAuth,
  zValidator('json', joinWaitlistBody),
  async (c) => {
    const userId    = c.var.user.id
    const userEmail = c.var.user.email ?? ''
    const body      = c.req.valid('json')

    // Validate startup ownership
    const startup = await requireStartupOwner(body.startupId, userId)

    // Idempotent: return existing entry if already on waitlist for this startup
    const [existing] = await db
      .select()
      .from(workspaceWaitlist)
      .where(
        and(
          eq(workspaceWaitlist.userId, userId),
          eq(workspaceWaitlist.startupId, body.startupId),
        ),
      )
      .limit(1)

    if (existing) {
      return c.json({ data: existing })
    }

    // Get founderStage from the most recent session for this startup
    const [latestSession] = await db
      .select({ founderStage: founderSessions.founderStage })
      .from(founderSessions)
      .where(
        and(
          eq(founderSessions.startupId, body.startupId),
          eq(founderSessions.userId, userId),
        ),
      )
      .orderBy(desc(founderSessions.createdAt))
      .limit(1)

    const founderStage = latestSession?.founderStage ?? 'building'

    const [entry] = await db
      .insert(workspaceWaitlist)
      .values({
        userId,
        startupId:    body.startupId,
        startupName:  startup.name,
        founderStage,
        blueprintId:  body.blueprintId ?? null,
        email:        userEmail,
        source:       'workspace_generation',
        status:       'waiting',
      })
      .returning()

    // Fire-and-forget: email + activity log
    const results = await Promise.allSettled([
      sendWaitlistConfirmation({
        to:          userEmail,
        startupName: startup.name,
        joinedAt:    entry.joinedAt,
      }),
      logActivity(db, {
        userId,
        startupId:   body.startupId,
        type:        'workspace_waitlist_joined',
        description: `Joined Workspace Generation waitlist for "${startup.name}"`,
        meta: {
          waitlistId:   entry.id,
          startupId:    body.startupId,
          startupStage: founderStage,
          blueprintId:  body.blueprintId ?? null,
        },
      }),
    ])

    const emailResult = results[0]
    if (emailResult.status === 'rejected') {
      console.error('[waitlist] confirmation email failed:', emailResult.reason)
    }

    return c.json({ data: entry }, 201)
  },
)

// ── GET /api/v1/admin/waitlist/workspace ──────────────────────────────────────
// Requires X-Admin-Key header matching ADMIN_SECRET_KEY env var.

waitlistRouter.get(
  '/admin/workspace',
  requireAuth,
  async (c) => {
    const adminHeader = c.req.header('X-Admin-Key')
    if (!isAdmin(adminHeader)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, 403)
    }

    const [metrics] = await db
      .select({
        totalSignups:   count(workspaceWaitlist.id),
        uniqueUsers:    countDistinct(workspaceWaitlist.userId),
        uniqueStartups: countDistinct(workspaceWaitlist.startupId),
      })
      .from(workspaceWaitlist)

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const signupsByDay = await db
      .select({
        day:   sql<string>`date_trunc('day', ${workspaceWaitlist.joinedAt})::date`,
        count: count(workspaceWaitlist.id),
      })
      .from(workspaceWaitlist)
      .where(gte(workspaceWaitlist.joinedAt, thirtyDaysAgo))
      .groupBy(sql`date_trunc('day', ${workspaceWaitlist.joinedAt})::date`)
      .orderBy(sql`date_trunc('day', ${workspaceWaitlist.joinedAt})::date`)

    const entries = await db
      .select()
      .from(workspaceWaitlist)
      .orderBy(desc(workspaceWaitlist.joinedAt))

    return c.json({
      data: {
        metrics: {
          totalSignups:   metrics.totalSignups,
          uniqueUsers:    metrics.uniqueUsers,
          uniqueStartups: metrics.uniqueStartups,
        },
        signupsByDay,
        entries,
      },
    })
  },
)

// ── POST /api/v1/admin/waitlist/workspace/activate ────────────────────────────
// Activate a waitlist entry — sends launch email + sets status = activated.

waitlistRouter.post(
  '/admin/workspace/activate',
  requireAuth,
  zValidator('json', activateBody),
  async (c) => {
    const adminHeader = c.req.header('X-Admin-Key')
    if (!isAdmin(adminHeader)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, 403)
    }

    const { waitlistId } = c.req.valid('json')

    const [existing] = await db
      .select()
      .from(workspaceWaitlist)
      .where(eq(workspaceWaitlist.id, waitlistId))
      .limit(1)

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Waitlist entry not found' } }, 404)
    }

    const now = new Date()
    const [updated] = await db
      .update(workspaceWaitlist)
      .set({ status: 'activated', activatedAt: now, notifiedAt: now })
      .where(eq(workspaceWaitlist.id, waitlistId))
      .returning()

    sendWaitlistActivation({
      to:          existing.email,
      startupName: existing.startupName,
    }).catch((err) => console.error('[waitlist] activation email failed:', err))

    return c.json({ data: updated })
  },
)
