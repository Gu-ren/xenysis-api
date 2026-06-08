import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { environmentNameEnum, releaseStatusEnum } from './enums.ts'
import { startups } from './startups.ts'

export const deployEnvironments = pgTable(
  'deploy_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startupId: uuid('startup_id').notNull().references(() => startups.id),
    name: environmentNameEnum('name').notNull(),
    branch: text('branch'),
    region: text('region'),
    platform: text('platform'),
    buildCommand: text('build_command'),
    outputDir: text('output_dir'),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.startupId, t.name)],
)

export const deployEnvVars = pgTable(
  'deploy_env_vars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => deployEnvironments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.environmentId, t.key)],
)

export const releases = pgTable('releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  environmentId: uuid('environment_id')
    .notNull()
    .references(() => deployEnvironments.id),
  version: text('version').notNull(),
  status: releaseStatusEnum('status').notNull().default('queued'),
  commitSha: text('commit_sha'),
  triggeredBy: uuid('triggered_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type DeployEnvironment = typeof deployEnvironments.$inferSelect
export type NewDeployEnvironment = typeof deployEnvironments.$inferInsert
export type DeployEnvVar = typeof deployEnvVars.$inferSelect
export type NewDeployEnvVar = typeof deployEnvVars.$inferInsert
export type Release = typeof releases.$inferSelect
export type NewRelease = typeof releases.$inferInsert
