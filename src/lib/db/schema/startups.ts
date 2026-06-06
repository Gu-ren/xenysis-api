import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { lifecycleStageEnum, startupCategoryEnum } from './enums.ts'

export const startups = pgTable('startups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: startupCategoryEnum('category'),
  lifecycleStage: lifecycleStageEnum('lifecycle_stage')
    .notNull()
    .default('founder-session'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export type Startup = typeof startups.$inferSelect
export type NewStartup = typeof startups.$inferInsert
