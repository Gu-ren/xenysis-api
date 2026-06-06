import { pgEnum } from 'drizzle-orm/pg-core'

export const lifecycleStageEnum = pgEnum('lifecycle_stage', [
  'founder-session',
  'generating',
  'preview',
  'build',
  'deployed',
])

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'completed',
  'abandoned',
])

export const questionTypeEnum = pgEnum('question_type', [
  'problem',
  'customer',
  'market',
  'competition',
  'revenue',
  'team',
  'vision',
  'assumption',
])

export const startupCategoryEnum = pgEnum('startup_category', [
  'saas',
  'marketplace',
  'fintech',
  'healthcare',
  'ecommerce',
  'developer-tool',
  'ai-tool',
  'social',
  'other',
])

// ── Sprint 2+ enums ───────────────────────────────────────────────────────────
// TODO(sprint-3): generationJobTypeEnum, generationJobStatusEnum, aiPurposeEnum
// TODO(sprint-5): releaseStatusEnum, environmentNameEnum
