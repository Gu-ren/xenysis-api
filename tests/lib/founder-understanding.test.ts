import { describe, it, expect } from 'vitest'
import {
  checkCompletion,
  buildUnderstanding,
  detectWeakestCategory,
  computeOverallConfidence,
  detectQuestioningMode,
  getEffectiveRequiredCategories,
  THRESHOLD_COMPLETE,
  THRESHOLD_HYPOTHESIS,
  COMPLETION_EVIDENCE_CEILINGS,
  REQUIRED_CATEGORIES,
  UNDERSTANDING_CATEGORIES,
  SATURATION_THRESHOLD,
  TOTAL_WEIGHT_BASE,
  TOTAL_WEIGHT_MARKETPLACE,
  CATEGORY_IMPORTANCE,
  type UnderstandingCategory,
  type EvidenceStrength,
} from '../../src/lib/contracts/founder-understanding.ts'
import { mergeFounderMemory, EMPTY_FOUNDER_MEMORY } from '../../src/lib/contracts/founder-memory.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfidence(value: number): Record<UnderstandingCategory, number> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, value])) as Record<UnderstandingCategory, number>
}

function makeStrength(value: EvidenceStrength): Record<UnderstandingCategory, EvidenceStrength> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, value])) as Record<UnderstandingCategory, EvidenceStrength>
}

function makeEvidence(): Record<UnderstandingCategory, string[]> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, []])) as Record<UnderstandingCategory, string[]>
}

// Default strength-3 (customer conversations): the minimum for building-stage completion
// under v2.2 evidence ceilings (ceiling 83 ≥ threshold 80). Tests that need to verify
// strength-1 behavior pass strength explicitly.
function minimalUnderstandingParams(confidenceValue: number, strength: EvidenceStrength = 3) {
  return {
    categoryConfidence: makeConfidence(confidenceValue),
    categoryEvidence:   makeEvidence(),
    categoryStrength:   makeStrength(strength),
    existingEvidence:   makeEvidence(),
  }
}

// ── checkCompletion ───────────────────────────────────────────────────────────

