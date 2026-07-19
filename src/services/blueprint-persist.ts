import { eq, max } from 'drizzle-orm'
import type { DB } from '../lib/db/index.ts'
import { blueprints, blueprintVersions } from '../lib/db/schema/artifacts.ts'
import type { BlueprintContent, BlueprintSaveSource } from '../lib/contracts/blueprint.ts'

export interface PersistBlueprintResult {
  blueprintId: string
  versionId: string
  versionNumber: number
  content: BlueprintContent
}

/** Bump blueprint_versions and mark the new row as current. */
export async function persistBlueprintVersion(
  db: DB,
  startupId: string,
  content: BlueprintContent,
  source: BlueprintSaveSource,
  note?: string | null,
  expectedVersionNumber?: number,
): Promise<PersistBlueprintResult> {
  const blueprint = await db.query.blueprints.findFirst({
    where: eq(blueprints.startupId, startupId),
    columns: { id: true },
  })
  if (!blueprint) {
    throw new Error('No blueprint found for this startup')
  }

  const [maxRow] = await db
    .select({ maxVer: max(blueprintVersions.versionNumber) })
    .from(blueprintVersions)
    .where(eq(blueprintVersions.blueprintId, blueprint.id))

  const currentMax = maxRow.maxVer ?? 0

  if (expectedVersionNumber !== undefined && expectedVersionNumber !== currentMax) {
    const err = new Error('VERSION_CONFLICT') as Error & { code: string; currentVersion: number }
    err.code = 'VERSION_CONFLICT'
    err.currentVersion = currentMax
    throw err
  }

  const nextVersion = currentMax + 1

  await db
    .update(blueprintVersions)
    .set({ isCurrent: false })
    .where(eq(blueprintVersions.blueprintId, blueprint.id))

  const [row] = await db
    .insert(blueprintVersions)
    .values({
      blueprintId:   blueprint.id,
      versionNumber: nextVersion,
      content,
      isCurrent:     true,
      source,
      note:          note ?? null,
    })
    .returning({ id: blueprintVersions.id, versionNumber: blueprintVersions.versionNumber })

  return {
    blueprintId:   blueprint.id,
    versionId:     row.id,
    versionNumber: row.versionNumber,
    content,
  }
}
