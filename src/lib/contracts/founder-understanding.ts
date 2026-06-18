import { z } from 'zod'

export const UNDERSTANDING_SCHEMA_VERSION = '1.1' as const

// ── Validation status ─────────────────────────────────────────────────────────
// Controls questioning behavior per category — three paths:
//   unknown:                Category not yet discussed or no absence signal.
//   explicitly_unvalidated: Founder confirmed no external evidence exists.
//                           Engine stops asking for validation; may still ask understanding questions.
//   validated:              External signal exists (evidenceStrength >= 3).
export const ValidationStatusSchema = z.enum(['unknown', 'validated', 'explicitly_unvalidated'])
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>

// ── Absence signal strength ───────────────────────────────────────────────────
// Per-turn signal extracted from the founder's words — not accumulated.
//   none:   No absence stated; category not discussed or positive info provided.
//   weak:   Hedged or partial absence ("not yet", "haven't formally", "only informally").
//   strong: Unambiguous, unhedged total absence ("I have not spoken to any customers.").
export const AbsenceSignalSchema = z.enum(['none', 'weak', 'strong'])
export type AbsenceSignalStrength = z.infer<typeof AbsenceSignalSchema>

// ── Assessment tier ───────────────────────────────────────────────────────────
// Derived at read-time for the Opportunity Assessment layer — NOT persisted as stored state.
// Computed by deriveAssessmentTier() from validationStatus + confidence + evidenceStrength.
//   unknown:          Category not yet discussed.
//   gap:              Explicitly unvalidated with low confidence (no hypothesis formed).
//   assumption_based: Explicitly unvalidated but founder has a detailed theory (confidence >= 40).
//   validated:        External evidence exists (evidenceStrength >= 3).
export const AssessmentTierSchema = z.enum(['unknown', 'gap', 'assumption_based', 'validated'])
export type AssessmentTier = z.infer<typeof AssessmentTierSchema>

// ── Questioning mode ──────────────────────────────────────────────────────────
//   discovery:         Default. Learning what the founder knows and believes.
//   gap_identification: All categories are either understood, validated, or confirmed gaps.
//                       Agent pivots to naming assumptions and suggesting next tests.
export const QuestioningModeSchema = z.enum(['discovery', 'gap_identification'])
export type QuestioningMode = z.infer<typeof QuestioningModeSchema>

// Saturation: a category targeted this many turns with delta < SATURATION_DELTA_THRESHOLD
// is treated as exhausted — blocked from further questioning regardless of focus-cooling state.
export const SATURATION_THRESHOLD      = 3
export const SATURATION_DELTA_THRESHOLD = 5   // minimum confidence change to reset saturation counter

// ── Category definition ───────────────────────────────────────────────────────

export const UNDERSTANDING_CATEGORIES = [
  'problem',
  'customer',
  'solution',
  'market',
  'pricing',
  'competition',
  'risks',
  'founder_fit',      // Revision 2: domain expertise, customer access, execution capability
  'supply_side',      // v2.2 PR3: only active for marketplace sessions (marketplaceDetected=true)
] as const

export type UnderstandingCategory = (typeof UNDERSTANDING_CATEGORIES)[number]

// Revision 4: required categories must reach THRESHOLD_COMPLETE before session can complete.
// Supporting categories generate warnings when weak but do not block completion.
export const REQUIRED_CATEGORIES: readonly UnderstandingCategory[] = [
  'problem',
  'customer',
  'solution',
] as const

export const SUPPORTING_CATEGORIES: readonly UnderstandingCategory[] = [
  'market',
  'pricing',
  'competition',
  'risks',
  'founder_fit',
  'supply_side',      // v2.2 PR3: promoted to effective-required when marketplaceDetected=true
] as const

// Business importance weights for priority formula: (100 - confidence) × importance.
export const CATEGORY_IMPORTANCE: Record<UnderstandingCategory, number> = {
  problem:      10,
  customer:     10,
  competition:  10,
  market:        9,
  solution:      9,
  supply_side:   9,   // v2.2 PR3: only included in weight sum for marketplace sessions
  pricing:       8,
  risks:         8,
  founder_fit:   8,   // Revision 2
}

