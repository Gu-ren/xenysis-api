import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { DB } from '../../lib/db/index.ts'
import {
  evidenceRecords,
  founderMemories,
  founderUnderstanding,
  sessionSummaries,
  startups,
} from '../../lib/db/schema/index.ts'
import {
  EMPTY_FOUNDER_MEMORY,
  FounderMemorySchema,
} from '../../lib/contracts/founder-memory.ts'
import {
  EMPTY_UNDERSTANDING,
  FounderUnderstandingSchema,
} from '../../lib/contracts/founder-understanding.ts'
import { SessionSummarySchema } from '../../lib/contracts/session-summary.ts'
import { NotFoundError } from '../../middleware/errors.ts'
import type { OpportunityAgentInput } from './input-contract.ts'

// Assembles all context required by OpportunityAgent from DB in one parallel load.
// Validates each JSONB payload against its Zod schema and falls back to safe empty values
// on parse failure — ensuring the agent always receives a structurally valid input even
// when an older memory row predates a schema revision.
export async function buildOpportunityContext(
  db:        DB,
  startupId: string,
  sessionId: string,
  userId:    string,
  jobId:     string,
): Promise<OpportunityAgentInput> {
  const [startup, memoryRow, understandingRow, evidenceRows, summaryRow] = await Promise.all([
    db.query.startups.findFirst({
      where: and(eq(startups.id, startupId), isNull(startups.deletedAt)),
    }),

    db.query.founderMemories.findFirst({
      where: eq(founderMemories.sessionId, sessionId),
    }),

    db.query.founderUnderstanding.findFirst({
      where: eq(founderUnderstanding.sessionId, sessionId),
    }),

    db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.sessionId, sessionId))
      .orderBy(asc(evidenceRecords.createdAt)),

    db.query.sessionSummaries.findFirst({
      where:   eq(sessionSummaries.sessionId, sessionId),
      orderBy: [desc(sessionSummaries.createdAt)],
    }),
  ])

  if (!startup) throw new NotFoundError('Startup not found or access denied')

  const founderMemory = memoryRow
    ? (FounderMemorySchema.safeParse(memoryRow.memory).data ?? EMPTY_FOUNDER_MEMORY)
    : EMPTY_FOUNDER_MEMORY

  const understanding = understandingRow
    ? (FounderUnderstandingSchema.safeParse(understandingRow.understanding).data ?? EMPTY_UNDERSTANDING)
    : EMPTY_UNDERSTANDING

  const latestSummary = summaryRow
    ? SessionSummarySchema.safeParse(summaryRow.summary).data
    : undefined

  return {
    userId,
    startupId,
    jobId,
    sessionId,
    startup,
    founderMemory,
    understanding,
    evidenceRecords: evidenceRows,
    latestSummary,
  }
}
