import { relations } from 'drizzle-orm'
import {
  blueprintVersions,
  blueprints,
  opportunityAssessmentVersions,
  opportunityAssessments,
  previewContexts,
  workspaceAssetConfigs,
  workspaceGraphVersions,
  workspaceGraphs,
} from './artifacts.ts'
import { founderSessions, sessionAnswers } from './founder-sessions.ts'
import { founderMemories, sessionSummaries } from './sessions-intelligence.ts'
import { founderUnderstanding, evidenceRecords } from './understanding.ts'
import { generationJobs, aiUsageLog } from './generation.ts'
import { deployEnvironments, deployEnvVars, releases } from './deploy.ts'
import { activityLog } from './activity.ts'
import { startups } from './startups.ts'

// ── Active schema exports ─────────────────────────────────────────────────────
export * from './enums.ts'
export * from './profiles.ts'
export * from './startups.ts'
export * from './founder-sessions.ts'
export * from './sessions-intelligence.ts'
export * from './understanding.ts'
export * from './artifacts.ts'
export * from './generation.ts'
export * from './deploy.ts'
export * from './activity.ts'

// ── Drizzle relations ─────────────────────────────────────────────────────────

export const startupsRelations = relations(startups, ({ many }) => ({
  founderSessions:        many(founderSessions),
  opportunityAssessments: many(opportunityAssessments),
  blueprints:             many(blueprints),
  generationJobs:         many(generationJobs),
  activityLog:            many(activityLog),
  deployEnvironments:     many(deployEnvironments),
}))

export const founderSessionsRelations = relations(founderSessions, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [founderSessions.startupId],
    references: [startups.id],
  }),
  answers:      many(sessionAnswers),
  summaries:    many(sessionSummaries),
  memory: one(founderMemories, {
    fields:     [founderSessions.id],
    references: [founderMemories.sessionId],
  }),
  understanding: one(founderUnderstanding, {
    fields:     [founderSessions.id],
    references: [founderUnderstanding.sessionId],
  }),
  evidenceRecords: many(evidenceRecords),
}))

export const sessionAnswersRelations = relations(sessionAnswers, ({ one }) => ({
  session: one(founderSessions, {
    fields:     [sessionAnswers.sessionId],
    references: [founderSessions.id],
  }),
}))

export const sessionSummariesRelations = relations(sessionSummaries, ({ one }) => ({
  session: one(founderSessions, {
    fields:     [sessionSummaries.sessionId],
    references: [founderSessions.id],
  }),
}))

export const founderMemoriesRelations = relations(founderMemories, ({ one }) => ({
  session: one(founderSessions, {
    fields:     [founderMemories.sessionId],
    references: [founderSessions.id],
  }),
}))

export const founderUnderstandingRelations = relations(founderUnderstanding, ({ one, many }) => ({
  session: one(founderSessions, {
    fields:     [founderUnderstanding.sessionId],
    references: [founderSessions.id],
  }),
  evidenceRecords: many(evidenceRecords),
}))

export const evidenceRecordsRelations = relations(evidenceRecords, ({ one }) => ({
  session: one(founderSessions, {
    fields:     [evidenceRecords.sessionId],
    references: [founderSessions.id],
  }),
}))

export const opportunityAssessmentsRelations = relations(opportunityAssessments, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [opportunityAssessments.startupId],
    references: [startups.id],
  }),
  versions: many(opportunityAssessmentVersions),
}))

export const opportunityAssessmentVersionsRelations = relations(opportunityAssessmentVersions, ({ one }) => ({
  assessment: one(opportunityAssessments, {
    fields:     [opportunityAssessmentVersions.assessmentId],
    references: [opportunityAssessments.id],
  }),
}))

export const blueprintsRelations = relations(blueprints, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [blueprints.startupId],
    references: [startups.id],
  }),
  versions: many(blueprintVersions),
}))

export const blueprintVersionsRelations = relations(blueprintVersions, ({ one }) => ({
  blueprint: one(blueprints, {
    fields:     [blueprintVersions.blueprintId],
    references: [blueprints.id],
  }),
}))

export const workspaceGraphsRelations = relations(workspaceGraphs, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [workspaceGraphs.startupId],
    references: [startups.id],
  }),
  versions:     many(workspaceGraphVersions),
  assetConfigs: many(workspaceAssetConfigs),
}))

export const workspaceGraphVersionsRelations = relations(workspaceGraphVersions, ({ one }) => ({
  workspace: one(workspaceGraphs, {
    fields:     [workspaceGraphVersions.workspaceId],
    references: [workspaceGraphs.id],
  }),
}))

export const workspaceAssetConfigsRelations = relations(workspaceAssetConfigs, ({ one }) => ({
  workspace: one(workspaceGraphs, {
    fields:     [workspaceAssetConfigs.workspaceId],
    references: [workspaceGraphs.id],
  }),
}))

export const previewContextsRelations = relations(previewContexts, ({ one }) => ({
  startup: one(startups, {
    fields:     [previewContexts.startupId],
    references: [startups.id],
  }),
}))

export const generationJobsRelations = relations(generationJobs, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [generationJobs.startupId],
    references: [startups.id],
  }),
  parent: one(generationJobs, {
    fields:       [generationJobs.parentJobId],
    references:   [generationJobs.id],
    relationName: 'parentChild',
  }),
  children:  many(generationJobs, { relationName: 'parentChild' }),
  usageLogs: many(aiUsageLog),
}))

export const aiUsageLogRelations = relations(aiUsageLog, ({ one }) => ({
  startup: one(startups, {
    fields:     [aiUsageLog.startupId],
    references: [startups.id],
  }),
  job: one(generationJobs, {
    fields:     [aiUsageLog.generationJobId],
    references: [generationJobs.id],
  }),
}))

export const deployEnvironmentsRelations = relations(deployEnvironments, ({ one, many }) => ({
  startup: one(startups, {
    fields:     [deployEnvironments.startupId],
    references: [startups.id],
  }),
  envVars:  many(deployEnvVars),
  releases: many(releases),
}))

export const deployEnvVarsRelations = relations(deployEnvVars, ({ one }) => ({
  environment: one(deployEnvironments, {
    fields:     [deployEnvVars.environmentId],
    references: [deployEnvironments.id],
  }),
}))

export const releasesRelations = relations(releases, ({ one }) => ({
  environment: one(deployEnvironments, {
    fields:     [releases.environmentId],
    references: [deployEnvironments.id],
  }),
}))

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  startup: one(startups, {
    fields:     [activityLog.startupId],
    references: [startups.id],
  }),
}))