describe('checkCompletion', () => {
  describe('building stage (default)', () => {
    it('returns true when all required categories are at THRESHOLD_COMPLETE with adequate evidence', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'building', 1, makeStrength(3))).toBe(true)
    })

    it('returns true when required categories exceed THRESHOLD_COMPLETE with adequate evidence', () => {
      expect(checkCompletion(makeConfidence(95), 0, 'building', 1, makeStrength(3))).toBe(true)
    })

    it('returns false when required categories are at THRESHOLD_HYPOTHESIS but below THRESHOLD_COMPLETE', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_HYPOTHESIS), 0, 'building', 1, makeStrength(3))).toBe(false)
    })

    it('returns false when required categories are at 79', () => {
      expect(checkCompletion(makeConfidence(79), 0, 'building', 1, makeStrength(3))).toBe(false)
    })

    it('returns false when any required category is below threshold', () => {
      const conf = makeConfidence(90)
      conf.problem = 50
      expect(checkCompletion(conf, 0, 'building', 1, makeStrength(3))).toBe(false)
    })

    it('returns true even when supporting categories are well below threshold', () => {
      const conf = makeConfidence(THRESHOLD_COMPLETE)
      conf.market      = 10
      conf.pricing     = 5
      conf.competition = 20
      expect(checkCompletion(conf, 0, 'building', 1, makeStrength(3))).toBe(true)
    })
  })

  describe('revenue stage', () => {
    it('uses THRESHOLD_COMPLETE (same as building)', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'revenue', 1, makeStrength(3))).toBe(true)
      expect(checkCompletion(makeConfidence(79), 0, 'revenue', 1, makeStrength(3))).toBe(false)
    })
  })

  describe('idea stage', () => {
    it('returns true at THRESHOLD_HYPOTHESIS (60) with anecdotal evidence (strength 2)', () => {
      // strength-2 ceiling is 65 ≥ threshold 60 — anecdotal observation is sufficient for idea stage
      expect(checkCompletion(makeConfidence(THRESHOLD_HYPOTHESIS), 0, 'idea', 1, makeStrength(2))).toBe(true)
    })

    it('returns true at 61 with anecdotal evidence (strength 2)', () => {
      expect(checkCompletion(makeConfidence(61), 0, 'idea', 1, makeStrength(2))).toBe(true)
    })

    it('returns false at 59 even with adequate evidence', () => {
      expect(checkCompletion(makeConfidence(59), 0, 'idea', 1, makeStrength(2))).toBe(false)
    })

    it('returns false when any required category is below THRESHOLD_HYPOTHESIS', () => {
      const conf = makeConfidence(70)
      conf.customer = 55
      expect(checkCompletion(conf, 0, 'idea', 1, makeStrength(2))).toBe(false)
    })
  })

  describe('evidence floor (v2.1 — maxEvidenceStrength escalation)', () => {
    it('escalates threshold to THRESHOLD_COMPLETE when maxEvidenceStrength >= 4 on idea stage', () => {
      // confidence=60 is enough for idea stage, but evidence floor fires at strength=4
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 4, makeStrength(4))).toBe(false)
    })

    it('escalates threshold at maxEvidenceStrength=5', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 5, makeStrength(5))).toBe(false)
    })

    it('escalates threshold at maxEvidenceStrength=6', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 6, makeStrength(6))).toBe(false)
    })

    it('does NOT escalate at maxEvidenceStrength=3 — idea stage threshold stays at 60', () => {
      // strength-3 ceiling is 83 ≥ 60 and maxStrength=3 does not trigger floor escalation
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 3, makeStrength(3))).toBe(true)
    })

    it('returns true at THRESHOLD_COMPLETE with evidence floor active', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'idea', 4, makeStrength(4))).toBe(true)
    })

    it('applies evidence floor even when founderStage is building (no effective change since threshold is already 80)', () => {
      expect(checkCompletion(makeConfidence(79), 0, 'building', 4, makeStrength(4))).toBe(false)
      expect(checkCompletion(makeConfidence(80), 0, 'building', 4, makeStrength(4))).toBe(true)
    })
  })

  describe('defaults', () => {
    it('defaults to building stage when no stage provided', () => {
      // No founderStage arg — behaves as building (threshold=80)
      expect(checkCompletion(makeConfidence(60), 0)).toBe(false)
      // With strength-3 categoryStrength, building stage completes at 80
      expect(checkCompletion(makeConfidence(83), 0, undefined, undefined, makeStrength(3))).toBe(true)
    })

    it('defaults to strength-1 ceilings when no categoryStrength provided — blocks both thresholds', () => {
      // strength-1 ceiling is 50, which is below both thresholds (60 and 80)
      // A founder with zero external evidence cannot complete regardless of narrative confidence
      expect(checkCompletion(makeConfidence(80), 0, 'building')).toBe(false)
      expect(checkCompletion(makeConfidence(60), 0, 'idea')).toBe(false)
    })
  })

  describe('evidence ceilings (v2.2)', () => {
    // For each strength level, verify the ceiling from COMPLETION_EVIDENCE_CEILINGS.
    // A raw confidence equal to the ceiling should pass; one above the ceiling is capped
    // to exactly the ceiling. A raw value that exceeds the threshold but whose ceiling
    // is below the threshold should still fail.

    it('strength-1 ceiling is 50 — blocks building (threshold 80) at any confidence', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[1]).toBe(50)
      expect(checkCompletion(makeConfidence(100), 0, 'building', 1, makeStrength(1))).toBe(false)
    })

    it('strength-1 ceiling is 50 — blocks idea stage (threshold 60) at any confidence', () => {
      expect(checkCompletion(makeConfidence(100), 0, 'idea', 1, makeStrength(1))).toBe(false)
    })

    it('strength-2 ceiling is 65 — blocks building (threshold 80) at any confidence', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[2]).toBe(65)
      expect(checkCompletion(makeConfidence(100), 0, 'building', 1, makeStrength(2))).toBe(false)
    })

    it('strength-2 ceiling is 65 — allows idea stage (threshold 60) to complete', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 1, makeStrength(2))).toBe(true)
    })

    it('strength-3 ceiling is 83 — allows building stage (threshold 80) to complete', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[3]).toBe(83)
      expect(checkCompletion(makeConfidence(80), 0, 'building', 1, makeStrength(3))).toBe(true)
    })

    it('strength-3 ceiling caps raw confidence above 83 to exactly 83', () => {
      // raw=99, ceiling=83 → effective=83 ≥ threshold=80 → true
      expect(checkCompletion(makeConfidence(99), 0, 'building', 1, makeStrength(3))).toBe(true)
    })

    it('strength-4 ceiling is 92 — allows building stage to complete well above threshold', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[4]).toBe(92)
      expect(checkCompletion(makeConfidence(92), 0, 'building', 1, makeStrength(4))).toBe(true)
    })

    it('strength-5 ceiling is 97', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[5]).toBe(97)
      expect(checkCompletion(makeConfidence(97), 0, 'building', 1, makeStrength(5))).toBe(true)
    })

    it('strength-6 ceiling is 100 — no ceiling, full confidence passes', () => {
      expect(COMPLETION_EVIDENCE_CEILINGS[6]).toBe(100)
      expect(checkCompletion(makeConfidence(100), 0, 'building', 1, makeStrength(6))).toBe(true)
    })

    it('ceiling is applied per-category — one weak category blocks even when others are strong', () => {
      const conf     = makeConfidence(100)
      const strength = makeStrength(6) // all strength-6 initially
      // Override problem to strength-1: ceiling 50 < threshold 80 → blocks
      const mixedStrength = { ...strength, problem: 1 as EvidenceStrength }
      expect(checkCompletion(conf, 0, 'building', 1, mixedStrength)).toBe(false)
    })

    it('ceiling does not affect supporting categories — only required categories gate completion', () => {
      const conf = makeConfidence(100)
      // market is not a required category — its low ceiling does not block completion
      const mixedStrength = { ...makeStrength(3), market: 1 as EvidenceStrength }
      expect(checkCompletion(conf, 0, 'building', 1, mixedStrength)).toBe(true)
    })
  })
})

