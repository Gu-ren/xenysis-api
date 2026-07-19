import {
  detectWeakestCategory,
  REQUIRED_CATEGORIES,
  SATURATION_THRESHOLD,
  REQUIRED_SATURATION_THRESHOLD,
  THRESHOLD_COMPLETE,
  type FounderUnderstanding,
  type UnderstandingCategory,
} from '../lib/contracts/founder-understanding.ts'
import {
  SLOT_ADVANCE_THRESHOLD,
  REQUIRED_SPRINT_THRESHOLD,
  SLOT_MUST_ELICIT,
  TOPIC_SLOTS,
  createEmptyInterviewCoverage,
  getIncompleteSlots,
  getSlotState,
  slotRecentlyAskedSimilar,
  type InterviewCoverage,
  type PlannedTopic,
  type QuestionDepth,
  type QuestionHistoryEntry,
} from '../lib/contracts/interview-coverage.ts'

export interface PlanNextQuestionParams {
  understanding: FounderUnderstanding
  coverage?: InterviewCoverage | null
  questionHistory?: QuestionHistoryEntry[]
  marketplaceDetected?: boolean
}

/**
 * Application decides what to ask next. Returns null when the session should close
 * (isComplete) — the chat prompt handles the closing message without a topic.
 */
export function planNextQuestion(params: PlanNextQuestionParams): PlannedTopic | null {
  const {
    understanding,
    coverage: rawCoverage,
    questionHistory = [],
    marketplaceDetected: seedMarketplace = false,
  } = params

  if (understanding.isComplete) return null

  const marketplaceDetected = seedMarketplace || understanding.marketplaceDetected
  const multiIcpDetected = understanding.multiIcpDetected
  const coverage = rawCoverage ?? understanding.interviewCoverage ?? createEmptyInterviewCoverage()

  // First turn: no category scores yet — foundation kickoff.
  if (understanding.weakestCategory === null && understanding.overallConfidence === 0) {
    return {
      category:   'problem',
      topicSlot:  'pain',
      depth:      'foundation',
      mustElicit: 'who has the problem, what pain they feel, and what you are building',
      reason:     'Foundation kickoff — elicit problem, customer, and solution in one turn',
    }
  }

  // Validation-planning takes priority when a gap category is saturated on assumptions.
  const validationCat = findValidationPlanningCandidate(understanding, marketplaceDetected)
  if (validationCat !== null) {
    const slot = pickSlot(coverage, validationCat, { multiIcpDetected, marketplaceDetected }, questionHistory)
      ?? TOPIC_SLOTS[validationCat][0]
    return buildPlan(validationCat, slot, 'validation_planning', 'Validation planning for explicitly unvalidated category')
  }

  // Adaptive depth: re-ask last planned slot if still below advance threshold.
  const lastPlanned = understanding.plannedTopic
  if (lastPlanned && lastPlanned.depth !== 'foundation' && lastPlanned.depth !== 'validation_planning') {
    const slotState = getSlotState(coverage, lastPlanned.category, lastPlanned.topicSlot)
    const catState = understanding.categories[lastPlanned.category]
    const satThreshold = isRequiredBelowComplete(lastPlanned.category, catState.confidence)
      ? REQUIRED_SATURATION_THRESHOLD
      : SATURATION_THRESHOLD
    const saturated = (catState.saturationCount ?? 0) >= satThreshold
      && !(lastPlanned.category === 'customer' && multiIcpDetected)

    if (
      slotState.status !== 'complete' &&
      slotState.confidence < SLOT_ADVANCE_THRESHOLD &&
      !saturated
    ) {
      const mustElicit = SLOT_MUST_ELICIT[lastPlanned.category][lastPlanned.topicSlot]
        ?? lastPlanned.mustElicit
      if (!slotRecentlyAskedSimilar(lastPlanned.category, lastPlanned.topicSlot, mustElicit, questionHistory)) {
        return buildPlan(
          lastPlanned.category,
          lastPlanned.topicSlot,
          'follow_up',
          `Adaptive depth — slot confidence ${slotState.confidence}% < ${SLOT_ADVANCE_THRESHOLD}`,
        )
      }
    }
  }

  // Required sprint: problem → customer → solution until each hits 60%.
  const sprintCat = getRequiredSprintCategory(understanding)
  if (sprintCat !== null) {
    const slot = pickSlot(coverage, sprintCat, { multiIcpDetected, marketplaceDetected }, questionHistory)
    if (slot) {
      return buildPlan(sprintCat, slot, 'discover', `Required sprint target: ${sprintCat}`)
    }
  }

  // Gap-identification with lagging required categories.
  if (understanding.questioningMode === 'gap_identification') {
    const lagging = REQUIRED_CATEGORIES.filter(
      (cat) => (understanding.categories[cat]?.confidence ?? 0) < THRESHOLD_COMPLETE,
    )
    if (lagging.length > 0) {
      const lowest = lagging.reduce((a, b) =>
        (understanding.categories[a].confidence <= understanding.categories[b].confidence ? a : b),
      )
      const slot = pickSlot(coverage, lowest, { multiIcpDetected, marketplaceDetected }, questionHistory)
      if (slot) {
        return buildPlan(lowest, slot, 'discover', `Gap identification — lowest required: ${lowest}`)
      }
    }
  }

  // Default: weakest category via existing priority formula, then first incomplete slot.
  const saturationCounts = Object.fromEntries(
    Object.entries(understanding.categories).map(([cat, state]) => [cat, state.saturationCount ?? 0]),
  ) as Partial<Record<UnderstandingCategory, number>>

  const categoryConfidence = Object.fromEntries(
    Object.entries(understanding.categories).map(([cat, state]) => [cat, state.confidence]),
  ) as Record<UnderstandingCategory, number>

  const weakest = detectWeakestCategory(
    categoryConfidence,
    understanding.focusHistory ?? [],
    saturationCounts,
    multiIcpDetected,
    marketplaceDetected,
  )

  const candidates = buildCandidateOrder(understanding, weakest, marketplaceDetected)
  for (const cat of candidates) {
    const slot = pickSlot(coverage, cat, { multiIcpDetected, marketplaceDetected }, questionHistory)
    if (slot) {
      return buildPlan(cat, slot, 'discover', `Weakest/priority category: ${cat}`)
    }
  }

  // Fallback: ask anything incomplete on weakest even if duplicate-filtered emptied the list.
  const fallbackSlot = getIncompleteSlots(coverage, weakest, { multiIcpDetected, marketplaceDetected })[0]
    ?? TOPIC_SLOTS[weakest][0]
  return buildPlan(weakest, fallbackSlot, 'discover', `Fallback to weakest category: ${weakest}`)
}

