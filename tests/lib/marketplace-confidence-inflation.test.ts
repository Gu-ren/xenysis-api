/**
 * Runtime simulation: marketplace supply-side confidence-inflation fix.
 *
 * Scenario: "Marketplace connecting photographers with studio venues."
 * Founder turns:
 *   T0  "I'm building a marketplace connecting photographers with studio venues."
 *   T1  "I haven't spoken with any studio owners."
 *   T2  "I don't know whether they would actually list their studios."
 *   T3  "That's currently an assumption."
 *   T4  "I would need to interview studio owners first."
 *
 * The tests run the actual engine functions (mergeFounderMemory + buildUnderstanding)
 * with controlled extraction outputs — the same outputs the fixed extraction LLM
 * would produce given the ABSENCE STATEMENTS ARE NOT CATEGORY EVIDENCE rule.
 *
 * Two suites:
 *   A) PRE-FIX (broken) — absence turns produce non-empty evidence; confidence inflates;
 *      saturationCount never accumulates; validationPlanningCandidate never activates.
 *   B) POST-FIX (correct) — absence turns produce [] evidence; confidence stays flat;
 *      saturationCount accumulates; validationPlanningCandidate activates after T1.
 */

import { describe, it, expect } from 'vitest'
import {
  buildUnderstanding,
  EMPTY_UNDERSTANDING,
  UNDERSTANDING_CATEGORIES,
  type FounderUnderstanding,
  type UnderstandingCategory,
  type EvidenceStrength,
  type ValidationStatus,
  type AbsenceSignalStrength,
} from '../../src/lib/contracts/founder-understanding.ts'
import {
  mergeFounderMemory,
  EMPTY_FOUNDER_MEMORY,
  type FounderMemory,
} from '../../src/lib/contracts/founder-memory.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

type TurnState = {
  understanding: FounderUnderstanding
  memory:        FounderMemory
}

/** Extract the params buildUnderstanding needs from a stored understanding — mirrors updateUnderstanding. */
function stateFromUnderstanding(u: FounderUnderstanding) {
  return {
    existingEvidence: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].evidence]),
    ) as Record<UnderstandingCategory, string[]>,
    existingValidationStatus: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, (u.categories[c].validationStatus ?? 'unknown') as ValidationStatus]),
    ) as Record<UnderstandingCategory, ValidationStatus>,
    existingWeakAbsenceCounts: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].weakAbsenceCount ?? 0]),
    ) as Record<UnderstandingCategory, number>,
    existingSaturationCounts: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].saturationCount ?? 0]),
    ) as Record<UnderstandingCategory, number>,
    existingLastFocusConfidence: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].lastFocusConfidence ?? 0]),
    ) as Record<UnderstandingCategory, number>,
    existingValidationPlanningCompleted: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].validationPlanningCompleted ?? false]),
    ) as Record<UnderstandingCategory, boolean>,
    // focusHistory: prepend the previous weakestCategory, mirroring updateUnderstanding lines 115-117.
    focusHistory: u.weakestCategory
      ? [u.weakestCategory, ...(u.focusHistory ?? [])].slice(0, 5)
      : (u.focusHistory ?? []),
    multiIcpDetected:    u.multiIcpDetected,
    marketplaceDetected: u.marketplaceDetected,
    pivotDetected:       u.pivotDetected,
    existingPivotCount:  u.pivotCount,
    existingHasExternalContact: Object.fromEntries(
      UNDERSTANDING_CATEGORIES.map((c) => [c, u.categories[c].hasExternalContact ?? false]),
    ) as Record<UnderstandingCategory, boolean>,
  }
}

/** Compute validationPlanningCandidate — mirrors the pre-scan in buildChatSystemPrompt lines 267-275. */
function validationPlanningCandidate(u: FounderUnderstanding): UnderstandingCategory | null {
  return UNDERSTANDING_CATEGORIES.find((cat) => {
    if (cat === 'supply_side' && !u.marketplaceDetected) return false
    const s = u.categories[cat]
    return (
      s.validationStatus === 'explicitly_unvalidated' &&
      s.saturationCount >= 1 &&
      !s.validationPlanningCompleted
    )
  }) ?? null
}