// ── buildUnderstanding — blueprintMode derivation ────────────────────────────

describe('buildUnderstanding — blueprintMode', () => {
  it('returns hypothesis when idea-stage session completes at THRESHOLD_HYPOTHESIS', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_HYPOTHESIS),
      founderStage:        'idea',
      maxEvidenceStrength: 1,
    })
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('hypothesis')
  })

  it('returns validated when building-stage session completes at THRESHOLD_COMPLETE', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      founderStage:        'building',
      maxEvidenceStrength: 1,
    })
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('validated')
  })

  it('returns validated when idea-stage founder naturally reaches THRESHOLD_COMPLETE', () => {
    // Edge case: idea-stage founder with strong confidence — gets validated, not hypothesis
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      founderStage:        'idea',
      maxEvidenceStrength: 1,
    })
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('validated')
  })

  it('returns validated (isComplete=false) before session completes', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(40),
      founderStage:        'idea',
      maxEvidenceStrength: 1,
    })
    expect(result.isComplete).toBe(false)
    expect(result.blueprintMode).toBe('validated')
  })

  it('returns validated when evidence floor fires on idea-stage founder at 60%', () => {
    // Founder declared idea stage but has strength=4 — floor escalates threshold to 80
    // At confidence=60, session is NOT complete
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(60, 4),
      founderStage:        'idea',
      maxEvidenceStrength: 4,
    })
    expect(result.isComplete).toBe(false)
    expect(result.blueprintMode).toBe('validated')
  })

  it('returns validated when evidence floor fires and founder reaches 80%', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE, 4),
      founderStage:        'idea',
      maxEvidenceStrength: 4,
    })
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('validated')
  })

  it('defaults founderStage to building when not provided', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(THRESHOLD_COMPLETE))
    expect(result.founderStage).toBe('building')
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('validated')
  })
})

// ── buildUnderstanding — gapsInBlueprint derivation ──────────────────────────

