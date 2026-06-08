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
] as const

// Business importance weights for priority formula: (100 - confidence) × importance.
export const CATEGORY_IMPORTANCE: Record<UnderstandingCategory, number> = {
  problem:      10,
  customer:     10,
  competition:  10,
  market:        9,
  solution:      9,
  pricing:       8,
  risks:         8,
  founder_fit:   8,   // Revision 2
}

// Total weight — updated for 8 categories (was 64, now 72).
const TOTAL_WEIGHT = Object.values(CATEGORY_IMPORTANCE).reduce((a, b) => a + b, 0) // 72

// Confidence thresholds for status derivation.
const THRESHOLD_PARTIAL  = 30    // below this → missing
const THRESHOLD_COMPLETE = 80    // at or above this → complete

// Warning threshold for supporting categories in the Founder Report.
export const SUPPORTING_WARNING_THRESHOLD = 60

// Revision 4: overall threshold relaxed from 80 → 75.
export const COMPLETION_OVERALL_THRESHOLD = 75

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
  category:        z.enum(['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit']),
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
  }),

  overallConfidence: z.number().int().min(0).max(100),
  isComplete:        z.boolean(),

  // The category with the highest gap priority. Null only before first exchange.
  weakestCategory: z.enum([
    'problem', 'customer', 'solution', 'market', 'pricing',
    'competition', 'risks', 'founder_fit',
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
    z.enum(['problem', 'customer', 'solution', 'market', 'pricing', 'competition', 'risks', 'founder_fit']),
  ).default([]),

  // Session-level questioning orientation — shifts to gap_identification when all categories
  // are either well-understood, validated, explicitly_unvalidated, or saturated.
  questioningMode: QuestioningModeSchema.default('discovery'),
})
export type FounderUnderstanding = z.infer<typeof FounderUnderstandingSchema>

// ── Pure computation ──────────────────────────────────────────────────────────

export function confidenceToStatus(confidence: number): CategoryStatus {
  if (confidence >= THRESHOLD_COMPLETE) return 'complete'
  if (confidence >= THRESHOLD_PARTIAL)  return 'partial'
  return 'missing'
}

// Weighted average using CATEGORY_IMPORTANCE across all 8 categories.
export function computeOverallConfidence(
  categoryConfidence: Record<UnderstandingCategory, number>,
): number {
  const weightedSum = UNDERSTANDING_CATEGORIES.reduce((sum, cat) => {
    return sum + (categoryConfidence[cat] ?? 0) * CATEGORY_IMPORTANCE[cat]
  }, 0)
  return Math.round(weightedSum / TOTAL_WEIGHT)
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
): UnderstandingCategory {
  let maxPriority = -1
  let weakest: UnderstandingCategory = 'competition'

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const basePriority = computeCategoryPriority(cat, categoryConfidence[cat] ?? 0)
    const recentCount  = Math.min(focusHistory.filter((h) => h === cat).length, 3)
    const coolMult     = COOLING_MULTIPLIERS[recentCount] ?? 1.0
    // Saturated categories get a near-zero multiplier — they are exhausted and should not
    // be selected again until a new evidence breakthrough resets the saturation counter.
    const satMult      = (saturationCounts[cat] ?? 0) >= SATURATION_THRESHOLD ? 0.02 : 1.0
    const effectivePriority = basePriority * coolMult * satMult

    if (effectivePriority > maxPriority) {
      maxPriority = effectivePriority
      weakest = cat
    }
  }

  return weakest
}

// Revision 4: completion requires only the three required categories at ≥ 80.
// Supporting categories generate warnings but do NOT block completion.
// overallConfidence is retained as a display metric but is not used for the completion
// gate — competition's weight (10) in the overall formula made the gate fire too late
// (session with problem/customer/solution at 90/90/85 + all supporting at ~40% scored
// overall 59%, permanently blocking completion despite the required areas being strong).
export function checkCompletion(
  categoryConfidence: Record<UnderstandingCategory, number>,
  _overallConfidence: number,
): boolean {
  return REQUIRED_CATEGORIES.every(
    (cat) => (categoryConfidence[cat] ?? 0) >= THRESHOLD_COMPLETE,
  )
}

// Produce warnings for supporting categories below SUPPORTING_WARNING_THRESHOLD.
// Used to populate the Founder Report after session completion.
export function buildCompletionWarnings(
  categoryConfidence: Record<UnderstandingCategory, number>,
  categoryStrength:   Record<UnderstandingCategory, EvidenceStrength>,
): CategoryWarning[] {
  const warnings: CategoryWarning[] = []

  for (const cat of SUPPORTING_CATEGORIES) {
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
): QuestioningMode {
  const requiredMet = REQUIRED_CATEGORIES.every(
    (cat) => (categories[cat]?.confidence ?? 0) >= QUESTIONING_MODE_REQUIRED_THRESHOLD,
  )
  if (!requiredMet) return 'discovery'

  const supportingDone = SUPPORTING_CATEGORIES.every((cat) => {
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
  } = params

  // The category at focusHistory[0] was the weakest last turn — used for saturation delta check.
  const lastFocusCat = (focusHistory[0] ?? null) as UnderstandingCategory | null

  const overallConfidence = computeOverallConfidence(categoryConfidence)
  const isComplete        = checkCompletion(categoryConfidence, overallConfidence)

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

  const weakestCategory = detectWeakestCategory(categoryConfidence, focusHistory, saturationCountsForDetect)
  const warnings        = isComplete
    ? buildCompletionWarnings(categoryConfidence, categoryStrength)
    : []

  const validationGaps = UNDERSTANDING_CATEGORIES.filter(
    (cat) => categories[cat].validationStatus === 'explicitly_unvalidated',
  )
  const questioningMode = detectQuestioningMode(categories)

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
  },
  overallConfidence: 0,
  isComplete:        false,
  weakestCategory:   null,
  warnings:          [],
  focusHistory:      [],
  validationGaps:    [],
  questioningMode:   'discovery',
}

// ── UI progress model ─────────────────────────────────────────────────────────

export const CATEGORY_DISPLAY: Record<UnderstandingCategory, { label: string; description: string; required: boolean }> = {
  problem:     { label: 'Problem Identified',        description: 'Core pain or inefficiency being solved',          required: true  },
  customer:    { label: 'Customer Identified',       description: 'Primary buyer persona and segment',               required: true  },
  solution:    { label: 'Solution Understood',       description: 'Product approach and value proposition',          required: true  },
  market:      { label: 'Market Understood',         description: 'TAM, SAM, SOM and growth signals',               required: false },
  pricing:     { label: 'Pricing Identified',        description: 'Revenue model and pricing strategy',              required: false },
  competition: { label: 'Competition Validated',     description: 'Competitive landscape and differentiation',       required: false },
  risks:       { label: 'Risks Clarified',           description: 'Key assumptions and execution risks',             required: false },
  founder_fit: { label: 'Founder Fit Assessed',      description: 'Domain expertise, access, and execution ability', required: false },
}

// Completion signal shape returned by GET /understanding and included in SSE done event.
export const CompletionSignalSchema = z.object({
  isComplete:        z.boolean(),
  overallConfidence: z.number().int().min(0).max(100),
  weakestCategory:   z.enum([
    'problem', 'customer', 'solution', 'market', 'pricing',
    'competition', 'risks', 'founder_fit',
  ]).nullable(),
  warnings:          z.array(CategoryWarningSchema).default([]),
  reason:            z.string().optional(),
})
export type CompletionSignal = z.infer<typeof CompletionSignalSchema>
