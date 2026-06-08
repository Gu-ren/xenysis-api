import { eq } from 'drizzle-orm'
import type { DB as DrizzleDB } from '../lib/db/index.ts'
import { evidenceRecords, founderUnderstanding } from '../lib/db/schema/understanding.ts'
import type { FounderMemory } from '../lib/contracts/founder-memory.ts'
import {
  type FounderUnderstanding,
  type UnderstandingCategory,
  type EvidenceStrength,
  type ValidationStatus,
  type AbsenceSignalStrength,
  UNDERSTANDING_CATEGORIES,
  buildUnderstanding,
  EMPTY_UNDERSTANDING,
  FounderUnderstandingSchema,
} from '../lib/contracts/founder-understanding.ts'

// Per-turn novelty classification for each category.
//   new:              New evidence items were extracted this turn.
//   absent_confirmed: Founder expressed absence of evidence (any signal level).
//   repetitive:       Category was the focus last turn but no new evidence and no absence signal.
export type NoveltySignal = 'new' | 'absent_confirmed' | 'repetitive'

// ── Public interface ──────────────────────────────────────────────────────────

export interface UpdateUnderstandingParams {
  db:              DrizzleDB
  sessionId:       string
  startupId:       string
  userId:          string
  memory:          FounderMemory
  sourceMessageId?: string
}

export interface UpdateUnderstandingResult {
  understanding:         FounderUnderstanding
  isComplete:            boolean
  overallConfidence:     number
  weakestCategory:       UnderstandingCategory | null
  newEvidenceByCategory: Partial<Record<UnderstandingCategory, string[]>>
  noveltyByCategory:     Partial<Record<UnderstandingCategory, NoveltySignal>>
  validationGaps:        UnderstandingCategory[]
  questioningMode:       FounderUnderstanding['questioningMode']
}