describe('buildUnderstanding — gapsInBlueprint', () => {
  it('is empty when session is not complete', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(40),
      existingValidationStatus: {
        problem:     'explicitly_unvalidated',
        customer:    'explicitly_unvalidated',
        solution:    'unknown',
        market:      'unknown',
        pricing:     'unknown',
        competition: 'unknown',
        risks:       'unknown',
        founder_fit: 'unknown',
      },
    })
    expect(result.isComplete).toBe(false)
    expect(result.gapsInBlueprint).toEqual([])
  })

  it('is empty when session completes with no validation gaps', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      existingValidationStatus: {
        problem:     'validated',
        customer:    'validated',
        solution:    'validated',
        market:      'validated',
        pricing:     'validated',
        competition: 'validated',
        risks:       'validated',
        founder_fit: 'validated',
      },
    })
    expect(result.isComplete).toBe(true)
    expect(result.gapsInBlueprint).toEqual([])
  })

  it('captures explicitly_unvalidated categories at completion', () => {
    // Gap categories (market, pricing) stay explicitly_unvalidated when hasExternalContact=false (default).
    // Required categories (problem, customer, solution) need strength-3 (ceiling 83 ≥ 80) to complete.
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      categoryStrength: {
        ...makeStrength(3),
        market:      1 as EvidenceStrength,
        pricing:     1 as EvidenceStrength,
        competition: 1 as EvidenceStrength,
        risks:       1 as EvidenceStrength,
        founder_fit: 1 as EvidenceStrength,
      },
      existingValidationStatus: {
        problem:     'validated',
        customer:    'validated',
        solution:    'validated',
        market:      'explicitly_unvalidated',
        pricing:     'explicitly_unvalidated',
        competition: 'unknown',
        risks:       'unknown',
        founder_fit: 'unknown',
      },
    })
    expect(result.isComplete).toBe(true)
    expect(result.gapsInBlueprint).toContain('market')
    expect(result.gapsInBlueprint).toContain('pricing')
    expect(result.gapsInBlueprint).not.toContain('problem')
    expect(result.gapsInBlueprint).not.toContain('competition')
  })

  it('captures required categories in gapsInBlueprint when explicitly_unvalidated at completion (idea stage)', () => {
    // v2.2: building-stage required categories cannot be explicitly_unvalidated at completion
    // because the completion gate blocks them (strength<3 ceiling < threshold 80).
    // Idea stage (threshold 60): strength-2 ceiling=65 ≥ 60, and hasExternalContact=false preserves explicitly_unvalidated.
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_HYPOTHESIS, 2),
      founderStage:        'idea',
      maxEvidenceStrength: 1,
      existingValidationStatus: {
        problem:     'explicitly_unvalidated',
        customer:    'validated',
        solution:    'validated',
        market:      'unknown',
        pricing:     'unknown',
        competition: 'unknown',
        risks:       'unknown',
        founder_fit: 'unknown',
      },
    })
    expect(result.isComplete).toBe(true)
    expect(result.gapsInBlueprint).toContain('problem')
  })

  it('gapsInBlueprint matches validationGaps when session is complete', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      existingValidationStatus: {
        problem:     'validated',
        customer:    'explicitly_unvalidated',
        solution:    'validated',
        market:      'explicitly_unvalidated',
        pricing:     'unknown',
        competition: 'unknown',
        risks:       'unknown',
        founder_fit: 'unknown',
      },
    })
    expect(result.isComplete).toBe(true)
    expect(result.gapsInBlueprint).toEqual(expect.arrayContaining(result.validationGaps))
    expect(result.validationGaps).toEqual(expect.arrayContaining(result.gapsInBlueprint))
  })

  it('idea-stage hypothesis completion populates gapsInBlueprint correctly', () => {
    // strength-2: ceiling=65 ≥ 60 (idea threshold) — allows completion.
    // hasExternalContact=false (default) preserves explicitly_unvalidated (not reverted by promoteValidationStatus).
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_HYPOTHESIS, 2),
      founderStage:        'idea',
      maxEvidenceStrength: 1,
      existingValidationStatus: {
        problem:     'validated',
        customer:    'explicitly_unvalidated',
        solution:    'validated',
        market:      'explicitly_unvalidated',
        pricing:     'explicitly_unvalidated',
        competition: 'unknown',
        risks:       'unknown',
        founder_fit: 'unknown',
      },
    })
    expect(result.isComplete).toBe(true)
    expect(result.blueprintMode).toBe('hypothesis')
    expect(result.gapsInBlueprint).toContain('customer')
    expect(result.gapsInBlueprint).toContain('market')
    expect(result.gapsInBlueprint).toContain('pricing')
    expect(result.gapsInBlueprint).not.toContain('problem')
  })
})

// ── detectWeakestCategory — multiIcpDetected customer exception (F3) ─────────

