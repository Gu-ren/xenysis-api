import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.ts'

export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
