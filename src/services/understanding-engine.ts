import { eq } from 'drizzle-orm'
import type { DB as DrizzleDB } from '../lib/db/index.ts'
import { evidenceRecords, founderUnderstanding } from '../lib/db/schema/understanding.ts'
import type { FounderMemory } from '../lib/contracts/founder-memory.ts'
import { logActivity } from '../agents/base/utils.ts'
import {
  type FounderUnderstanding,
  type UnderstandingCategory,
  type EvidenceStrength,
  type ValidationStatus,
  type AbsenceSignalStrength,
  type FounderStage,
  UNDERSTANDING_CATEGORIES,
  SATURATION_THRESHOLD,
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
  founderStage?:   FounderStage
  // v2.2: used by the minimum-exchange gate to suppress completion until the session
  // has enough depth. The router passes (session.messagesCount + 1) as the post-increment count.
  messagesCount?:  number
  // v2.2 PR2: seed from the session-init heuristic; OR'd with existing understanding for stickiness.
  marketplaceDetected?: boolean
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
  const { db, sessionId, startupId, userId, memory, sourceMessageId, founderStage = 'building', messagesCount = 0, marketplaceDetected: seedMarketplaceDetected = false } = params

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

  const existingValidationPlanningCompleted = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [cat, existingUnderstanding.categories[cat].validationPlanningCompleted ?? false]),
  ) as Record<UnderstandingCategory, boolean>

  // Absence signals from the current turn's extraction (replace-with-latest in merged memory).
  const absenceSignals = (memory.category_absence_signals ?? {}) as Record<UnderstandingCategory, AbsenceSignalStrength>

  // v2.2 PR3: external-contact one-way latch. Existing values come from stored understanding;
  // this-turn values come from the current merged memory extraction.
  const existingHasExternalContact = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => [cat, existingUnderstanding.categories[cat].hasExternalContact ?? false]),
  ) as Record<UnderstandingCategory, boolean>
  const hasExternalContactThisTurn = (memory.category_has_external_contact ?? {}) as Record<UnderstandingCategory, boolean>

  // Focus cooling: build history by prepending the previous weakestCategory.
  // This tells detectWeakestCategory which categories were recently targeted so it
  // can apply cooling penalties and force rotation to the next highest-priority gap.
  const existingFocusHistory = existingUnderstanding.focusHistory ?? []
  const focusHistory: string[] = existingUnderstanding.weakestCategory
    ? [existingUnderstanding.weakestCategory, ...existingFocusHistory].slice(0, 5)
    : existingFocusHistory

  // Compute overall evidence strength before buildUnderstanding so it can inform the threshold.
  const overallEvidenceStrength = Math.max(
    ...UNDERSTANDING_CATEGORIES.map((cat) => categoryStrength[cat] ?? 1),
  ) as EvidenceStrength

  // v2.1 F3: multiIcpDetected is sticky — once true it stays true across turns.
  const multiIcpDetected = existingUnderstanding.multiIcpDetected || (memory.multi_icp_detected ?? false)

  // v2.2 PR2: marketplaceDetected is sticky — once true it stays true across turns.
  // Seeded at session creation by the heuristic; confirmed/corrected by LLM extraction each turn.
  const marketplaceDetected = existingUnderstanding.marketplaceDetected || seedMarketplaceDetected || (memory.marketplace_detected ?? false)

  // v2.1 F4: pivot_detected is per-turn (replace-with-latest from memory).
  const pivotDetected    = memory.pivot_detected ?? false
  const existingPivotCount = existingUnderstanding.pivotCount ?? 0

  let understanding = buildUnderstanding({
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
    existingValidationPlanningCompleted,
    founderStage,
    maxEvidenceStrength: overallEvidenceStrength,
    multiIcpDetected,
    marketplaceDetected,
    pivotDetected,
    existingPivotCount,
    existingHasExternalContact,
    hasExternalContactThisTurn,
  })

  // [TEMP DEBUG] supply_side state after buildUnderstanding
  const _ss = understanding.categories.supply_side
  console.log('[DEBUG buildUnderstanding] supply_side:', {
    confidence:                  _ss.confidence,
    validationStatus:            _ss.validationStatus,
    saturationCount:             _ss.saturationCount,
    validationPlanningCompleted: _ss.validationPlanningCompleted,
    lastFocusConfidence:         _ss.lastFocusConfidence,
  })
  console.log('[DEBUG buildUnderstanding] weakestCategory:', understanding.weakestCategory)
  // validationPlanningCandidate is computed inside buildChatSystemPrompt — derive it here for debug visibility
  const _vpCandidate = UNDERSTANDING_CATEGORIES.find((cat) => {
    if (cat === 'supply_side' && !understanding.marketplaceDetected) return false
    const s = understanding.categories[cat]
    return s.validationStatus === 'explicitly_unvalidated' && s.saturationCount >= 1 && !s.validationPlanningCompleted
  }) ?? null
  console.log('[DEBUG buildUnderstanding] validationPlanningCandidate:', _vpCandidate)

  // v2.2: Minimum-exchange gate — prevent completion on narrative coherence alone.
  // Stage-specific thresholds: revenue founders have paying-customer data and can
  // establish quality evidence faster; idea/building founders need more exploration depth.
  // These defaults are tunable via environment variables without redeployment.
  const MIN_EXCHANGES: Record<FounderStage, number> = {
    idea:     Number(process.env.MIN_EXCHANGES_BEFORE_COMPLETION_IDEA     ?? 6),
    building: Number(process.env.MIN_EXCHANGES_BEFORE_COMPLETION_BUILDING ?? 8),
    revenue:  Number(process.env.MIN_EXCHANGES_BEFORE_COMPLETION_REVENUE  ?? 6),
  }
  if (understanding.isComplete && messagesCount < MIN_EXCHANGES[founderStage]) {
    // Suppress completion: clear all completion-specific fields so the front-end
    // does not transition to the complete state prematurely. Confidence scores,
    // evidence, and saturation state are preserved — only the completion signal
    // is held back until the exchange floor is met.
    understanding = {
      ...understanding,
      isComplete:       false,
      warnings:         [],
      gapsInBlueprint:  [],
      completionReason: undefined,
    }
  }

  // Beta early-exit eligibility — secondary path that surfaces a founder-facing choice when
  // Xenysis has foundational understanding but the session has not yet naturally completed.
  // Criteria: required categories at partial confidence + overall floor + exchange minimum.
  const earlyExitEligible = (
    !understanding.isComplete &&
    understanding.categories.problem.confidence  >= 50 &&
    understanding.categories.customer.confidence >= 50 &&
    understanding.categories.solution.confidence >= 50 &&
    understanding.overallConfidence >= 70 &&
    messagesCount >= MIN_EXCHANGES[founderStage]
  )
  understanding = { ...understanding, earlyExitEligible }

  // Determine evidence items that are new this turn.
  const newEvidenceByCategory: Partial<Record<UnderstandingCategory, string[]>> = {}
  for (const cat of UNDERSTANDING_CATEGORIES) {
    const alreadyPersisted = new Set(existingEvidence[cat])
    const incoming         = memory.category_evidence[cat] ?? []
    const newItems         = incoming.filter((item) => !alreadyPersisted.has(item))
    if (newItems.length > 0) newEvidenceByCategory[cat] = newItems
  }

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
    supplySideConfidence:   understanding.categories.supply_side.confidence,    // v2.2 PR3
    overallConfidence:      understanding.overallConfidence,
    overallEvidenceStrength,                                                    // Revision 3
    isComplete:             understanding.isComplete,
    weakestCategory:        understanding.weakestCategory,
    marketplaceDetected:    understanding.marketplaceDetected,
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

  // v2.1 instrumentation — transition-guarded, fire-and-forget.
  const prevIsComplete      = existingUnderstanding.isComplete
  const prevQuestioningMode = existingUnderstanding.questioningMode

  const instrumentationEvents: Promise<void>[] = []

  if (!prevIsComplete && understanding.isComplete) {
    instrumentationEvents.push(logActivity(db, {
      userId, startupId,
      type:        'understanding.completion_threshold_reached',
      description: `Session understanding complete for session ${sessionId}`,
      meta:        { sessionId, founderStage, blueprintMode: understanding.blueprintMode, overallConfidence: understanding.overallConfidence },
    }))
  }

  if (prevQuestioningMode !== 'gap_identification' && understanding.questioningMode === 'gap_identification') {
    instrumentationEvents.push(logActivity(db, {
      userId, startupId,
      type:        'understanding.gap_identification_entered',
      description: `Questioning mode shifted to gap_identification for session ${sessionId}`,
      meta:        { sessionId },
    }))
  }

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const prevSat = existingUnderstanding.categories[cat].saturationCount ?? 0
    const newSat  = understanding.categories[cat].saturationCount
    if (prevSat < SATURATION_THRESHOLD && newSat >= SATURATION_THRESHOLD) {
      instrumentationEvents.push(logActivity(db, {
        userId, startupId,
        type:        'understanding.category_saturated',
        description: `Category ${cat} reached saturation for session ${sessionId}`,
        meta:        { sessionId, category: cat, confidence: understanding.categories[cat].confidence },
      }))
    }

    const prevStatus = existingUnderstanding.categories[cat].validationStatus
    const newStatus  = understanding.categories[cat].validationStatus
    if (prevStatus !== 'explicitly_unvalidated' && newStatus === 'explicitly_unvalidated') {
      instrumentationEvents.push(logActivity(db, {
        userId, startupId,
        type:        'understanding.gap_confirmed',
        description: `Validation gap confirmed for category ${cat} in session ${sessionId}`,
        meta:        { sessionId, category: cat },
      }))
    }
  }

  // v2.1 F3: fires once when multiIcpDetected transitions false → true.
  if (!existingUnderstanding.multiIcpDetected && understanding.multiIcpDetected) {
    instrumentationEvents.push(logActivity(db, {
      userId, startupId,
      type:        'understanding.multi_icp_detected',
      description: `Multi-ICP / marketplace detected for session ${sessionId}`,
      meta:        { sessionId },
    }))
  }

  // v2.2 PR2: fires once when marketplaceDetected transitions false → true.
  if (!existingUnderstanding.marketplaceDetected && understanding.marketplaceDetected) {
    instrumentationEvents.push(logActivity(db, {
      userId, startupId,
      type:        'understanding.marketplace_detected',
      description: `Marketplace platform detected for session ${sessionId}`,
      meta:        { sessionId },
    }))
  }

  // v2.1 F4: fires every turn where pivotDetected = true.
  if (understanding.pivotDetected) {
    instrumentationEvents.push(logActivity(db, {
      userId, startupId,
      type:        'understanding.pivot_detected',
      description: `Pivot detected in session ${sessionId}`,
      meta:        { sessionId, pivotCount: understanding.pivotCount },
    }))
  }

  await Promise.allSettled(instrumentationEvents)

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
