import { eq, max } from 'drizzle-orm'
import type { DB } from '../../lib/db/index.ts'
import { blueprints, blueprintVersions } from '../../lib/db/schema/artifacts.ts'
import { BlueprintContentSchema } from '../../lib/contracts/blueprint.ts'
import type { BlueprintContent } from '../../lib/contracts/blueprint.ts'
import { logActivity } from '../base/utils.ts'
import type { UnderstandingCategory, BlueprintMode, FounderStage } from '../../lib/contracts/founder-understanding.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersistBlueprintParams {
  db:              DB
  userId:          string
  startupId:       string
  sessionId:       string
  assessmentId:    string
  jobId:           string
  content:         BlueprintContent
  // v2.1 F5: fabrication prevention metadata — included in blueprint_generated event
  gapsInBlueprint?: UnderstandingCategory[]
  blueprintMode?:   BlueprintMode
  founderStage?:    FounderStage
}

export interface PersistBlueprintResult {
  blueprintId:   string
  versionId:     string
  versionNumber: number
}

// ── persistBlueprint ──────────────────────────────────────────────────────────
// Validates, writes, and links a blueprint version.
//
// Transaction covers four writes:
//   1. Find or insert blueprints parent row (one per startup — application-level uniqueness
//      since the schema has no unique(startupId) constraint on blueprints).
//   2. Update sessionId/assessmentId/updatedAt on the parent row if it already exists.
//   3. Demote all prior blueprint_versions rows (isCurrent = false).
//   4. Insert new blueprint_versions row (isCurrent = true).
//
// Version numbering: MAX(version_number) + 1 scoped to the blueprint parent row.
// Concurrent generation of the same startup's blueprint is prevented by the
// unique(blueprintId, versionNumber) constraint on blueprint_versions —
// the second concurrent insert will fail with a unique violation.
//
// Activity log is written outside the transaction — best-effort, never rolls back
// a successfully persisted blueprint.
export async function persistBlueprint(
  params: PersistBlueprintParams,
): Promise<PersistBlueprintResult> {
  const {
    db, userId, startupId, sessionId, assessmentId, jobId, content,
    gapsInBlueprint = [], blueprintMode = 'validated', founderStage = 'building',
  } = params

  // Hard validation at the persistence boundary. Even if the agent already validated,
  // persist.ts never trusts callers with DB-bound content.
  const validatedContent = BlueprintContentSchema.parse(content)

  // ── Atomic: upsert parent + version numbering + version insert ────────────
  const result = await db.transaction(async (tx) => {
    // 1. Look up the existing blueprint parent row for this startup.
    const existing = await tx.query.blueprints.findFirst({
      where: eq(blueprints.startupId, startupId),
      columns: { id: true },
    })

    let blueprintId: string

    if (existing) {
      // 2a. Update session and assessment links so the parent row reflects the latest run.
      await tx
        .update(blueprints)
        .set({ sessionId, assessmentId, updatedAt: new Date() })
        .where(eq(blueprints.id, existing.id))
      blueprintId = existing.id
    } else {
      // 2b. Insert the parent row on first generation.
      const [inserted] = await tx
        .insert(blueprints)
        .values({ startupId, sessionId, assessmentId })
        .returning({ id: blueprints.id })
      blueprintId = inserted.id
    }

    // 3. Derive next version number from MAX within this blueprint parent.
    const [maxRow] = await tx
      .select({ maxVer: max(blueprintVersions.versionNumber) })
      .from(blueprintVersions)
      .where(eq(blueprintVersions.blueprintId, blueprintId))

    const nextVersion = (maxRow.maxVer ?? 0) + 1

    // 4. Demote all prior versions before inserting the new current one.
    await tx
      .update(blueprintVersions)
      .set({ isCurrent: false })
      .where(eq(blueprintVersions.blueprintId, blueprintId))

    // 5. Insert the new version as current.
    const [version] = await tx
      .insert(blueprintVersions)
      .values({
        blueprintId,
        versionNumber:   nextVersion,
        content:         validatedContent,
        isCurrent:       true,
        generationJobId: jobId,
      })
      .returning({ id: blueprintVersions.id })

    return {
      blueprintId,
      versionId:     version.id,
      versionNumber: nextVersion,
    }
  })

  // ── Activity log (best-effort, outside transaction) ───────────────────────
  await logActivity(db, {
    userId,
    startupId,
    type:        'blueprint_generated',
    description: `Blueprint version ${result.versionNumber} generated`,
    meta: {
      blueprintId:     result.blueprintId,
      versionId:       result.versionId,
      versionNumber:   result.versionNumber,
      jobId,
      gapsInBlueprint,
      blueprintMode,
      founderStage,
    },
  }).catch(() => {})

  return result
}