// Total weight without supply_side (non-marketplace sessions): 72.
// Total weight with supply_side (marketplace sessions): 81.
// computeOverallConfidence selects the appropriate denominator based on marketplaceDetected.
export const TOTAL_WEIGHT_BASE        = 72  // 8 categories, excluding supply_side
export const TOTAL_WEIGHT_MARKETPLACE = 81  // 9 categories, including supply_side

// Confidence thresholds for status derivation.
const THRESHOLD_PARTIAL = 30    // below this → missing

// Warning threshold for supporting categories in the Founder Report.
export const SUPPORTING_WARNING_THRESHOLD = 60

// Revision 4: overall threshold relaxed from 80 → 75.
export const COMPLETION_OVERALL_THRESHOLD = 75

// ── Founder stage ─────────────────────────────────────────────────────────────
// Declared at session creation, immutable for the session lifetime.
//   idea:     Pre-validation — founder has an idea but has not spoken to customers.
//   building: Active development — some validation underway.
//   revenue:  Revenue-stage — paying customers exist.
export const FounderStageSchema = z.enum(['idea', 'building', 'revenue'])
export type FounderStage = z.infer<typeof FounderStageSchema>

// ── Blueprint mode ────────────────────────────────────────────────────────────
// Determined at session completion.
//   hypothesis: Session completed via the idea-stage lower threshold (THRESHOLD_HYPOTHESIS).
//               Blueprint is a thinking tool — not a validated spec.
//   validated:  All required categories naturally reached THRESHOLD_COMPLETE (80%).
export const BlueprintModeSchema = z.enum(['hypothesis', 'validated'])
export type BlueprintMode = z.infer<typeof BlueprintModeSchema>

// Completion thresholds.
export const THRESHOLD_COMPLETE   = 80   // building / revenue stage (and evidence floor)
export const THRESHOLD_HYPOTHESIS = 60   // idea stage only

// Per-strength confidence ceilings applied only inside checkCompletion.
// They are not stored, not shown in the UI, and do not affect the OA layer.
// The design intent: a founder with strength-1 (pure assumption) cannot cross either
// threshold regardless of how coherent their narrative is. A founder with strength-3
// (customer conversations) can just reach the building-stage threshold of 80.
//
//   strength 1 → ceiling 50  (below 60 and 80 — assumption-only sessions never complete)
//   strength 2 → ceiling 65  (above 60, below 80 — anecdotal can close idea-stage only)
//   strength 3 → ceiling 83  (above 80 — conversations can close building-stage)
//   strength 4 → ceiling 92
//   strength 5 → ceiling 97
//   strength 6 → ceiling 100
export const COMPLETION_EVIDENCE_CEILINGS: Record<EvidenceStrength, number> = {
  1: 50,
  2: 65,
  3: 83,
  4: 92,
  5: 97,
  6: 100,
}

// ── Evidence strength ─────────────────────────────────────────────────────────
// Revision 3: tracks the quality of evidence behind a confidence score.
// A confidence of 90 backed by paying customers (5) is very different from
// a confidence of 90 backed only by founder assumptions (1).

export const EVIDENCE_STRENGTH_LEVELS = {
  1: 'Founder assumption',
  2: 'Anecdotal observation',
  3: 'Customer conversations',
  4: 'Customer interviews',
  5: 'Paying customers',
  6: 'Usage or revenue data',
} as const

export type EvidenceStrength = 1 | 2 | 3 | 4 | 5 | 6

export const EvidenceStrengthSchema = z.number().int().min(1).max(6) as z.ZodType<EvidenceStrength>

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const CategoryStatusSchema = z.enum(['missing', 'partial', 'complete'])
export type CategoryStatus = z.infer<typeof CategoryStatusSchema>

export const CategoryStateSchema = z.object({
  confidence:      z.number().int().min(0).max(100),
  status:          CategoryStatusSchema,
  evidenceCount:   z.number().int().min(0),
  evidence:        z.array(z.string().max(200)).max(5),
  // Revision 3: quality of evidence behind the confidence score (1-6 scale).
  evidenceStrength: EvidenceStrengthSchema.default(1),

  // Validation gap fields (this revision):
  validationStatus:    ValidationStatusSchema.default('unknown'),
  weakAbsenceCount:    z.number().int().min(0).default(0),  // turns with 'weak' absence signal
  saturationCount:     z.number().int().min(0).default(0),  // turns focused with delta < SATURATION_DELTA_THRESHOLD
  lastFocusConfidence: z.number().int().min(0).max(100).default(0),  // confidence when last targeted

  // Assessment tier — computed by buildUnderstanding(), stored for consumers (not extracted).
  assessmentTier: AssessmentTierSchema.default('unknown'),
})
export type CategoryState = z.infer<typeof CategoryStateSchema>

