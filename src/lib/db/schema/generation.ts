import { check, decimal, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { aiPurposeEnum, generationJobStatusEnum, generationJobTypeEnum } from './enums.ts'
import { startups } from './startups.ts'

export const generationJobs = pgTable('generation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  startupId: uuid('startup_id').notNull().references(() => startups.id),
  parentJobId: uuid('parent_job_id'),
  type: generationJobTypeEnum('type').notNull(),
  status: generationJobStatusEnum('status').notNull().default('pending'),
  artifactId: uuid('artifact_id'),
  artifactType: text('artifact_type'),
  promptVersion: text('prompt_version'),
  model: text('model').notNull().default('claude-sonnet-4-6'),
  idempotencyKey: text('idempotency_key').unique(),
  progress: integer('progress').notNull().default(0),
  stages: jsonb('stages').notNull().default(sql`'[]'::jsonb`),
  error: text('error'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  maxAttempts: integer('max_attempts').notNull().default(3),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('progress_range', sql`${t.progress} >= 0 AND ${t.progress} <= 100`),
])

export const aiUsageLog = pgTable('ai_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  startupId: uuid('startup_id').references(() => startups.id),
  generationJobId: uuid('generation_job_id').references(() => generationJobs.id),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: decimal('cost_usd', { precision: 10, scale: 6 }).notNull(),
  purpose: aiPurposeEnum('purpose').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type GenerationJob = typeof generationJobs.$inferSelect
export type NewGenerationJob = typeof generationJobs.$inferInsert
export type AiUsageLog = typeof aiUsageLog.$inferSelect
export type NewAiUsageLog = typeof aiUsageLog.$inferInsert
