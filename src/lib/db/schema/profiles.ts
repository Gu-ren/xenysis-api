import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// References auth.users(id) ON DELETE CASCADE — FK enforced in migration SQL.
// Drizzle cannot reference the auth schema directly, so the constraint lives
// only in the migration file.
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
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