// Warning attached to a weak supporting category on a complete session.
export const CategoryWarningSchema = z.object({
  category:        z.enum(['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit', 'supply_side']),
  confidence:      z.number().int().min(0).max(100),
  evidenceStrength: EvidenceStrengthSchema,
  message:         z.string(),
})
export type CategoryWarning = z.infer<typeof CategoryWarningSchema>

export const FounderUnderstandingSchema = z.object({
  _schemaVersion: z.literal('1.1').default('1.1'),

  categories: z.object({
    problem:      CategoryStateSchema,
    customer:     CategoryStateSchema,
    solution:     CategoryStateSchema,
    market:       CategoryStateSchema,
    pricing:      CategoryStateSchema,
    competition:  CategoryStateSchema,
    risks:        CategoryStateSchema,
    founder_fit:  CategoryStateSchema,   // Revision 2
    supply_side:  CategoryStateSchema,   // v2.2 PR3: active for marketplace sessions only
  }),

  overallConfidence: z.number().int().min(0).max(100),
  isComplete:        z.boolean(),

  // The category with the highest gap priority. Null only before first exchange.
  weakestCategory: z.enum([
    'problem', 'customer', 'solution', 'market', 'pricing',
    'competition', 'risks', 'founder_fit', 'supply_side',
  ]).nullable(),

  // Revision 4: warnings for weak supporting categories on a complete session.
  // These surface in the Founder Report ("Competition confidence is low (42%)").
  warnings: z.array(CategoryWarningSchema).default([]),

  // Human-readable reason shown when isComplete = true.
  completionReason: z.string().optional(),

  // Focus cooling: ordered list of the last 5 weakestCategory values (most recent first).
  // Used to penalise recently-targeted categories so the engine rotates naturally.
  // Stored in JSONB — no migration required.
  focusHistory: z.array(z.string()).max(5).default([]),

  // Categories the founder has explicitly confirmed have no external evidence yet.
  // Derived from per-category validationStatus === 'explicitly_unvalidated'.
  validationGaps: z.array(
    z.enum(['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit', 'supply_side']),
  ).default([]),

  // Session-level questioning orientation — shifts to gap_identification when all categories
  // are either well-understood, validated, explicitly_unvalidated, or saturated.
  questioningMode: QuestioningModeSchema.default('discovery'),

  // v2.1 fields — F1+F2.
  founderStage:     FounderStageSchema.default('building'),
  blueprintMode:    BlueprintModeSchema.default('validated'),
  gapsInBlueprint:  z.array(
    z.enum(['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit', 'supply_side']),
  ).default([]),

  // v2.1 F3: sticky — once true, stays true for the session lifetime.
  // Suppresses customer from the blocked-topics list and changes the focus instruction.
  multiIcpDetected: z.boolean().default(false),

  // v2.2 PR2: sticky marketplace detection — separate from multiIcpDetected.
  // True for genuine two-sided platforms where supply-side participants create value
  // and demand-side participants consume it (Airbnb, Uber, Etsy patterns).
  // Gates supply_side discovery in PR3. Set by session-init heuristic OR LLM extraction.
  // Once true, never reverts for the session lifetime.
  marketplaceDetected: z.boolean().default(false),

  // v2.1 F4: per-turn — true only on the turn a pivot is detected.
  // Does NOT bypass confidence merge (v2.2). Used for chat acknowledgment + analytics.
  pivotDetected: z.boolean().default(false),

  // v2.1 F4: lifetime accumulator — increments each turn pivotDetected = true.
  pivotCount: z.number().int().min(0).default(0),
})
export type FounderUnderstanding = z.infer<typeof FounderUnderstandingSchema>

// ── Pure computation ──────────────────────────────────────────────────────────