// ── Core engine ───────────────────────────────────────────────────────────────
// Called in the post-stream side-effects block after each AI exchange.
// Reads category_confidence, category_evidence, and category_evidence_strength
// from the merged FounderMemory, upserts founder_understanding, inserts new
// evidence_records, and returns the current understanding state.
export async function updateUnderstanding(
  params: UpdateUnderstandingParams,
): Promise<UpdateUnderstandingResult> {
  const { db, sessionId, startupId, userId, memory, sourceMessageId } = params

  // Load existing row to access accumulated evidence (never lost across turns).
  const existingRow = await db.query.founderUnderstanding.findFirst({
    where: eq(founderUnderstanding.sessionId, sessionId),
  })

  const existingUnderstanding = existingRow
    ? (FounderUnderstandingSchema.safeParse(existingRow.understanding).data ?? EMPTY_UNDERSTANDING)
    : EMPTY_UNDERSTANDING

  // Accumulated evidence persists across turns regardless of confidence direction.
  const existingEvidence = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [
      cat,
      existingUnderstanding.categories[cat].evidence,
    ]),
  ) as Record<UnderstandingCategory, string[]>

  // Revision 3: pass evidence strength from the merged memory into buildUnderstanding.
  const categoryStrength = memory.category_evidence_strength as Record<UnderstandingCategory, EvidenceStrength>

  // Extract per-category validation state from existing understanding for handoff to buildUnderstanding.
  const existingValidationStatus = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [
      cat,
      (existingUnderstanding.categories[cat].validationStatus ?? 'unknown') as ValidationStatus,
    ]),
  ) as Record<UnderstandingCategory, ValidationStatus>

  const existingWeakAbsenceCounts = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [cat, existingUnderstanding.categories[cat].weakAbsenceCount ?? 0]),
  ) as Record<UnderstandingCategory, number>

  const existingSaturationCounts = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [cat, existingUnderstanding.categories[cat].saturationCount ?? 0]),
  ) as Record<UnderstandingCategory, number>

  const existingLastFocusConfidence = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [cat, existingUnderstanding.categories[cat].lastFocusConfidence ?? 0]),
  ) as Record<UnderstandingCategory, number>

  // Absence signals from the current turn's extraction (replace-with-latest in merged memory).
  const absenceSignals = (memory.category_absence_signals ?? {}) as Record<UnderstandingCategory, AbsenceSignalStrength>

  // Focus cooling: build history by prepending the previous weakestCategory.
  // This tells detectWeakestCategory which categories were recently targeted so it
  // can apply cooling penalties and force rotation to the next highest-priority gap.
  const existingFocusHistory = existingUnderstanding.focusHistory ?? []
  const focusHistory: string[] = existingUnderstanding.weakestCategory
    ? [existingUnderstanding.weakestCategory, ...existingFocusHistory].slice(0, 5)
    : existingFocusHistory

  const understanding = buildUnderstanding({
    categoryConfidence:          memory.category_confidence,
    categoryEvidence:            memory.category_evidence,
    categoryStrength,
    existingEvidence,
    focusHistory,
    absenceSignals,
    existingValidationStatus,
    existingWeakAbsenceCounts,
    existingSaturationCounts,
    existingLastFocusConfidence,
  })

  // Determine evidence items that are new this turn.
  const newEvidenceByCategory: Partial<Record<UnderstandingCategory, string[]>> = {}
  for (const cat of UNDERSTANDING_CATEGORIES) {
    const alreadyPersisted = new Set(existingEvidence[cat])
    const incoming         = memory.category_evidence[cat] ?? []
    const newItems         = incoming.filter((item) => !alreadyPersisted.has(item))
    if (newItems.length > 0) newEvidenceByCategory[cat] = newItems
  }

  // Compute overall evidence strength: maximum across all categories.
  const overallEvidenceStrength = Math.max(
    ...UNDERSTANDING_CATEGORIES.map((cat) => categoryStrength[cat] ?? 1),
  ) as EvidenceStrength

  // Upsert founder_understanding.
  const upsertPayload = {
    sessionId,
    startupId,
    userId,
    problemConfidence:      understanding.categories.problem.confidence,
    customerConfidence:     understanding.categories.customer.confidence,
    solutionConfidence:     understanding.categories.solution.confidence,
    marketConfidence:       understanding.categories.market.confidence,
    pricingConfidence:      understanding.categories.pricing.confidence,
    competitionConfidence:  understanding.categories.competition.confidence,
    risksConfidence:        understanding.categories.risks.confidence,
    founderFitConfidence:   understanding.categories.founder_fit.confidence,    // Revision 2
    overallConfidence:      understanding.overallConfidence,
    overallEvidenceStrength,                                                    // Revision 3
    isComplete:             understanding.isComplete,
    weakestCategory:        understanding.weakestCategory,
    understanding,
    updatedAt:              new Date(),
  }

  if (existingRow) {
    await db
      .update(founderUnderstanding)
      .set(upsertPayload)
      .where(eq(founderUnderstanding.sessionId, sessionId))
  } else {
    await db.insert(founderUnderstanding).values(upsertPayload)
  }

  // Compute evidence novelty classification per category for the audit trail and return value.
  const noveltyByCategory: Partial<Record<UnderstandingCategory, NoveltySignal>> = {}
  const lastFocusCat = focusHistory[0] as UnderstandingCategory | undefined

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const hasNewEvidence  = (newEvidenceByCategory[cat]?.length ?? 0) > 0
    const absenceSignal   = absenceSignals[cat] ?? 'none'
    const wasLastFocus    = lastFocusCat === cat

    if (hasNewEvidence) {
      noveltyByCategory[cat] = 'new'
    } else if (absenceSignal !== 'none') {
      noveltyByCategory[cat] = 'absent_confirmed'
    } else if (wasLastFocus) {
      noveltyByCategory[cat] = 'repetitive'
    }
  }

  // Insert new evidence_records (append-only audit trail).
  const evidenceInserts: Array<{
    sessionId:        string
    startupId:        string
    userId:           string
    category:         string
    evidence:         string
    evidenceStrength: number
    sourceMessageId?: string
    confidenceImpact: number
    noveltySignal:    string
  }> = []

  for (const [cat, items] of Object.entries(newEvidenceByCategory) as [UnderstandingCategory, string[]][]) {
    // Revision 1: confidence may have decreased this turn, so delta can be negative.
    // confidenceImpact records the actual signed change per item for auditability.
    const oldConfidence = existingUnderstanding.categories[cat].confidence
    const newConfidence = understanding.categories[cat].confidence
    const delta         = newConfidence - oldConfidence
    const impact        = items.length > 0 ? Math.round(delta / items.length) : 0

    for (const item of items) {
      evidenceInserts.push({
        sessionId,
        startupId,
        userId,
        category:         cat,
        evidence:         item,
        evidenceStrength: categoryStrength[cat] ?? 1,
        sourceMessageId,
        confidenceImpact: impact,
        noveltySignal:    noveltyByCategory[cat] ?? 'new',
      })
    }
  }

  if (evidenceInserts.length > 0) {
    await db.insert(evidenceRecords).values(evidenceInserts)
  }

  return {
    understanding,
    isComplete:            understanding.isComplete,
    overallConfidence:     understanding.overallConfidence,
    weakestCategory:       understanding.weakestCategory,
    newEvidenceByCategory,
    noveltyByCategory,
    validationGaps:        understanding.validationGaps,
    questioningMode:       understanding.questioningMode,
  }
}

// ── Read helper ───────────────────────────────────────────────────────────────

export async function loadUnderstanding(
  db: DrizzleDB,
  sessionId: string,
): Promise<FounderUnderstanding> {
  const row = await db.query.founderUnderstanding.findFirst({
    where: eq(founderUnderstanding.sessionId, sessionId),
  })

  if (!row) return EMPTY_UNDERSTANDING

  return FounderUnderstandingSchema.safeParse(row.understanding).data ?? EMPTY_UNDERSTANDING
}
