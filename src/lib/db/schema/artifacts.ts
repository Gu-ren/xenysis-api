import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { founderSessions } from './founder-sessions.ts'
import { startups } from './startups.ts'

// ── Opportunity Assessments ───────────────────────────────────────────────────

export const opportunityAssessments = pgTable(
  'opportunity_assessments',
  {
    id:        uuid('id').primaryKey().defaultRandom(),
    startupId: uuid('startup_id').notNull().references(() => startups.id),
    sessionId: uuid('session_id').notNull().references(() => founderSessions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One assessment parent row per startup — versions are appended to this parent.
    // OpportunityAgent upserts this row on every generation; versions are never deleted.
    unique('uq_opportunity_startup').on(t.startupId),
  ],
)

export const opportunityAssessmentVersions = pgTable(
  'opportunity_assessment_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id').notNull().references(() => opportunityAssessments.id),
    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    generationJobId: uuid('generation_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.assessmentId, t.versionNumber)],
)

// ── Blueprints ────────────────────────────────────────────────────────────────

export const blueprints = pgTable('blueprints', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id),
  sessionId: uuid('session_id').notNull().references(() => founderSessions.id),
  assessmentId: uuid('assessment_id').references(() => opportunityAssessments.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const blueprintVersions = pgTable(
  'blueprint_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blueprintId: uuid('blueprint_id').notNull().references(() => blueprints.id),
    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    generationJobId: uuid('generation_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.blueprintId, t.versionNumber)],
)

// ── Workspace Graphs ──────────────────────────────────────────────────────────

export const workspaceGraphs = pgTable('workspace_graphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().unique().references(() => startups.id),
  blueprintId: uuid('blueprint_id').references(() => blueprints.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceGraphVersions = pgTable(
  'workspace_graph_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaceGraphs.id),
    versionNumber: integer('version_number').notNull(),
    graph: jsonb('graph').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    generationJobId: uuid('generation_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.versionNumber)],
)

export const workspaceAssetConfigs = pgTable(
  'workspace_asset_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaceGraphs.id),
    assetId: text('asset_id').notNull(),
    status: text('status'),
    config: jsonb('config'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.assetId)],
)

// ── Preview Contexts ──────────────────────────────────────────────────────────

export const previewContexts = pgTable('preview_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().unique().references(() => startups.id),
  workspaceVersionId: uuid('workspace_version_id').references(() => workspaceGraphVersions.id),
  content: jsonb('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Types ─────────────────────────────────────────────────────────────────────

export type OpportunityAssessment = typeof opportunityAssessments.$inferSelect
export type NewOpportunityAssessment = typeof opportunityAssessments.$inferInsert
export type OpportunityAssessmentVersion = typeof opportunityAssessmentVersions.$inferSelect
export type NewOpportunityAssessmentVersion = typeof opportunityAssessmentVersions.$inferInsert

export type Blueprint = typeof blueprints.$inferSelect
export type NewBlueprint = typeof blueprints.$inferInsert
export type BlueprintVersion = typeof blueprintVersions.$inferSelect
export type NewBlueprintVersion = typeof blueprintVersions.$inferInsert

export type WorkspaceGraph = typeof workspaceGraphs.$inferSelect
export type NewWorkspaceGraph = typeof workspaceGraphs.$inferInsert
export type WorkspaceGraphVersion = typeof workspaceGraphVersions.$inferSelect
export type NewWorkspaceGraphVersion = typeof workspaceGraphVersions.$inferInsert
export type WorkspaceAssetConfig = typeof workspaceAssetConfigs.$inferSelect
export type NewWorkspaceAssetConfig = typeof workspaceAssetConfigs.$inferInsert

export type PreviewContext = typeof previewContexts.$inferSelect
export type NewPreviewContext = typeof previewContexts.$inferInsert