// v2.2 PR3: supply_side is required for marketplace sessions, invisible for all others.
// This is the single source of truth for which categories block completion.
export function getEffectiveRequiredCategories(
  marketplaceDetected: boolean,
): readonly UnderstandingCategory[] {
  return marketplaceDetected
    ? [...REQUIRED_CATEGORIES, 'supply_side' as UnderstandingCategory]
    : REQUIRED_CATEGORIES
}

export function confidenceToStatus(confidence: number): CategoryStatus {
  if (confidence >= THRESHOLD_COMPLETE) return 'complete'
  if (confidence >= THRESHOLD_PARTIAL)  return 'partial'
  return 'missing'
}

// Weighted average using CATEGORY_IMPORTANCE.
// supply_side is excluded for non-marketplace sessions (keeping the denominator at 72)
// so a 0 supply_side score does not drag down the displayed confidence for founders
// who are not building a marketplace.
export function computeOverallConfidence(
  categoryConfidence: Record<UnderstandingCategory, number>,
  marketplaceDetected: boolean = false,
): number {
  const cats        = marketplaceDetected
    ? UNDERSTANDING_CATEGORIES
    : UNDERSTANDING_CATEGORIES.filter((c) => c !== 'supply_side')
  const totalWeight = marketplaceDetected ? TOTAL_WEIGHT_MARKETPLACE : TOTAL_WEIGHT_BASE
  const weightedSum = cats.reduce((sum, cat) => {
    return sum + (categoryConfidence[cat] ?? 0) * CATEGORY_IMPORTANCE[cat]
  }, 0)
  return Math.round(weightedSum / totalWeight)
}

// Priority formula: (100 - confidence) × importance.
export function computeCategoryPriority(
  category: UnderstandingCategory,
  confidence: number,
): number {
  return (100 - confidence) * CATEGORY_IMPORTANCE[category]
}

// Focus cooling multipliers — applied when a category has been the recent focus.
// Penalises fixation without fully suppressing a genuinely weak category.
const COOLING_MULTIPLIERS: Record<number, number> = {
  1: 0.60,   // targeted once in last 5 turns → 40% penalty
  2: 0.35,   // twice → 65% penalty
  3: 0.15,   // three or more → 85% penalty (strong redirect)
}

export function detectWeakestCategory(
  categoryConfidence: Record<UnderstandingCategory, number>,
  focusHistory: string[] = [],
  saturationCounts: Partial<Record<UnderstandingCategory, number>> = {},
  multiIcpDetected: boolean = false,
  // v2.2 PR3: supply_side is invisible to non-marketplace sessions — never selected as focus.
  marketplaceDetected: boolean = false,
): UnderstandingCategory {
  let maxPriority = -1
  let weakest: UnderstandingCategory = 'competition'

  for (const cat of UNDERSTANDING_CATEGORIES) {
    // supply_side is invisible to non-marketplace sessions.
    if (cat === 'supply_side' && !marketplaceDetected) continue

    const basePriority = computeCategoryPriority(cat, categoryConfidence[cat] ?? 0)
    const recentCount  = Math.min(focusHistory.filter((h) => h === cat).length, 3)
    const coolMult     = COOLING_MULTIPLIERS[recentCount] ?? 1.0
    // Saturated categories get a near-zero multiplier — they are exhausted and should not
    // be selected again until a new evidence breakthrough resets the saturation counter.
    // Exception: customer saturation is suppressed when multiIcpDetected — marketplace
    // founders legitimately need continued customer exploration across both ICP segments.
    const isSaturated  = (saturationCounts[cat] ?? 0) >= SATURATION_THRESHOLD
    const satMult      = (isSaturated && !(cat === 'customer' && multiIcpDetected)) ? 0.02 : 1.0
    const effectivePriority = basePriority * coolMult * satMult

    if (effectivePriority > maxPriority) {
      maxPriority = effectivePriority
      weakest = cat
    }
  }

  return weakest
}