function getRequiredSprintCategory(understanding: FounderUnderstanding): UnderstandingCategory | null {
  for (const cat of REQUIRED_CATEGORIES) {
    if ((understanding.categories[cat]?.confidence ?? 0) < REQUIRED_SPRINT_THRESHOLD) return cat
  }
  return null
}

function isRequiredBelowComplete(category: UnderstandingCategory, confidence: number): boolean {
  return (REQUIRED_CATEGORIES as readonly UnderstandingCategory[]).includes(category)
    && confidence < THRESHOLD_COMPLETE
}

function findValidationPlanningCandidate(
  understanding: FounderUnderstanding,
  marketplaceDetected: boolean,
): UnderstandingCategory | null {
  for (const cat of Object.keys(understanding.categories) as UnderstandingCategory[]) {
    if (cat === 'supply_side' && !marketplaceDetected) continue
    const state = understanding.categories[cat]
    if (
      state.validationStatus === 'explicitly_unvalidated' &&
      (state.saturationCount ?? 0) >= 1 &&
      !state.validationPlanningCompleted
    ) {
      return cat
    }
  }
  return null
}

function buildCandidateOrder(
  understanding: FounderUnderstanding,
  weakest: UnderstandingCategory,
  marketplaceDetected: boolean,
): UnderstandingCategory[] {
  const order: UnderstandingCategory[] = [weakest]
  const rest = (Object.keys(understanding.categories) as UnderstandingCategory[])
    .filter((c) => c !== weakest)
    .filter((c) => !(c === 'supply_side' && !marketplaceDetected))
    .sort((a, b) => understanding.categories[a].confidence - understanding.categories[b].confidence)
  return [...order, ...rest]
}

function pickSlot(
  coverage: InterviewCoverage,
  category: UnderstandingCategory,
  options: { multiIcpDetected?: boolean; marketplaceDetected?: boolean },
  history: QuestionHistoryEntry[],
): string | null {
  const incomplete = getIncompleteSlots(coverage, category, options)
  for (const slot of incomplete) {
    const mustElicit = SLOT_MUST_ELICIT[category][slot] ?? slot
    if (slotRecentlyAskedSimilar(category, slot, mustElicit, history)) continue
    return slot
  }
  // Prefer any incomplete even if similar, so we don't stall.
  return incomplete[0] ?? null
}

function buildPlan(
  category: UnderstandingCategory,
  topicSlot: string,
  depth: QuestionDepth,
  reason: string,
): PlannedTopic {
  const mustElicit = SLOT_MUST_ELICIT[category][topicSlot]
    ?? `details about ${topicSlot.replace(/_/g, ' ')}`
  return { category, topicSlot, depth, mustElicit, reason }
}

/** Canonical phrase used for duplicate checks against planned topic intent. */
export function plannedTopicFingerprint(plan: PlannedTopic): string {
  return `${plan.category} ${plan.topicSlot} ${plan.mustElicit} ${plan.depth}`
}
