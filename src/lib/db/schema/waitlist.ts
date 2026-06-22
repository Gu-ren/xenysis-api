import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { startups } from './startups.ts'

export const workspaceWaitlist = pgTable(
  'workspace_waitlist',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    userId:       uuid('user_id').notNull(),
    startupId:    uuid('startup_id').notNull().references(() => startups.id),
    startupName:  text('startup_name').notNull(),
    founderStage: text('founder_stage').notNull().default('building'),
    blueprintId:  uuid('blueprint_id'),
    email:        text('email').notNull(),
    source:       text('source').notNull().default('workspace_generation'),
    status:       text('status').notNull().default('waiting'),
    joinedAt:     timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt:   timestamp('notified_at', { withTimezone: true }),
    activatedAt:  timestamp('activated_at', { withTimezone: true }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('workspace_waitlist_status_check', sql`${table.status} IN ('waiting', 'notified', 'activated')`),
    check('workspace_waitlist_founder_stage_check', sql`${table.founderStage} IN ('idea', 'building', 'revenue')`),
  ],
)

export type WorkspaceWaitlistEntry = typeof workspaceWaitlist.$inferSelect
export type NewWorkspaceWaitlistEntry = typeof workspaceWaitlist.$inferInsert