describe('detectWeakestCategory — multiIcpDetected', () => {
  function makeSaturation(cat: UnderstandingCategory, count: number): Partial<Record<UnderstandingCategory, number>> {
    return { [cat]: count }
  }

  it('blocks saturated customer normally when multiIcpDetected is false', () => {
    // All categories low confidence; customer is saturated.
    // With multiIcpDetected=false, customer should be penalised (nearly zeroed out).
    const confidence = makeConfidence(30)
    confidence.customer = 30
    const saturation = makeSaturation('customer', SATURATION_THRESHOLD)
    const result = detectWeakestCategory(confidence, [], saturation, false)
    // customer is saturated → effectively removed from candidacy; should pick another category
    expect(result).not.toBe('customer')
  })

  it('does NOT block saturated customer when multiIcpDetected is true', () => {
    // customer is the only category with low confidence AND is saturated.
    // All others are at 90. With multiIcpDetected=true, customer saturation is suppressed.
    const confidence = makeConfidence(90)
    confidence.customer = 20
    const saturation = makeSaturation('customer', SATURATION_THRESHOLD)
    const result = detectWeakestCategory(confidence, [], saturation, true)
    expect(result).toBe('customer')
  })

  it('still blocks other saturated categories when multiIcpDetected is true', () => {
    // problem is saturated, customer is not saturated but has low confidence.
    // With multiIcpDetected=true, problem is still blocked; customer wins.
    const confidence = makeConfidence(90)
    confidence.problem  = 20
    confidence.customer = 25
    const saturation = makeSaturation('problem', SATURATION_THRESHOLD)
    const result = detectWeakestCategory(confidence, [], saturation, true)
    // problem is saturated (not customer) → customer should win over saturated problem
    expect(result).toBe('customer')
  })
})

// ── buildUnderstanding — multiIcpDetected / pivotDetected / pivotCount (F3/F4) ─

describe('buildUnderstanding — multiIcpDetected (F3)', () => {
  it('defaults multiIcpDetected to false when not provided', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(50))
    expect(result.multiIcpDetected).toBe(false)
  })

  it('passes multiIcpDetected = true through to the output', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      multiIcpDetected: true,
    })
    expect(result.multiIcpDetected).toBe(true)
  })

  it('passes multiIcpDetected = false through to the output', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      multiIcpDetected: false,
    })
    expect(result.multiIcpDetected).toBe(false)
  })
})

describe('buildUnderstanding — pivotDetected and pivotCount (F4)', () => {
  it('defaults pivotDetected to false when not provided', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(50))
    expect(result.pivotDetected).toBe(false)
  })

  it('defaults pivotCount to 0 when neither pivotDetected nor existingPivotCount provided', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(50))
    expect(result.pivotCount).toBe(0)
  })

  it('passes pivotDetected = true through to the output', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected: true,
    })
    expect(result.pivotDetected).toBe(true)
  })

  it('increments pivotCount when pivotDetected = true', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected:     true,
      existingPivotCount: 2,
    })
    expect(result.pivotCount).toBe(3)
  })

  it('does NOT increment pivotCount when pivotDetected = false', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected:     false,
      existingPivotCount: 2,
    })
    expect(result.pivotCount).toBe(2)
  })

  it('starts pivotCount from existingPivotCount when pivotDetected = false', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected:     false,
      existingPivotCount: 5,
    })
    expect(result.pivotCount).toBe(5)
  })

  it('pivotDetected is per-turn — true on one turn, false the next', () => {
    const turn1 = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected:     true,
      existingPivotCount: 0,
    })
    expect(turn1.pivotDetected).toBe(true)
    expect(turn1.pivotCount).toBe(1)

    const turn2 = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      pivotDetected:     false,
      existingPivotCount: turn1.pivotCount,
    })
    expect(turn2.pivotDetected).toBe(false)
    expect(turn2.pivotCount).toBe(1)
  })
})

// ── mergeFounderMemory — multi_icp_detected / pivot_detected (F3/F4) ─────────

