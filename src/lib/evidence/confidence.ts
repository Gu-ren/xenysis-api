import {
  UNDERSTANDING_CATEGORIES,
  CATEGORY_IMPORTANCE,
  CATEGORY_DISPLAY,
  EVIDENCE_STRENGTH_LEVELS,
  REQUIRED_CATEGORIES,
  type FounderUnderstanding,
  type UnderstandingCategory,
  type EvidenceStrength,
} from '../contracts/founder-understanding.ts'
import type { ConfidenceBreakdown, CategoryEvidenceQuality } from '../contracts/opportunity-assessment.ts'

// Maps evidenceStrength (1-6) to the maximum confidence score that level of evidence can justify.
// Mirrors the soft ceilings in prompt.ts so the pre-computation and the LLM calibration are consistent.
const STRENGTH_CEILINGS: Record<EvidenceStrength, number> = {
  1: 25,
  2: 40,
  3: 60,
  4: 78,
  5: 90,
  6: 100,
}

// Gap penalty ceiling: explicitly_unvalidated categories can't exceed anecdotal level
// regardless of confidence score, because absence of external evidence is a hard bound.
const GAP_PENALTY_CEILING = STRENGTH_CEILINGS[2] // 40

function strengthLabel(strength: EvidenceStrength): string {
  return EVIDENCE_STRENGTH_LEVELS[strength]
}

function qualityLabel(qualityScore: number, tier: CategoryEvidenceQuality['tier']): string {
  if (tier === 'gap')     return 'Gap — no hypothesis or evidence'
  if (tier === 'unknown') return 'Unknown — not yet discussed'
  // For validated and assumption_based, drive the label from the quality score
  // so labels and scores can never contradict each other.
  if (qualityScore >= 60) return 'Strong Evidence'
  if (qualityScore >= 20) return 'Partial Evidence'
  return 'Weak Evidence'
}

// ── computeEvidenceConfidence ─────────────────────────────────────────────────
// Pure function. Deterministic — same FounderUnderstanding always produces the same output.
// Used as a calibration anchor before the LLM call. The LLM may adjust the final
// confidenceScore within a ±15 window but must provide adjustmentRationale beyond that.
export function computeEvidenceConfidence(understanding: FounderUnderstanding): ConfidenceBreakdown {
  const categoryResults: CategoryEvidenceQuality[] = []

  let weightedQualitySum  = 0
  let totalWeight         = 0

  for (const cat of UNDERSTANDING_CATEGORIES) {
    const state    = understanding.categories[cat]
    const strength = (state.evidenceStrength ?? 1) as EvidenceStrength
    const ceiling  = STRENGTH_CEILINGS[strength]

    // Base quality: how much of the strength ceiling the confidence score reaches.
    let qualityScore = Math.min(state.confidence, ceiling)

    // Gap penalty: even if confidence is high, unvalidated categories can't exceed anecdotal ceiling.
    if (state.validationStatus === 'explicitly_unvalidated') {
      qualityScore = Math.min(qualityScore, GAP_PENALTY_CEILING)
    }

    const tier = state.assessmentTier

    categoryResults.push({
      category:        cat,
      tier,
      evidenceStrength: strength,
      confidence:       state.confidence,
      qualityScore,
      label:            qualityLabel(qualityScore, tier),
    })

    const weight = CATEGORY_IMPORTANCE[cat]
    weightedQualitySum += qualityScore * weight
    totalWeight        += weight
  }

  const computedScore = Math.round(weightedQualitySum / totalWeight)

  const strongCategories:  UnderstandingCategory[] = []
  const weakCategories:    UnderstandingCategory[] = []
  const missingCategories: UnderstandingCategory[] = []

  for (const result of categoryResults) {
    if (result.qualityScore >= 60)      strongCategories.push(result.category)
    else if (result.qualityScore >= 20) weakCategories.push(result.category)
    else                                missingCategories.push(result.category)
  }

  return {
    categories:        categoryResults,
    strongCategories,
    weakCategories,
    missingCategories,
    computedScore,
  }
}

// ── renderConfidenceBreakdownPromptBlock ──────────────────────────────────────
// Serialises the pre-computed breakdown into the prompt format injected by prompt.ts.
export function renderConfidenceBreakdownPromptBlock(breakdown: ConfidenceBreakdown): string[] {
  const lines: string[] = [
    '=== PRE-COMPUTED CONFIDENCE BREAKDOWN (primary anchor for your confidenceScore) ===',
    `Computed confidence score: ${breakdown.computedScore}`,
    '',
    'This score is derived deterministically from evidence quality — not LLM judgment.',
    'Your confidenceScore should stay within ±15 of this value.',
    'If you deviate by more than 10 points, include adjustmentRationale in confidenceBreakdown.',
    '',
  ]

  if (breakdown.strongCategories.length > 0) {
    lines.push(`Strong evidence (quality ≥ 60): ${breakdown.strongCategories.map((c) => CATEGORY_DISPLAY[c].label).join(', ')}`)
  }
  if (breakdown.weakCategories.length > 0) {
    lines.push(`Weak evidence (quality 20–59): ${breakdown.weakCategories.map((c) => CATEGORY_DISPLAY[c].label).join(', ')}`)
  }
  if (breakdown.missingCategories.length > 0) {
    lines.push(`Missing/gap (quality < 20): ${breakdown.missingCategories.map((c) => CATEGORY_DISPLAY[c].label).join(', ')}`)
  }

  lines.push('')
  lines.push('Per-category quality scores:')

  for (const cat of breakdown.categories) {
    const reqFlag = (REQUIRED_CATEGORIES as readonly UnderstandingCategory[]).includes(cat.category) ? ' [REQUIRED]' : ''
    lines.push(
      `  ${CATEGORY_DISPLAY[cat.category].label}${reqFlag}: ` +
      `quality=${cat.qualityScore} | confidence=${cat.confidence}% | ` +
      `strength=${cat.evidenceStrength}/6 (${strengthLabel(cat.evidenceStrength as EvidenceStrength)}) | ` +
      `tier=${cat.tier}`,
    )
  }

  lines.push('')
  return lines
}
