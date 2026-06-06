import { relations } from 'drizzle-orm'
import { founderSessions, sessionAnswers } from './founder-sessions.ts'
import { startups } from './startups.ts'

// ── Active schema exports ─────────────────────────────────────────────────────
export * from './enums.ts'
export * from './profiles.ts'
export * from './startups.ts'
export * from './founder-sessions.ts'

// ── Drizzle relations (enables db.query.* relational API) ─────────────────────
export const startupsRelations = relations(startups, ({ many }) => ({
  founderSessions: many(founderSessions),
}))

export const founderSessionsRelations = relations(
  founderSessions,
  ({ one, many }) => ({
    startup: one(startups, {
      fields: [founderSessions.startupId],
      references: [startups.id],
    }),
    answers: many(sessionAnswers),
  }),
)

export const sessionAnswersRelations = relations(sessionAnswers, ({ one }) => ({
  session: one(founderSessions, {
    fields: [sessionAnswers.sessionId],
    references: [founderSessions.id],
  }),
}))

// ── Sprint 2+ schema (uncomment when the corresponding table is added) ─────────
// export * from './artifacts.ts'
// export * from './generation.ts'
// export * from './deploy.ts'
// export * from './activity.ts'