describe('mergeFounderMemory — F3/F4 fields', () => {
  it('multi_icp_detected defaults to false in EMPTY_FOUNDER_MEMORY', () => {
    expect(EMPTY_FOUNDER_MEMORY.multi_icp_detected).toBe(false)
  })

  it('pivot_detected defaults to false in EMPTY_FOUNDER_MEMORY', () => {
    expect(EMPTY_FOUNDER_MEMORY.pivot_detected).toBe(false)
  })

  it('replaces multi_icp_detected with latest extracted value (false → true)', () => {
    const merged = mergeFounderMemory(EMPTY_FOUNDER_MEMORY, { multi_icp_detected: true })
    expect(merged.multi_icp_detected).toBe(true)
  })

  it('replaces multi_icp_detected with latest extracted value (true → false)', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, multi_icp_detected: true }
    const merged = mergeFounderMemory(existing, { multi_icp_detected: false })
    expect(merged.multi_icp_detected).toBe(false)
  })

  it('preserves existing multi_icp_detected when not present in extraction', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, multi_icp_detected: true }
    const merged = mergeFounderMemory(existing, {})
    expect(merged.multi_icp_detected).toBe(true)
  })

  it('replaces pivot_detected with latest extracted value (false → true)', () => {
    const merged = mergeFounderMemory(EMPTY_FOUNDER_MEMORY, { pivot_detected: true })
    expect(merged.pivot_detected).toBe(true)
  })

  it('replaces pivot_detected with latest extracted value (true → false)', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, pivot_detected: true }
    const merged = mergeFounderMemory(existing, { pivot_detected: false })
    expect(merged.pivot_detected).toBe(false)
  })

  it('preserves existing pivot_detected when not present in extraction', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, pivot_detected: true }
    const merged = mergeFounderMemory(existing, {})
    expect(merged.pivot_detected).toBe(true)
  })
})

// ── buildUnderstanding — marketplaceDetected (v2.2 PR2) ──────────────────────

describe('buildUnderstanding — marketplaceDetected (v2.2 PR2)', () => {
  it('defaults marketplaceDetected to false when not provided', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(50))
    expect(result.marketplaceDetected).toBe(false)
  })

  it('passes marketplaceDetected = true through to the output', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      marketplaceDetected: true,
    })
    expect(result.marketplaceDetected).toBe(true)
  })

  it('passes marketplaceDetected = false through to the output', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      marketplaceDetected: false,
    })
    expect(result.marketplaceDetected).toBe(false)
  })

  it('is independent from multiIcpDetected — both can be true simultaneously', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      multiIcpDetected:    true,
      marketplaceDetected: true,
    })
    expect(result.multiIcpDetected).toBe(true)
    expect(result.marketplaceDetected).toBe(true)
  })

  it('multiIcpDetected can be true while marketplaceDetected is false', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      multiIcpDetected:    true,
      marketplaceDetected: false,
    })
    expect(result.multiIcpDetected).toBe(true)
    expect(result.marketplaceDetected).toBe(false)
  })

  it('marketplaceDetected can be true while multiIcpDetected is false', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(50),
      multiIcpDetected:    false,
      marketplaceDetected: true,
    })
    expect(result.multiIcpDetected).toBe(false)
    expect(result.marketplaceDetected).toBe(true)
  })
})

// ── mergeFounderMemory — marketplace_detected (v2.2 PR2) ─────────────────────

describe('mergeFounderMemory — marketplace_detected (v2.2 PR2)', () => {
  it('marketplace_detected defaults to false in EMPTY_FOUNDER_MEMORY', () => {
    expect(EMPTY_FOUNDER_MEMORY.marketplace_detected).toBe(false)
  })

  it('replaces marketplace_detected with latest extracted value (false → true)', () => {
    const merged = mergeFounderMemory(EMPTY_FOUNDER_MEMORY, { marketplace_detected: true })
    expect(merged.marketplace_detected).toBe(true)
  })

  it('replaces marketplace_detected with latest extracted value (true → false)', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, marketplace_detected: true }
    const merged = mergeFounderMemory(existing, { marketplace_detected: false })
    expect(merged.marketplace_detected).toBe(false)
  })

  it('preserves existing marketplace_detected when not present in extraction', () => {
    const existing = { ...EMPTY_FOUNDER_MEMORY, marketplace_detected: true }
    const merged = mergeFounderMemory(existing, {})
    expect(merged.marketplace_detected).toBe(true)
  })

  it('is independent from multi_icp_detected in merge', () => {
    const merged = mergeFounderMemory(
      { ...EMPTY_FOUNDER_MEMORY, multi_icp_detected: true },
      { marketplace_detected: true },
    )
    expect(merged.multi_icp_detected).toBe(true)
    expect(merged.marketplace_detected).toBe(true)
  })
})

// ── Constants sanity ──────────────────────────────────────────────────────────

