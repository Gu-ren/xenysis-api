import { and, eq, isNull } from 'drizzle-orm'
import type { DB } from '../../lib/db/index.ts'
import {
  founderMemories,
  founderUnderstanding,
  opportunityAssessments,
  opportunityAssessmentVersions,
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
import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import { BusinessRuleError, NotFoundError } from '../../middleware/errors.ts'
import type { BlueprintAgentInput } from './input-contract.ts'

// Assembles all context required by BlueprintAgent from DB in one round-trip strategy:
//   Round 1 (parallel): startup + opportunity assessment parent row
//   Round 2 (parallel): current OA version + founder memory + founder understanding
//     (all keyed from the assessment row's sessionId)
//
// Prerequisite contract: an opportunity assessment must already exist for the startup.
// The route/service validates this before calling buildBlueprintContext, but we
// enforce it here as well so the function is safe to call from any context.
export async function buildBlueprintContext(
  db:        DB,
  startupId: string,
  userId:    string,
  jobId:     string,
): Promise<BlueprintAgentInput> {
  const [startup, assessmentRow] = await Promise.all([
    db.query.startups.findFirst({
      where: and(eq(startups.id, startupId), isNull(startups.deletedAt)),
    }),
    db.query.opportunityAssessments.findFirst({
      where: eq(opportunityAssessments.startupId, startupId),
    }),
  ])

  if (!startup) throw new NotFoundError('Startup not found or access denied')
  if (!assessmentRow) {
    throw new BusinessRuleError(
      'No opportunity assessment found. Generate an opportunity assessment before creating a blueprint.',
    )
  }

  const [versionRow, memoryRow, understandingRow] = await Promise.all([
    db.query.opportunityAssessmentVersions.findFirst({
      where: and(
        eq(opportunityAssessmentVersions.assessmentId, assessmentRow.id),
        eq(opportunityAssessmentVersions.isCurrent, true),
      ),
    }),
    db.query.founderMemories.findFirst({
      where: eq(founderMemories.sessionId, assessmentRow.sessionId),
    }),
    db.query.founderUnderstanding.findFirst({
      where: eq(founderUnderstanding.sessionId, assessmentRow.sessionId),
    }),
  ])

  if (!versionRow) throw new NotFoundError('Opportunity assessment has no current version')

  const assessmentParsed = OpportunityAssessmentContentSchema.safeParse(versionRow.content)
  if (!assessmentParsed.success) {
    throw new Error(
      'Opportunity assessment content is corrupted — regenerate the assessment before creating a blueprint',
    )
  }

  const founderMemory = memoryRow
    ? (FounderMemorySchema.safeParse(memoryRow.memory).data ?? EMPTY_FOUNDER_MEMORY)
    : EMPTY_FOUNDER_MEMORY

  const understanding = understandingRow
    ? (FounderUnderstandingSchema.safeParse(understandingRow.understanding).data ?? EMPTY_UNDERSTANDING)
    : EMPTY_UNDERSTANDING

  return {
    userId,
    startupId,
    jobId,
    sessionId:    assessmentRow.sessionId,
    assessmentId: assessmentRow.id,
    startup,
    founderMemory,
    understanding,
    assessment:   assessmentParsed.data,
  }
}
