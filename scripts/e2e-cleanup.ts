import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema/index.ts'
import { desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const client = postgres(process.env.DATABASE_URL, { prepare: false })
const db = drizzle(client, { schema })

const startups = await db.query.startups.findMany({ orderBy: [desc(schema.startups.createdAt)] })

for (const startup of startups) {
  console.log(`Cleaning startup: ${startup.id} — ${startup.name}`)
  // Use raw SQL with subquery cascade ordering to avoid FK chain issues
  await client`DELETE FROM blueprint_versions WHERE blueprint_id IN (SELECT id FROM blueprints WHERE startup_id = ${startup.id})`
  await client`DELETE FROM blueprints WHERE startup_id = ${startup.id}`
  await client`DELETE FROM opportunity_assessment_versions WHERE assessment_id IN (SELECT id FROM opportunity_assessments WHERE startup_id = ${startup.id})`
  await client`DELETE FROM opportunity_assessments WHERE startup_id = ${startup.id}`
  await client`DELETE FROM founder_understanding WHERE startup_id = ${startup.id}`
  await client`DELETE FROM evidence_records WHERE session_id IN (SELECT id FROM founder_sessions WHERE startup_id = ${startup.id})`
  await client`DELETE FROM founder_memories WHERE session_id IN (SELECT id FROM founder_sessions WHERE startup_id = ${startup.id})`
  await client`DELETE FROM founder_sessions WHERE startup_id = ${startup.id}`
  await client`DELETE FROM activity_log WHERE startup_id = ${startup.id}`
  await client`DELETE FROM ai_usage_log WHERE startup_id = ${startup.id}`
  await client`DELETE FROM generation_jobs WHERE startup_id = ${startup.id}`
  await client`DELETE FROM startups WHERE id = ${startup.id}`
  console.log(`  done`)
}

console.log('Cleanup complete.')
await client.end()
process.exit(0)