// Revision 4: completion requires only the three required categories at ≥ 80.
// v2.1: 'idea'-stage founders use THRESHOLD_HYPOTHESIS (60) unless the evidence floor fires.
// Evidence floor: if maxEvidenceStrength >= 4 (customer interviews or better), always use
// THRESHOLD_COMPLETE regardless of declared stage — prevents gaming the idea threshold.
// v2.2: each required category's raw confidence is capped by COMPLETION_EVIDENCE_CEILINGS
// before being compared to the threshold. A founder with only strength-1 (assumption) on a
// required category cannot reach either threshold regardless of extracted confidence score.
export function checkCompletion(
  categoryConfidence: Record<UnderstandingCategory, number>,
  _overallConfidence: number,
  founderStage: FounderStage = 'building',
  maxEvidenceStrength: EvidenceStrength = 1,
  categoryStrength?: Partial<Record<UnderstandingCategory, EvidenceStrength>>,
  // v2.2 PR3: supply_side joins the required set when marketplaceDetected=true.
  marketplaceDetected: boolean = false,
): boolean {
  const effectiveRequired = getEffectiveRequiredCategories(marketplaceDetected)
  const stageThreshold = founderStage === 'idea' ? THRESHOLD_HYPOTHESIS : THRESHOLD_COMPLETE
  const threshold = maxEvidenceStrength >= 4 ? THRESHOLD_COMPLETE : stageThreshold
  return effectiveRequired.every((cat) => {
    const raw      = categoryConfidence[cat] ?? 0
    const strength = (categoryStrength?.[cat] ?? 1) as EvidenceStrength
    const ceiling  = COMPLETION_EVIDENCE_CEILINGS[strength] ?? 50
    return Math.min(raw, ceiling) >= threshold
  })
}

// Produce warnings for supporting categories below SUPPORTING_WARNING_THRESHOLD.
// Used to populate the Founder Report after session completion.
// supply_side is only included when marketplaceDetected=true — invisible otherwise.
export function buildCompletionWarnings(
  categoryConfidence: Record<UnderstandingCategory, number>,
  categoryStrength:   Record<UnderstandingCategory, EvidenceStrength>,
  marketplaceDetected: boolean = false,
): CategoryWarning[] {
  const warnings: CategoryWarning[] = []

  for (const cat of SUPPORTING_CATEGORIES) {
    if (cat === 'supply_side' && !marketplaceDetected) continue
    const confidence = categoryConfidence[cat] ?? 0
    if (confidence < SUPPORTING_WARNING_THRESHOLD) {
      warnings.push({
        category:        cat,
        confidence,
        evidenceStrength: categoryStrength[cat] ?? 1,
        message:         `${CATEGORY_DISPLAY[cat].label} confidence is low (${confidence}%) — consider validating before investing heavily in this area.`,
      })
    }
  }

  return warnings
}

// ── Validation gap pure functions ─────────────────────────────────────────────

// Promote a category's validationStatus based on this turn's absence signal and
// accumulated weak count. Called once per category per turn inside buildUnderstanding().
//
// Rules:
//   External evidence always wins → validated (regardless of absence signal).
//   Strong absence signal → immediately explicitly_unvalidated (no accumulation required).
//   Weak absence (newWeakCount = already-incremented-for-this-turn) >= 2 → explicitly_unvalidated.
//   External evidence arriving on an already-gap category reverts it to unknown (re-opens).
export function promoteValidationStatus(
  current:          ValidationStatus,
  absenceSignal:    AbsenceSignalStrength,
  newWeakCount:     number,         // existingWeakCount + 1 if this turn is 'weak', else unchanged
  evidenceStrength: EvidenceStrength,
): ValidationStatus {
  // External evidence overrides all absence signals.
  if (evidenceStrength >= 3) {
    // Revert a gap to unknown if new external evidence arrives — re-opens the category.
    return current === 'explicitly_unvalidated' ? 'unknown' : 'validated'
  }
  // Already validated — stays validated until external evidence disappears (can't happen in practice).
  if (current === 'validated') return 'validated'
  // Already a confirmed gap — stays unless external evidence reverted it above.
  if (current === 'explicitly_unvalidated') return 'explicitly_unvalidated'
  // Strong signal → immediate promotion.
  if (absenceSignal === 'strong') return 'explicitly_unvalidated'
  // Weak accumulation threshold.
  if (newWeakCount >= 2) return 'explicitly_unvalidated'
  return current
}