/** Human-readable focus description for a stored understanding — mirrors buildChatSystemPrompt routing. */
function describeFocus(u: FounderUnderstanding): string {
  const vpc = validationPlanningCandidate(u)
  if (vpc !== null) return `${vpc} → VALIDATION PLANNING`
  const w = u.weakestCategory
  if (w === 'supply_side' && u.marketplaceDetected) {
    const isGap = u.categories.supply_side.validationStatus === 'explicitly_unvalidated'
    return `supply_side → ${isGap ? 'gap probe (understanding-seeking)' : 'standard supply-side probe'}`
  }
  return `${w} → standard probe`
}

/**
 * Simulate one turn of the engine:
 *   1. mergeFounderMemory(existingMemory, extracted) → merged memory
 *   2. Extract state params from existing understanding
 *   3. buildUnderstanding(merged memory + state params) → new understanding
 */
function simulateTurn(
  prev: TurnState,
  extracted: Partial<FounderMemory> & { category_evidence_strength?: Record<UnderstandingCategory, EvidenceStrength> },
): TurnState {
  const memory = mergeFounderMemory(prev.memory, extracted)

  const categoryStrength = (memory.category_evidence_strength ?? {}) as Record<UnderstandingCategory, EvidenceStrength>
  const maxEvidenceStrength = Math.max(
    ...UNDERSTANDING_CATEGORIES.map((c) => categoryStrength[c] ?? 1),
  ) as EvidenceStrength

  const state = stateFromUnderstanding(prev.understanding)

  const understanding = buildUnderstanding({
    categoryConfidence: memory.category_confidence,
    categoryEvidence:   memory.category_evidence,
    categoryStrength,
    maxEvidenceStrength,
    founderStage:       'building',
    absenceSignals:     (memory.category_absence_signals ?? {}) as Record<UnderstandingCategory, AbsenceSignalStrength>,
    hasExternalContactThisTurn: (memory.category_has_external_contact ?? {}) as Record<UnderstandingCategory, boolean>,
    ...state,
  })

  return { understanding, memory }
}

// ── Shared confidence map builders ────────────────────────────────────────────

function makeConf(values: Partial<Record<UnderstandingCategory, number>>): Record<UnderstandingCategory, number> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, values[c] ?? 0])) as Record<UnderstandingCategory, number>
}

function makeStr(values: Partial<Record<UnderstandingCategory, EvidenceStrength>>): Record<UnderstandingCategory, EvidenceStrength> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, values[c] ?? (1 as EvidenceStrength)])) as Record<UnderstandingCategory, EvidenceStrength>
}

function makeEvidence(values: Partial<Record<UnderstandingCategory, string[]>> = {}): Record<UnderstandingCategory, string[]> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, values[c] ?? []])) as Record<UnderstandingCategory, string[]>
}

function makeAbsence(values: Partial<Record<UnderstandingCategory, AbsenceSignalStrength>>): Record<UnderstandingCategory, AbsenceSignalStrength> {
  return Object.fromEntries(UNDERSTANDING_CATEGORIES.map((c) => [c, values[c] ?? 'none'])) as Record<UnderstandingCategory, AbsenceSignalStrength>
}

// ── Baseline state: all non-supply categories already well-understood ─────────
// Represents a session where the advisor has already probed problem/customer/solution
// (each at 85%, strength-3) and supply_side has not yet been explored.
// This isolates supply_side saturation behaviour from other-category dynamics.
//
// Two corrections vs. a naive buildUnderstanding call:
//   1. memory.category_confidence is pre-populated at 85% for all non-supply categories so
//      the evidence gate preserves those scores across turns that only discuss supply_side.
//   2. weakestCategory is set to null so stateFromUnderstanding does NOT pre-seed
//      supply_side into focusHistory — saturation must start on the first real turn where
//      supply_side is targeted, not artificially on T0 due to baseline construction.