describe('threshold constants', () => {
  it('THRESHOLD_HYPOTHESIS is less than THRESHOLD_COMPLETE', () => {
    expect(THRESHOLD_HYPOTHESIS).toBeLessThan(THRESHOLD_COMPLETE)
  })

  it('THRESHOLD_COMPLETE is 80', () => {
    expect(THRESHOLD_COMPLETE).toBe(80)
  })

  it('THRESHOLD_HYPOTHESIS is 60', () => {
    expect(THRESHOLD_HYPOTHESIS).toBe(60)
  })

  it('REQUIRED_CATEGORIES contains exactly problem, customer, solution', () => {
    expect([...REQUIRED_CATEGORIES].sort()).toEqual(['customer', 'problem', 'solution'])
  })
})

// ── v2.2 PR3: supply_side ─────────────────────────────────────────────────────

describe('supply_side — category registration', () => {
  it('supply_side is in UNDERSTANDING_CATEGORIES', () => {
    expect(UNDERSTANDING_CATEGORIES).toContain('supply_side')
  })

  it('UNDERSTANDING_CATEGORIES has 9 entries (8 original + supply_side)', () => {
    expect(UNDERSTANDING_CATEGORIES).toHaveLength(9)
  })
})

describe('getEffectiveRequiredCategories (v2.2 PR3)', () => {
  it('returns only the 3 base required categories when marketplaceDetected = false', () => {
    const cats = getEffectiveRequiredCategories(false)
    expect([...cats].sort()).toEqual(['customer', 'problem', 'solution'])
  })

  it('includes supply_side when marketplaceDetected = true', () => {
    const cats = getEffectiveRequiredCategories(true)
    expect(cats).toContain('supply_side')
  })

  it('still includes all 3 base required categories when marketplaceDetected = true', () => {
    const cats = getEffectiveRequiredCategories(true)
    expect(cats).toContain('problem')
    expect(cats).toContain('customer')
    expect(cats).toContain('solution')
  })

  it('returns 4 categories when marketplaceDetected = true', () => {
    const cats = getEffectiveRequiredCategories(true)
    expect(cats).toHaveLength(4)
  })
})

describe('detectWeakestCategory — supply_side visibility (v2.2 PR3)', () => {
  it('never returns supply_side when marketplaceDetected = false', () => {
    // supply_side has lowest confidence — but must be hidden for non-marketplace sessions.
    const confidence = { ...makeConfidence(85), supply_side: 0 }
    const result = detectWeakestCategory(confidence, [], {}, false, false)
    expect(result).not.toBe('supply_side')
  })

  it('CAN return supply_side when marketplaceDetected = true and it is the weakest', () => {
    // All categories at 85 except supply_side at 0 — must surface for marketplace.
    const confidence = { ...makeConfidence(85), supply_side: 0 }
    const result = detectWeakestCategory(confidence, [], {}, false, true)
    expect(result).toBe('supply_side')
  })

  it('does not return supply_side when stronger gaps exist and marketplaceDetected = true', () => {
    // pricing at 0 has large gap × importance; supply_side at 50 — pricing should win.
    const confidence = { ...makeConfidence(85), supply_side: 50, pricing: 0 }
    const result = detectWeakestCategory(confidence, [], {}, false, true)
    expect(result).not.toBe('supply_side')
  })
})

describe('checkCompletion — supply_side gate (v2.2 PR3)', () => {
  it('does NOT require supply_side when marketplaceDetected = false', () => {
    // All 3 required categories at 80, supply_side at 0 — should complete for non-marketplace.
    expect(checkCompletion(makeConfidence(80), 0, 'building', 1, makeStrength(3), false)).toBe(true)
  })

  it('blocks completion when supply_side = 0 and marketplaceDetected = true', () => {
    // All required categories at 80 but supply_side at 0 — marketplace cannot complete.
    const confidence = { ...makeConfidence(80), supply_side: 0 }
    expect(checkCompletion(confidence, 0, 'building', 1, makeStrength(3), true)).toBe(false)
  })

  it('allows completion when supply_side is adequate and marketplaceDetected = true', () => {
    // All required categories + supply_side at 80 with strength-3 (ceiling 83 ≥ 80).
    expect(checkCompletion(makeConfidence(80), 0, 'building', 1, makeStrength(3), true)).toBe(true)
  })

  it('supply_side ceiling is applied like other required categories when marketplaceDetected = true', () => {
    // supply_side at 100 but strength-1 (ceiling 50) < threshold 80 — should block.
    const strength = makeStrength(3)
    const lowStrength = { ...strength, supply_side: 1 as EvidenceStrength }
    expect(checkCompletion(makeConfidence(80), 0, 'building', 1, lowStrength, true)).toBe(false)
  })
})