// Derive the Opportunity Assessment tier from stored questioning-layer state.
// This is a read-time computation — not persisted as a separate field.
export function deriveAssessmentTier(
  validationStatus: ValidationStatus,
  confidence:       number,
  evidenceStrength: EvidenceStrength,
): AssessmentTier {
  if (validationStatus === 'validated' || evidenceStrength >= 3) return 'validated'
  if (validationStatus === 'explicitly_unvalidated') {
    return confidence >= 40 ? 'assumption_based' : 'gap'
  }
  return 'unknown'
}

// Determine session-level questioning mode.
// Transitions to gap_identification when all categories have reached one of:
//   - required categories: confidence >= 50 (partial or better)
//   - supporting categories: confidence >= 60, or explicitly_unvalidated, or saturationCount >= SATURATION_THRESHOLD
const QUESTIONING_MODE_REQUIRED_THRESHOLD  = 50
const QUESTIONING_MODE_SUPPORTING_THRESHOLD = 60

export function detectQuestioningMode(
  categories: FounderUnderstanding['categories'],
  // v2.2 PR3: supply_side is treated as automatically done for non-marketplace sessions.
  marketplaceDetected: boolean = false,
): QuestioningMode {
  const requiredMet = REQUIRED_CATEGORIES.every(
    (cat) => (categories[cat]?.confidence ?? 0) >= QUESTIONING_MODE_REQUIRED_THRESHOLD,
  )
  if (!requiredMet) return 'discovery'

  const supportingDone = SUPPORTING_CATEGORIES.every((cat) => {
    if (cat === 'supply_side' && !marketplaceDetected) return true
    const state = categories[cat]
    return (
      (state?.confidence ?? 0) >= QUESTIONING_MODE_SUPPORTING_THRESHOLD ||
      state?.validationStatus === 'explicitly_unvalidated' ||
      (state?.saturationCount ?? 0) >= SATURATION_THRESHOLD
    )
  })

  return supportingDone ? 'gap_identification' : 'discovery'
}