function makeBaselineState(): TurnState {
  const BASE = 85 as const
  const built = buildUnderstanding({
    categoryConfidence: makeConf({ problem: BASE, customer: BASE, solution: BASE, market: BASE, pricing: BASE, competition: BASE, risks: BASE, founder_fit: BASE, supply_side: 0 }),
    categoryEvidence:   makeEvidence(),
    categoryStrength:   makeStr({ problem: 3, customer: 3, solution: 3, market: 3, pricing: 3, competition: 3, risks: 3, founder_fit: 3, supply_side: 1 }),
    maxEvidenceStrength: 3 as EvidenceStrength,
    founderStage:       'building',
    marketplaceDetected: true,
    multiIcpDetected:    true,
    existingEvidence:    makeEvidence(),
  })
  const understanding: FounderUnderstanding = {
    ...built,
    weakestCategory: null,  // no category has been "focused" yet — prevents T0 off-by-one saturation
  }
  const memory: FounderMemory = {
    ...EMPTY_FOUNDER_MEMORY,
    marketplace_detected: true,
    multi_icp_detected:   true,
    category_confidence:  makeConf({ problem: BASE, customer: BASE, solution: BASE, market: BASE, pricing: BASE, competition: BASE, risks: BASE, founder_fit: BASE, supply_side: 0 }),
  }
  return { understanding, memory }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Suite A — PRE-FIX (broken) behavior
//  Absence turns produce non-empty evidence → confidence inflates → saturation
//  never accumulates → validationPlanningCandidate never activates.
// ─────────────────────────────────────────────────────────────────────────────

describe('PRE-FIX (broken) — absence statements inflating confidence', () => {
  /**
   * Without the fix, the extraction LLM treats absence statements as evidence.
   * Each absence turn produces a non-empty category_evidence.supply_side and bumps
   * the confidence score slightly. The evidence gate opens → score updates each turn
   * → confDelta >= 5 → saturationCount resets every turn → validationPlanningCandidate
   * never fires.
   */

  it('demonstrates the broken inflation path over 5 turns', () => {
    let state = makeBaselineState()
    // baseline: supply_side at 0, validationStatus='unknown', saturationCount=0
    // weakestCategory is null because makeBaselineState() nulls it to avoid pre-seeding
    // supply_side into focusHistory — the engine recomputes it correctly after T0.
    expect(state.understanding.categories.supply_side.confidence).toBe(0)
    expect(state.understanding.categories.supply_side.saturationCount).toBe(0)
    expect(state.understanding.weakestCategory).toBeNull()

    // ── T0: startup description (some supply_side identification, no absence) ─
    // Pre-fix: extraction produces evidence even from the description.
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 12 }),
      category_evidence:          makeEvidence({ supply_side: ['Studio venues are supply-side participants in the marketplace'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({}),
    })
    expect(state.understanding.categories.supply_side.confidence).toBe(12)
    expect(state.understanding.categories.supply_side.saturationCount).toBe(0)  // not lastFocus on T0
    expect(state.understanding.weakestCategory).toBe('supply_side')

    // ── T1: "I haven't spoken with any studio owners." ─────────────────────
    // Pre-fix: LLM extracts absence statement as evidence; confidence updates.
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 18 }),
      category_evidence:          makeEvidence({ supply_side: ['Founder has not spoken with any studio owners'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'strong' }),
    })
    // Evidence gate opened (non-empty evidence) → confidence updated 12→18 → delta=6 ≥ 5 → count RESETS
    const ss1 = state.understanding.categories.supply_side
    expect(ss1.validationStatus).toBe('explicitly_unvalidated')  // strong signal promoted
    expect(ss1.confidence).toBe(18)                              // inflated
    expect(ss1.saturationCount).toBe(0)                         // delta=6 reset the counter

    // ── T2: "I don't know whether they would actually list their studios." ──
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 24 }),
      category_evidence:          makeEvidence({ supply_side: ['Founder uncertain whether studio owners would list their spaces'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),
    })
    const ss2 = state.understanding.categories.supply_side
    expect(ss2.confidence).toBe(24)   // inflated again
    expect(ss2.saturationCount).toBe(0)  // delta=6 ≥ 5 → reset again

    // ── T3: "That's currently an assumption." ──────────────────────────────
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 29 }),
      category_evidence:          makeEvidence({ supply_side: ['Studio owner participation is currently an assumption'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),
    })
    const ss3 = state.understanding.categories.supply_side
    expect(ss3.confidence).toBe(29)
    expect(ss3.saturationCount).toBe(0)  // delta=5 ≥ 5 → RESET (just at threshold)

    // ── T4: "I would need to interview studio owners first." ───────────────
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 34 }),
      category_evidence:          makeEvidence({ supply_side: ['Founder plans to interview studio owners before proceeding'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),
    })
    const ss4 = state.understanding.categories.supply_side

    // Final broken state:
    expect(ss4.validationStatus).toBe('explicitly_unvalidated')
    expect(ss4.confidence).toBe(34)       // drifted up from 0 to 34 across 5 turns
    expect(ss4.saturationCount).toBe(0)   // NEVER accumulated — always reset by inflation

    // The critical failure: validationPlanningCandidate never activates.
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
    // Focus drifted away from supply_side entirely due to cooling — never reached validation planning.
    // (supply_side accumulated so many cooling penalties that customer overtook it as weakest.)
    expect(describeFocus(state.understanding)).not.toMatch(/VALIDATION PLANNING/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Suite B — POST-FIX (correct) behavior
//  Absence turns produce [] evidence → evidence gate stays closed → confidence
//  stays flat → saturationCount accumulates → validationPlanningCandidate fires.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST-FIX (correct) — confidence stable, saturation accumulates', () => {
  /**
   * With the fix, absence statements populate category_absence_signals only.
   * category_evidence.supply_side = [] for every absence turn.
   * The evidence gate in mergeFounderMemory stays closed → confidence does NOT update.
   * confDelta = 0 on each consecutive supply_side focus turn → saturationCount
   * increments → validationPlanningCandidate activates after Turn 1.
   */

  // We run all 5 turns and collect intermediate state for assertions.
  // Each turn is a separate 'it' block driven by a shared mutable cursor.

  let state: TurnState = makeBaselineState()

  it('baseline: supply_side is weakest, validationStatus unknown', () => {
    const ss = state.understanding.categories.supply_side
    expect(ss.confidence).toBe(0)
    expect(ss.validationStatus).toBe('unknown')
    expect(ss.saturationCount).toBe(0)
    expect(ss.validationPlanningCompleted).toBe(false)
    // weakestCategory is null in the baseline (nulled by makeBaselineState to avoid
    // pre-seeding supply_side into focusHistory). T0 will set it to supply_side.
    expect(state.understanding.weakestCategory).toBeNull()
    expect(state.understanding.marketplaceDetected).toBe(true)
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
  })

  it('T0 — startup description: supply_side identified but no evidence extracted yet', () => {
    // "I'm building a marketplace connecting photographers with studio venues."
    // Post-fix: the description names the marketplace concept but contains no operational
    // supply-side details → evidence = [] (no factual claims about acquisition/onboarding).
    // This is also the first turn, so lastFocusCat does not yet point at supply_side.
    state = simulateTurn(state, {
      marketplace_detected:       true,
      multi_icp_detected:         true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'none' }),
    })

    const ss = state.understanding.categories.supply_side
    expect(ss.confidence).toBe(0)          // gate closed → no change
    expect(ss.validationStatus).toBe('unknown')
    expect(ss.saturationCount).toBe(0)     // supply_side not yet lastFocusCat
    expect(ss.validationPlanningCompleted).toBe(false)
    expect(state.understanding.weakestCategory).toBe('supply_side')
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
    expect(describeFocus(state.understanding)).toMatch(/standard supply-side probe/)
  })

  it('T1 — "I haven\'t spoken with any studio owners.": status becomes explicitly_unvalidated, saturation begins', () => {
    // Post-fix: strong absence signal → category_absence_signals.supply_side = 'strong'
    //           no evidence items → category_evidence.supply_side = []
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),  // LLM score irrelevant — gate is closed
      category_evidence:          makeEvidence({ supply_side: [] }),  // FIXED: absence → []
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'strong' }),
    })

    const ss = state.understanding.categories.supply_side
    // Status: strong absence signal → immediately explicitly_unvalidated.
    expect(ss.validationStatus).toBe('explicitly_unvalidated')

    // Confidence: evidence gate was CLOSED (evidence=[]) → score unchanged at 0.
    expect(ss.confidence).toBe(0)

    // Saturation: supply_side WAS lastFocusCat (T0's weakestCategory = supply_side).
    //             confDelta = |0 - 0| = 0 < SATURATION_DELTA_THRESHOLD (5) → counter increments.
    expect(ss.saturationCount).toBe(1)

    // Latch: existingSat was 0 on T0 (< 1) → latch stays false this turn.
    expect(ss.validationPlanningCompleted).toBe(false)

    // validationPlanningCandidate — computed from THIS stored state:
    //   validationStatus = 'explicitly_unvalidated' ✓
    //   saturationCount = 1 >= 1                   ✓
    //   validationPlanningCompleted = false         ✓
    //   → candidate = 'supply_side'
    expect(validationPlanningCandidate(state.understanding)).toBe('supply_side')

    // The NEXT turn's system prompt will see this state and fire VALIDATION PLANNING.
    expect(describeFocus(state.understanding)).toBe('supply_side → VALIDATION PLANNING')
  })

  it('T2 — "I don\'t know whether they would actually list their studios.": validation planning latch sets', () => {
    // T2's system prompt was built using T1's state → fired VALIDATION PLANNING.
    // After T2's extraction, the latch sets (existingSat=1 && existingStatus='explicitly_unvalidated').
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),  // FIXED: uncertainty → []
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),  // hedge: "whether"
    })

    const ss = state.understanding.categories.supply_side
    expect(ss.validationStatus).toBe('explicitly_unvalidated')
    expect(ss.confidence).toBe(0)   // still flat

    // saturationCount: supply_side may or may not be lastFocusCat depending on
    // whether it remained weakestCategory on T1. In the baseline setup (all others at 85%,
    // supply_side the only gap), supply_side stays weakest even with cooling — so count increments.
    expect(ss.saturationCount).toBeGreaterThanOrEqual(1)

    // LATCH: existingSat=1 >= 1 AND existingStatus='explicitly_unvalidated' → TRUE.
    expect(ss.validationPlanningCompleted).toBe(true)

    // validationPlanningCandidate from T2's stored state:
    //   validationPlanningCompleted = true → EXCLUDED from pre-scan → null.
    expect(validationPlanningCandidate(state.understanding)).toBeNull()

    // Focus moves on — validation planning for supply_side is complete.
    // (Next turn's prompt routes to weakestCategory standard probe or another category.)
    expect(describeFocus(state.understanding)).not.toMatch(/VALIDATION PLANNING/)
  })

  it('T3 — "That\'s currently an assumption.": confidence still flat, latch holds', () => {
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),
    })

    const ss = state.understanding.categories.supply_side
    expect(ss.validationStatus).toBe('explicitly_unvalidated')
    expect(ss.confidence).toBe(0)             // never inflated
    expect(ss.validationPlanningCompleted).toBe(true)  // latch persists
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
  })

  it('T4 — "I would need to interview studio owners first.": same stable state', () => {
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'weak' }),
    })

    const ss = state.understanding.categories.supply_side
    expect(ss.validationStatus).toBe('explicitly_unvalidated')
    expect(ss.confidence).toBe(0)
    expect(ss.validationPlanningCompleted).toBe(true)
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Suite C — Mixed-turn behaviour: factual claim mid-absence sequence
//  If the founder makes a genuine factual claim about supply-side, evidence gate
//  SHOULD open, confidence SHOULD update, and saturation SHOULD reset.
//  This verifies the fix does not over-block legitimate evidence extraction.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST-FIX — mixed turn: factual claim resets saturation correctly', () => {
  it('a specific hypothesis about supply-side opens the gate and resets saturation', () => {
    let state = makeBaselineState()

    // T0: description — no supply_side evidence
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({}),
    })

    // T1: "I haven't spoken with studio owners" → absence → gate closed → satCount=1
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 0 }),
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'strong' }),
    })
    expect(state.understanding.categories.supply_side.saturationCount).toBe(1)
    expect(validationPlanningCandidate(state.understanding)).toBe('supply_side')

    // T2: Founder mixes a factual claim with continued absence.
    // "I haven't spoken with them, but I believe studios sit empty 40% of the time."
    //   → category_evidence = ["Founder believes studios sit empty ~40% of the time"] (factual hypothesis)
    //   → category_absence_signals = 'strong' (still no contact)
    //   → Gate OPENS (non-empty evidence) → confidence updates to 22
    state = simulateTurn(state, {
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 22 }),
      category_evidence:          makeEvidence({ supply_side: ['Founder believes studios sit empty approximately 40% of the time'] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'strong' }),
    })

    const ss = state.understanding.categories.supply_side
    // Evidence gate opened → confidence updated.
    expect(ss.confidence).toBe(22)
    // confDelta = |22 - 0| = 22 ≥ 5 → saturationCount RESETS.
    // (lastFocusConf was 0 from T1 where wasLastFocus=true)
    expect(ss.saturationCount).toBe(0)
    // validationPlanningCompleted latch also set from T1 state (existingSat=1, existingStatus=explicitly_unvalidated).
    expect(ss.validationPlanningCompleted).toBe(true)
    // Candidate already latched — null regardless of saturation reset.
    expect(validationPlanningCandidate(state.understanding)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  Suite D — Anchor block: supply_side score is stable across turns
//  Verifies the second part of the fix: the supply_side anchor in the extraction
//  prompt. In the engine, this manifests as the evidence gate keeping the score
//  stable (anchor is a prompt-level safeguard; the gate is the code-level one).
// ─────────────────────────────────────────────────────────────────────────────

describe('POST-FIX — evidence gate as code-level anchor for supply_side', () => {
  it('supply_side confidence does not change across 5 consecutive absence turns', () => {
    let state = makeBaselineState()

    const absenceTurn = (): Partial<FounderMemory> & { category_evidence_strength?: Record<UnderstandingCategory, EvidenceStrength> } => ({
      marketplace_detected:       true,
      category_confidence:        makeConf({ supply_side: 99 }),   // LLM assigns 99 — gate should block this
      category_evidence:          makeEvidence({ supply_side: [] }),
      category_evidence_strength: makeStr({ supply_side: 1 }),
      category_absence_signals:   makeAbsence({ supply_side: 'strong' }),
    })

    const confidencesAfterEachTurn: number[] = []
    for (let i = 0; i < 5; i++) {
      state = simulateTurn(state, absenceTurn())
      confidencesAfterEachTurn.push(state.understanding.categories.supply_side.confidence)
    }

    // Score must stay at 0 regardless of what the LLM assigned (99) — the gate prevents any update.
    expect(confidencesAfterEachTurn).toEqual([0, 0, 0, 0, 0])
  })
})
