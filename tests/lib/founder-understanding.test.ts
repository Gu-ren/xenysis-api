import { describe, it, expect } from 'vitest'
import {
  checkCompletion,
  buildUnderstanding,
  detectWeakestCategory,
  THRESHOLD_COMPLETE,
  THRESHOLD_HYPOTHESIS,
  REQUIRED_CATEGORIES,
  UNDERSTANDING_CATEGORIES,
  SATURATION_THRESHOLD,
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

function minimalUnderstandingParams(confidenceValue: number, strength: EvidenceStrength = 1) {
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
    it('returns true when all required categories are at THRESHOLD_COMPLETE', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'building', 1)).toBe(true)
    })

    it('returns true when required categories exceed THRESHOLD_COMPLETE', () => {
      expect(checkCompletion(makeConfidence(95), 0, 'building', 1)).toBe(true)
    })

    it('returns false when required categories are at THRESHOLD_HYPOTHESIS but below THRESHOLD_COMPLETE', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_HYPOTHESIS), 0, 'building', 1)).toBe(false)
    })

    it('returns false when required categories are at 79', () => {
      expect(checkCompletion(makeConfidence(79), 0, 'building', 1)).toBe(false)
    })

    it('returns false when any required category is below threshold', () => {
      const conf = makeConfidence(90)
      conf.problem = 50
      expect(checkCompletion(conf, 0, 'building', 1)).toBe(false)
    })

    it('returns true even when supporting categories are well below threshold', () => {
      const conf = makeConfidence(THRESHOLD_COMPLETE)
      conf.market      = 10
      conf.pricing     = 5
      conf.competition = 20
      expect(checkCompletion(conf, 0, 'building', 1)).toBe(true)
    })
  })

  describe('revenue stage', () => {
    it('uses THRESHOLD_COMPLETE (same as building)', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'revenue', 1)).toBe(true)
      expect(checkCompletion(makeConfidence(79), 0, 'revenue', 1)).toBe(false)
    })
  })

  describe('idea stage', () => {
    it('returns true at THRESHOLD_HYPOTHESIS (60) with low evidence', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_HYPOTHESIS), 0, 'idea', 1)).toBe(true)
    })

    it('returns true at 61 with low evidence', () => {
      expect(checkCompletion(makeConfidence(61), 0, 'idea', 1)).toBe(true)
    })

    it('returns false at 59 with low evidence', () => {
      expect(checkCompletion(makeConfidence(59), 0, 'idea', 1)).toBe(false)
    })

    it('returns false when any required category is below THRESHOLD_HYPOTHESIS', () => {
      const conf = makeConfidence(70)
      conf.customer = 55
      expect(checkCompletion(conf, 0, 'idea', 1)).toBe(false)
    })
  })

  describe('evidence floor', () => {
    it('escalates threshold to THRESHOLD_COMPLETE when maxEvidenceStrength >= 4 on idea stage', () => {
      // confidence=60 is enough for idea stage, but evidence floor fires at strength=4
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 4)).toBe(false)
    })

    it('escalates threshold at strength=5', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 5)).toBe(false)
    })

    it('escalates threshold at strength=6', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 6)).toBe(false)
    })

    it('does NOT escalate at strength=3 — idea stage threshold stays at 60', () => {
      expect(checkCompletion(makeConfidence(60), 0, 'idea', 3)).toBe(true)
    })

    it('returns true at THRESHOLD_COMPLETE with evidence floor active', () => {
      expect(checkCompletion(makeConfidence(THRESHOLD_COMPLETE), 0, 'idea', 4)).toBe(true)
    })

    it('applies evidence floor even when founderStage is building (no effective change since threshold is already 80)', () => {
      expect(checkCompletion(makeConfidence(79), 0, 'building', 4)).toBe(false)
      expect(checkCompletion(makeConfidence(80), 0, 'building', 4)).toBe(true)
    })
  })

  describe('defaults', () => {
    it('defaults to building stage when no stage provided', () => {
      // No founderStage arg — should behave as building (threshold=80)
      expect(checkCompletion(makeConfidence(60), 0)).toBe(false)
      expect(checkCompletion(makeConfidence(80), 0)).toBe(true)
    })

    it('defaults to maxEvidenceStrength=1 when not provided', () => {
      // idea stage with default strength — should use THRESHOLD_HYPOTHESIS
      expect(checkCompletion(makeConfidence(60), 0, 'idea')).toBe(true)
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
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
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

  it('captures required categories in gapsInBlueprint when explicitly_unvalidated at completion', () => {
    // Edge: required categories can still be explicitly_unvalidated at completion
    // (confidence can be high via detailed hypotheses even without external evidence)
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_COMPLETE),
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
    const result = buildUnderstanding({
      ...minimalUnderstandingParams(THRESHOLD_HYPOTHESIS),
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