// Build a full FounderUnderstanding from raw scores and evidence.
// Revision 3: now also receives category_evidence_strength per category.
// This revision: adds absence signals, validation status, saturation tracking, and questioning mode.
// Focus cooling: focusHistory (last 5 weakestCategory values) penalises recently-targeted
// categories so the engine rotates to the next priority gap instead of fixating.
export function buildUnderstanding(params: {
  categoryConfidence:           Record<UnderstandingCategory, number>
  categoryEvidence:             Record<UnderstandingCategory, string[]>
  categoryStrength:             Record<UnderstandingCategory, EvidenceStrength>
  existingEvidence:             Record<UnderstandingCategory, string[]>
  focusHistory?:                string[]
  // Validation gap params (default to empty maps for backward compatibility):
  absenceSignals?:              Record<UnderstandingCategory, AbsenceSignalStrength>
  existingValidationStatus?:    Record<UnderstandingCategory, ValidationStatus>
  existingWeakAbsenceCounts?:   Record<UnderstandingCategory, number>
  existingSaturationCounts?:    Record<UnderstandingCategory, number>
  existingLastFocusConfidence?: Record<UnderstandingCategory, number>
  // v2.1 F1+F2:
  founderStage?:        FounderStage
  maxEvidenceStrength?: EvidenceStrength
  // v2.1 F3+F4:
  multiIcpDetected?:    boolean
  pivotDetected?:       boolean
  existingPivotCount?:  number
  // v2.2 PR2:
  marketplaceDetected?: boolean
}): FounderUnderstanding {
  const {
    categoryConfidence,
    categoryEvidence,
    categoryStrength,
    existingEvidence,
    focusHistory = [],
    absenceSignals             = {} as Record<UnderstandingCategory, AbsenceSignalStrength>,
    existingValidationStatus   = {} as Record<UnderstandingCategory, ValidationStatus>,
    existingWeakAbsenceCounts  = {} as Record<UnderstandingCategory, number>,
    existingSaturationCounts   = {} as Record<UnderstandingCategory, number>,
    existingLastFocusConfidence = {} as Record<UnderstandingCategory, number>,
    founderStage        = 'building',
    maxEvidenceStrength = 1,
    multiIcpDetected    = false,
    pivotDetected       = false,
    existingPivotCount  = 0,
    marketplaceDetected = false,
  } = params

  // The category at focusHistory[0] was the weakest last turn — used for saturation delta check.
  const lastFocusCat = (focusHistory[0] ?? null) as UnderstandingCategory | null

  const overallConfidence = computeOverallConfidence(categoryConfidence, marketplaceDetected)
  const isComplete        = checkCompletion(categoryConfidence, overallConfidence, founderStage, maxEvidenceStrength, categoryStrength, marketplaceDetected)

  // Evidence accumulates across turns (append unique, cap at 5).
  const mergeEvidence = (existing: string[], incoming: string[]): string[] => {
    const combined = [...existing]
    for (const item of incoming) {
      if (!combined.includes(item)) combined.push(item)
    }
    return combined.slice(0, 5)
  }

  // Build per-category state with saturation, validation, and assessment tier.
  const saturationCountsForDetect: Record<UnderstandingCategory, number> = {} as Record<UnderstandingCategory, number>

  const categories = Object.fromEntries(
    UNDERSTANDING_CATEGORIES.map((cat) => {
      const confidence     = categoryConfidence[cat] ?? 0
      const strength       = categoryStrength[cat] ?? 1
      const merged         = mergeEvidence(existingEvidence[cat] ?? [], categoryEvidence[cat] ?? [])
      const signal         = absenceSignals[cat] ?? 'none'
      const existingStatus = existingValidationStatus[cat] ?? 'unknown'
      const existingWeak   = existingWeakAbsenceCounts[cat] ?? 0
      const existingSat    = existingSaturationCounts[cat] ?? 0
      const lastFocusConf  = existingLastFocusConfidence[cat] ?? 0

      // Increment weak absence count if this turn emitted a weak signal.
      const newWeakCount = signal === 'weak' ? existingWeak + 1 : existingWeak

      // Validation status promotion.
      const validationStatus = promoteValidationStatus(existingStatus, signal, newWeakCount, strength)

      // Saturation: increment when this category was targeted last turn and delta is small.
      const wasLastFocus    = lastFocusCat === cat
      const confDelta       = wasLastFocus ? Math.abs(confidence - lastFocusConf) : 0
      const newSatCount     = wasLastFocus
        ? (confDelta < SATURATION_DELTA_THRESHOLD ? existingSat + 1 : 0)
        : existingSat
      const newLastFocusConf = wasLastFocus ? confidence : lastFocusConf

      saturationCountsForDetect[cat] = newSatCount

      return [cat, {
        confidence,
        status:              confidenceToStatus(confidence),
        evidenceCount:       merged.length,
        evidence:            merged,
        evidenceStrength:    strength,
        validationStatus,
        weakAbsenceCount:    newWeakCount,
        saturationCount:     newSatCount,
        lastFocusConfidence: newLastFocusConf,
        assessmentTier:      deriveAssessmentTier(validationStatus, confidence, strength),
      }]
    }),
  ) as FounderUnderstanding['categories']

  const weakestCategory = detectWeakestCategory(categoryConfidence, focusHistory, saturationCountsForDetect, multiIcpDetected, marketplaceDetected)
  const warnings        = isComplete
    ? buildCompletionWarnings(categoryConfidence, categoryStrength, marketplaceDetected)
    : []

  const validationGaps = UNDERSTANDING_CATEGORIES.filter(
    (cat) => categories[cat].validationStatus === 'explicitly_unvalidated',
  )
  const questioningMode = detectQuestioningMode(categories, marketplaceDetected)

  // v2.1 F4: pivot accumulator increments each turn a pivot is detected.
  const pivotCount = existingPivotCount + (pivotDetected ? 1 : 0)

  // v2.1 F2: blueprintMode — 'hypothesis' only when the session completed via the
  // idea-stage lower threshold AND required cats did not naturally reach 80.
  const hypothesisCompletion = isComplete
    && founderStage === 'idea'
    && REQUIRED_CATEGORIES.every((cat) => (categoryConfidence[cat] ?? 0) < THRESHOLD_COMPLETE)
  const blueprintMode: BlueprintMode = hypothesisCompletion ? 'hypothesis' : 'validated'

  // v2.1 F5: gapsInBlueprint — explicitly_unvalidated categories at completion time.
  const gapsInBlueprint = isComplete
    ? (UNDERSTANDING_CATEGORIES.filter(
        (cat) => categories[cat].validationStatus === 'explicitly_unvalidated',
      ) as FounderUnderstanding['gapsInBlueprint'])
    : []

  return {
    _schemaVersion: '1.1',
    categories,
    overallConfidence,
    isComplete,
    weakestCategory,
    warnings,
    completionReason: isComplete
      ? 'Required startup dimensions understood. Supporting areas flagged for follow-up.'
      : undefined,
    focusHistory,
    validationGaps,
    questioningMode,
    founderStage,
    blueprintMode,
    gapsInBlueprint,
    multiIcpDetected,
    marketplaceDetected,
    pivotDetected,
    pivotCount,
  }
}

