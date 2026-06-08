import { integer, jsonb, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { founderSessions } from './founder-sessions.ts'
import { startups } from './startups.ts'

// Rolling structured summaries — generated every 15 exchanges or when prompt tokens exceed 12k.
// Each row covers a window of conversation; the latest row is used as context for new prompts.
export const sessionSummaries = pgTable('session_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => founderSessions.id),
  startupId: uuid('startup_id').notNull().references(() => startups.id),
  userId: uuid('user_id').notNull(),
  exchangeCount: integer('exchange_count').notNull(),
  sourceMessageCount: integer('source_message_count'),
  summaryTokenCount: integer('summary_token_count'),
  summary: jsonb('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Incrementally merged startup intelligence — upserted (never overwritten) after every AI exchange.
// Primary input for OpportunityAgent in Sprint 3. One row per session (UNIQUE on session_id).
export const founderMemories = pgTable(
  'founder_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => founderSessions.id),
    startupId: uuid('startup_id').notNull().references(() => startups.id),
    userId: uuid('user_id').notNull(),
    memory: jsonb('memory').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.sessionId)],
)

export type SessionSummaryRow = typeof sessionSummaries.$inferSelect
export type NewSessionSummaryRow = typeof sessionSummaries.$inferInsert
export type FounderMemoryRow = typeof founderMemories.$inferSelect
export type NewFounderMemoryRow = typeof founderMemories.$inferInsert
