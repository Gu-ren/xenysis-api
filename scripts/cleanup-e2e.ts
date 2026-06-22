import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/lib/db/schema/index.ts'
import { eq, inArray } from 'drizzle-orm'

const TEST_USER_ID = 'e2e00000-0000-0000-0000-000000000001'

const client = postgres(process.env.DATABASE_URL!, { prepare: false })
const db = drizzle(client, { schema })

async function main() {
  const stups = await db.select().from(schema.startups).where(eq(schema.startups.userId, TEST_USER_ID))
  const startupIds = stups.map(s => s.id)
  if (!startupIds.length) { console.log('Nothing to clean'); await client.end(); return }
  console.log('Cleaning startups:', startupIds)

  const sessions = await db.select().from(schema.founderSessions).where(inArray(schema.founderSessions.startupId, startupIds))
  const sessionIds = sessions.map(s => s.id)
  console.log('Sessions:', sessionIds.length)

  // Get generation jobs
  const genJobs = sessionIds.length > 0
    ? await db.select().from(schema.generationJobs).where(inArray(schema.generationJobs.sessionId, sessionIds))
    : []
  const genJobIds = genJobs.map(j => j.id)
  console.log('GenJobs:', genJobIds.length)

  // Delete ai_usage_log for those jobs
  for (const jid of genJobIds) {
    await db.delete(schema.aiUsageLog).where(eq(schema.aiUsageLog.generationJobId, jid))
  }
  // Also delete ai_usage_log by startup
  for (const sid of startupIds) {
    await db.delete(schema.aiUsageLog).where(eq(schema.aiUsageLog.startupId, sid))
  }

  // Delete OA by session
  for (const sid of sessionIds) {
    await db.delete(schema.opportunityAssessments).where(eq(schema.opportunityAssessments.sessionId, sid))
  }
  // Delete OA by startup
  for (const sid of startupIds) {
    await db.delete(schema.opportunityAssessments).where(eq(schema.opportunityAssessments.startupId, sid))
  }

  // Delete generation jobs by session
  for (const sid of sessionIds) {
    await db.delete(schema.generationJobs).where(eq(schema.generationJobs.sessionId, sid))
  }
  // Delete generation jobs by startup
  for (const sid of startupIds) {
    await db.delete(schema.generationJobs).where(eq(schema.generationJobs.startupId, sid))
  }

  // evidence_records + founder_understanding
  for (const sid of sessionIds) {
    await db.delete(schema.evidenceRecords).where(eq(schema.evidenceRecords.sessionId, sid))
    await db.delete(schema.founderUnderstanding).where(eq(schema.founderUnderstanding.sessionId, sid))
  }

  // activity_log + blueprints
  for (const sid of startupIds) {
    await db.delete(schema.activityLog).where(eq(schema.activityLog.startupId, sid))
    await db.delete(schema.blueprints).where(eq(schema.blueprints.startupId, sid))
  }

  // sessions then startups
  if (sessionIds.length) {
    await db.delete(schema.founderSessions).where(inArray(schema.founderSessions.id, sessionIds))
  }
  await db.delete(schema.startups).where(inArray(schema.startups.id, startupIds))

  console.log('Done. Cleaned', startupIds.length, 'startup(s) and', sessionIds.length, 'session(s)')
  await client.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