// ── Empty / default state ─────────────────────────────────────────────────────

const EMPTY_CATEGORY_STATE: CategoryState = {
  confidence:          0,
  status:              'missing',
  evidenceCount:       0,
  evidence:            [],
  evidenceStrength:    1,
  validationStatus:    'unknown',
  weakAbsenceCount:    0,
  saturationCount:     0,
  lastFocusConfidence: 0,
  assessmentTier:      'unknown',
}

export const EMPTY_UNDERSTANDING: FounderUnderstanding = {
  _schemaVersion: '1.1',
  categories: {
    problem:     { ...EMPTY_CATEGORY_STATE },
    customer:    { ...EMPTY_CATEGORY_STATE },
    solution:    { ...EMPTY_CATEGORY_STATE },
    market:      { ...EMPTY_CATEGORY_STATE },
    pricing:     { ...EMPTY_CATEGORY_STATE },
    competition: { ...EMPTY_CATEGORY_STATE },
    risks:       { ...EMPTY_CATEGORY_STATE },
    founder_fit: { ...EMPTY_CATEGORY_STATE },
    supply_side: { ...EMPTY_CATEGORY_STATE },
  },
  overallConfidence: 0,
  isComplete:        false,
  weakestCategory:   null,
  warnings:          [],
  focusHistory:      [],
  validationGaps:    [],
  questioningMode:   'discovery',
  founderStage:      'building',
  blueprintMode:     'validated',
  gapsInBlueprint:   [],
  multiIcpDetected:    false,
  marketplaceDetected: false,
  pivotDetected:       false,
  pivotCount:          0,
}

// ── UI progress model ─────────────────────────────────────────────────────────

export const CATEGORY_DISPLAY: Record<UnderstandingCategory, { label: string; description: string; required: boolean }> = {
  problem:     { label: 'Problem Identified',        description: 'Core pain or inefficiency being solved',                        required: true  },
  customer:    { label: 'Customer Identified',       description: 'Primary buyer persona and segment',                             required: true  },
  solution:    { label: 'Solution Understood',       description: 'Product approach and value proposition',                        required: true  },
  market:      { label: 'Market Understood',         description: 'TAM, SAM, SOM and growth signals',                             required: false },
  pricing:     { label: 'Pricing Identified',        description: 'Revenue model and pricing strategy',                            required: false },
  competition: { label: 'Competition Validated',     description: 'Competitive landscape and differentiation',                     required: false },
  risks:       { label: 'Risks Clarified',           description: 'Key assumptions and execution risks',                           required: false },
  founder_fit: { label: 'Founder Fit Assessed',      description: 'Domain expertise, access, and execution ability',               required: false },
  // v2.2 PR3: required=true for marketplace sessions (gated by marketplaceDetected at runtime)
  supply_side: { label: 'Supply Side Understood',    description: 'Provider recruitment, onboarding, quality, and retention',      required: false },
}

// Completion signal shape returned by GET /understanding and included in SSE done event.
export const CompletionSignalSchema = z.object({
  isComplete:        z.boolean(),
  overallConfidence: z.number().int().min(0).max(100),
  weakestCategory:   z.enum([
    'problem', 'customer', 'solution', 'market', 'pricing',
    'competition', 'risks', 'founder_fit', 'supply_side',
  ]).nullable(),
  warnings:          z.array(CategoryWarningSchema).default([]),
  reason:            z.string().optional(),
})
export type CompletionSignal = z.infer<typeof CompletionSignalSchema>
