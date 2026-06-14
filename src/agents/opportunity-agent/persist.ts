import { eq, max } from 'drizzle-orm'
import type { DB } from '../../lib/db/index.ts'
import {
  opportunityAssessments,
  opportunityAssessmentVersions,
} from '../../lib/db/schema/artifacts.ts'
import { OpportunityAssessmentContentSchema } from '../../lib/contracts/opportunity-assessment.ts'
import type { OpportunityAssessmentContent } from '../../lib/contracts/opportunity-assessment.ts'
import { logActivity } from '../base/utils.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersistAssessmentParams {
  db:        DB
  userId:    string
  startupId: string
  sessionId: string
  jobId:     string
  content:   OpportunityAssessmentContent
}

export interface PersistAssessmentResult {
  assessmentId:  string
  versionId:     string
  versionNumber: number
}

// ── persistAssessment ─────────────────────────────────────────────────────────
// Validates, writes, and links an opportunity assessment version.
//
// Transaction covers three writes:
//   1. Upsert opportunity_assessments parent row (one per startup — updates sessionId/updatedAt).
//   2. Demote all prior versions for this assessment (isCurrent = false).
//   3. Insert new opportunity_assessment_versions row (isCurrent = true).
//
// Activity log is written outside the transaction — it is a best-effort side-effect.
// A failure there must not roll back a successfully persisted assessment.
//
// Version numbering: scoped per startup via assessmentId.
//   nextVersion = MAX(version_number) + 1 for this assessment (defaults to 1 if none exist).
export async function persistAssessment(
  params: PersistAssessmentParams,
): Promise<PersistAssessmentResult> {
  const { db, userId, startupId, sessionId, jobId, content } = params

  // Hard validation at the persistence boundary. persist.ts does not trust callers
  // even when upstream validation has already occurred — bad content must never reach
  // the database. parse() throws ZodError on failure; the caller (agent index) handles it.
  const validatedContent = OpportunityAssessmentContentSchema.parse(content)

  // ── Atomic: upsert parent + version numbering + version insert ────────────
  const result = await db.transaction(async (tx) => {
    // 1. Upsert the parent assessment row (one per startup).
    //    On conflict: update sessionId and updatedAt so the row reflects the latest run.
    const [assessment] = await tx
      .insert(opportunityAssessments)
      .values({ startupId, sessionId })
      .onConflictDoUpdate({
        target: opportunityAssessments.startupId,
        set:    { sessionId, updatedAt: new Date() },
      })
      .returning({ id: opportunityAssessments.id })

    const assessmentId = assessment.id

    // 2. Derive next version number from MAX within this assessment.
    //    Runs inside the transaction so the read and write are atomic relative to
    //    other work in this connection. However, two concurrent transactions can both
    //    read the same MAX before either inserts — producing identical versionNumbers.
    //    The unique(assessmentId, versionNumber) constraint will reject the second
    //    insert with a unique violation. For v1 this is acceptable: concurrent
    //    generation of the same startup's assessment is rare and the error surfaces
    //    to the caller cleanly. Locking or retry infrastructure is deferred.
    const [maxRow] = await tx
      .select({ maxVer: max(opportunityAssessmentVersions.versionNumber) })
      .from(opportunityAssessmentVersions)
      .where(eq(opportunityAssessmentVersions.assessmentId, assessmentId))

    const nextVersion = (maxRow.maxVer ?? 0) + 1

    // 3. Demote all prior versions before inserting the new current one.
    await tx
      .update(opportunityAssessmentVersions)
      .set({ isCurrent: false })
      .where(eq(opportunityAssessmentVersions.assessmentId, assessmentId))

    // 4. Insert the new version as current.
    const [version] = await tx
      .insert(opportunityAssessmentVersions)
      .values({
        assessmentId,
        versionNumber:    nextVersion,
        content:          validatedContent,
        isCurrent:        true,
        generationJobId:  jobId,
      })
      .returning({ id: opportunityAssessmentVersions.id })

    return {
      assessmentId,
      versionId:     version.id,
      versionNumber: nextVersion,
    }
  })

  // ── Activity log (best-effort, outside transaction) ───────────────────────
  await logActivity(db, {
    userId,
    startupId,
    type:        'opportunity_assessment_generated',
    description: `Opportunity assessment version ${result.versionNumber} generated`,
    meta: {
      assessmentId:  result.assessmentId,
      versionId:     result.versionId,
      versionNumber: result.versionNumber,
      jobId,
      opportunityScore: validatedContent.opportunityScore,
      confidenceScore:  validatedContent.confidenceScore,
      recommendation:   validatedContent.recommendation.action,
    },
  })

  return result
}