describe('computeOverallConfidence — supply_side weight (v2.2 PR3)', () => {
  it('uses TOTAL_WEIGHT_BASE (72) when marketplaceDetected = false', () => {
    expect(TOTAL_WEIGHT_BASE).toBe(72)
  })

  it('uses TOTAL_WEIGHT_MARKETPLACE (81) when marketplaceDetected = true', () => {
    expect(TOTAL_WEIGHT_MARKETPLACE).toBe(81)
  })

  it('TOTAL_WEIGHT_MARKETPLACE = TOTAL_WEIGHT_BASE + supply_side importance', () => {
    expect(TOTAL_WEIGHT_MARKETPLACE).toBe(TOTAL_WEIGHT_BASE + CATEGORY_IMPORTANCE['supply_side'])
  })

  it('supply_side is excluded from weighted sum for non-marketplace sessions', () => {
    // confidence = 100 for supply_side, 0 for all others — overall should be 0 (not supply_side-weighted).
    const confidence = { ...makeConfidence(0), supply_side: 100 }
    expect(computeOverallConfidence(confidence, false)).toBe(0)
  })

  it('supply_side contributes to weighted sum for marketplace sessions', () => {
    const confidence = { ...makeConfidence(0), supply_side: 100 }
    const result = computeOverallConfidence(confidence, true)
    // supply_side importance / TOTAL_WEIGHT_MARKETPLACE × 100, rounded
    const expected = Math.round((CATEGORY_IMPORTANCE['supply_side'] * 100) / TOTAL_WEIGHT_MARKETPLACE)
    expect(result).toBe(expected)
  })
})

describe('detectQuestioningMode — supply_side treated as done when not marketplace (v2.2 PR3)', () => {
  it('supply_side at 0 does NOT trigger gap_identification for non-marketplace sessions', () => {
    // Required + supporting categories all strong; supply_side = 0 — non-marketplace should reach gap_identification.
    // If supply_side were counted, the low confidence would block gap_identification mode.
    const confidence = { ...makeConfidence(85), supply_side: 0 }
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(85),
      categoryConfidence: confidence,
      marketplaceDetected: false,
    })
    // All real categories are strong → questioning mode should be gap_identification (supply_side ignored).
    expect(result.questioningMode).toBe('gap_identification')
  })

  it('supply_side at 0 DOES block gap_identification for marketplace sessions', () => {
    // Same setup but marketplace=true: supply_side=0 is a real gap, should stay in discovery.
    const confidence = { ...makeConfidence(85), supply_side: 0 }
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(85),
      categoryConfidence: confidence,
      marketplaceDetected: true,
    })
    expect(result.questioningMode).toBe('discovery')
  })
})

describe('buildUnderstanding — supply_side integration (v2.2 PR3)', () => {
  it('supply_side category exists in categories output', () => {
    const result = buildUnderstanding(minimalUnderstandingParams(50))
    expect(result.categories).toHaveProperty('supply_side')
  })

  it('supply_side stores the input confidence even for non-marketplace sessions (invisibility is behavioral, not data)', () => {
    // supply_side confidence is stored as-is; invisibility means it is excluded from
    // completion requirements and weighted calculations, not zeroed out in storage.
    const confidence = { ...makeConfidence(50), supply_side: 42 }
    const result = buildUnderstanding({ ...minimalUnderstandingParams(50), categoryConfidence: confidence })
    expect(result.categories.supply_side.confidence).toBe(42)
  })

  it('supply_side is invisible — non-marketplace session completes without supply_side', () => {
    // All required cats at threshold with adequate evidence, supply_side at 0, not marketplace.
    const result = buildUnderstanding({ ...minimalUnderstandingParams(THRESHOLD_COMPLETE), founderStage: 'building' })
    expect(result.isComplete).toBe(true)
  })

  it('marketplace session cannot complete with supply_side at 0', () => {
    const lowSupply = { ...makeConfidence(THRESHOLD_COMPLETE), supply_side: 0 }
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      categoryConfidence: lowSupply,
      marketplaceDetected: true,
      founderStage: 'building',
    })
    expect(result.isComplete).toBe(false)
  })

  it('marketplace session completes when supply_side reaches threshold with adequate evidence', () => {
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
      marketplaceDetected: true,
      founderStage: 'building',
    })
    expect(result.isComplete).toBe(true)
  })
})
