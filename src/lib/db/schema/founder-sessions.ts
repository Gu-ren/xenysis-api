import { check, decimal, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { questionTypeEnum, sessionStatusEnum } from './enums.ts'
import { startups } from './startups.ts'

export const founderSessions = pgTable('founder_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id')
    .notNull()
    .references(() => startups.id),
  userId: uuid('user_id').notNull(),
  idea: text('idea').notNull(),
  status: sessionStatusEnum('status').notNull().default('active'),
  founderStage: text('founder_stage').notNull().default('building'),
  messagesCount: integer('messages_count').notNull().default(0),
  sessionDurationSeconds: integer('session_duration_seconds'),
  avgMessageLength: integer('avg_message_length'),
  completionRate: decimal('completion_rate', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const sessionAnswers = pgTable(
  'session_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => founderSessions.id),
    questionId: text('question_id').notNull(),
    questionType: questionTypeEnum('question_type').notNull().default('problem'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sequenceOrder: integer('sequence_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('answer_max_length', sql`char_length(${table.answer}) <= 2000`),
  ],
)

export type FounderSession = typeof founderSessions.$inferSelect
export type NewFounderSession = typeof founderSessions.$inferInsert
export type SessionAnswer = typeof sessionAnswers.$inferSelect
export type NewSessionAnswer = typeof sessionAnswers.$inferInsert
