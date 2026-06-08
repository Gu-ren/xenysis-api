import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { startups } from './startups.ts'

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  startupId: uuid('startup_id').references(() => startups.id),
  type: text('type').notNull(),
  description: text('description').notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type ActivityLogEntry = typeof activityLog.$inferSelect
export type NewActivityLogEntry = typeof activityLog.$inferInsert
