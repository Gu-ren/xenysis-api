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

export const generationJobTypeEnum = pgEnum('generation_job_type', [
  'opportunity',
  'blueprint',
  'workspace',
  'preview',
  'full',
  'founder_chat',
])

export const generationJobStatusEnum = pgEnum('generation_job_status', [
  'pending',
  'active',
  'done',
  'failed',
  'cancelled',
])

export const aiPurposeEnum = pgEnum('ai_purpose', [
  'chat',
  'opportunity_gen',
  'blueprint_gen',
  'workspace_gen',
  'preview_gen',
])

export const aiProviderEnum = pgEnum('ai_provider', [
  'openai',
  'anthropic',
])

export const releaseStatusEnum = pgEnum('release_status', [
  'queued',
  'in_progress',
  'success',
  'failed',
])

export const environmentNameEnum = pgEnum('environment_name', [
  'production',
  'staging',
  'development',
])

// ── TypeScript union types inferred from drizzle enums ────────────────────────
export type LifecycleStage      = typeof lifecycleStageEnum.enumValues[number]
export type SessionStatus       = typeof sessionStatusEnum.enumValues[number]
export type QuestionType        = typeof questionTypeEnum.enumValues[number]
export type StartupCategory     = typeof startupCategoryEnum.enumValues[number]
export type GenerationJobType   = typeof generationJobTypeEnum.enumValues[number]
export type GenerationJobStatus = typeof generationJobStatusEnum.enumValues[number]
export type AiPurpose           = typeof aiPurposeEnum.enumValues[number]
export type AIProvider          = typeof aiProviderEnum.enumValues[number]
export type ReleaseStatus       = typeof releaseStatusEnum.enumValues[number]
export type EnvironmentName     = typeof environmentNameEnum.enumValues[number]
