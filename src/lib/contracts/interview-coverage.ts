import { z } from 'zod'
import type { UnderstandingCategory } from './founder-understanding.ts'

// Local category list mirrors UNDERSTANDING_CATEGORIES — avoid circular value import.
const COVERAGE_CATEGORIES = [
  'problem',
  'customer',
  'solution',
  'market',
  'pricing',
  'competition',
  'risks',
  'founder_fit',
  'supply_side',
] as const satisfies readonly UnderstandingCategory[]

// ── Topic slots — drive question selection only; category confidence still gates OA/completion ─

export const TOPIC_SLOTS = {
  problem:     ['pain', 'workaround', 'cost_of_status_quo', 'frequency'],
  customer:    ['buyer_title', 'company_size', 'purchase_trigger', 'segments', 'beachhead'],
  solution:    ['mechanism', 'differentiation', 'why_better'],
  market:      ['size', 'growth', 'timing'],
  pricing:     ['revenue_model', 'price_point', 'willingness_to_pay'],
  competition: ['named_alternatives', 'switch_reason'],
  risks:       ['biggest_threat', 'key_assumption'],
  founder_fit: ['domain_expertise', 'customer_access', 'execution'],
  supply_side: ['recruitment', 'onboarding', 'quality_control'],
} as const satisfies Record<UnderstandingCategory, readonly string[]>

export type TopicSlotId = (typeof TOPIC_SLOTS)[UnderstandingCategory][number]

export const SLOT_MUST_ELICIT: Record<UnderstandingCategory, Record<string, string>> = {
  problem: {
    pain:               'the specific pain or unmet need',
    workaround:         'what they do today without a solution',
    cost_of_status_quo: 'the cost, time, or risk of the current workaround',
    frequency:          'how often the pain occurs',
  },
  customer: {
    buyer_title:      'job title of the buyer',
    company_size:     'company type and size',
    purchase_trigger: 'what triggers a purchase decision',
    segments:         'distinct customer segments',
    beachhead:        'which segment or side they acquire first',
  },
  solution: {
    mechanism:        'how the product works at a concrete level',
    differentiation:  'why it beats the current alternative',
    why_better:       'the core reason customers would switch',
  },
  market: {
    size:   'market size estimate (TAM/SAM/SOM style)',
    growth: 'growth signal or trend',
    timing: 'why now',
  },
  pricing: {
    revenue_model:      'subscription, usage, marketplace, or other model',
    price_point:        'hypothesized price point',
    willingness_to_pay: 'any signal of willingness to pay',
  },
  competition: {
    named_alternatives: 'named competitors or alternatives',
    switch_reason:      'why customers would switch away from them',
  },
  risks: {
    biggest_threat: 'the biggest threat to viability',
    key_assumption: 'the key unproven assumption',
  },
  founder_fit: {
    domain_expertise: 'domain expertise',
    customer_access:  'existing customer relationships or access',
    execution:        'execution capability or track record',
  },
  supply_side: {
    recruitment:     'how supply-side participants are recruited',
    onboarding:      'supply-side onboarding or retention',
    quality_control: 'how supply quality is ensured',
  },
}

export const SLOT_ADVANCE_THRESHOLD = 60
export const REQUIRED_SPRINT_THRESHOLD = 60
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.72
export const MAX_QUESTION_HISTORY = 40

export const SlotStatusSchema = z.enum(['missing', 'partial', 'complete'])
export type SlotStatus = z.infer<typeof SlotStatusSchema>

export const TopicSlotStateSchema = z.object({
  status:           SlotStatusSchema.default('missing'),
  confidence:       z.number().int().min(0).max(100).default(0),
  evidenceSnippets: z.array(z.string().max(200)).max(5).default([]),
  lastAskedAtTurn:  z.number().int().min(0).nullable().default(null),
})
export type TopicSlotState = z.infer<typeof TopicSlotStateSchema>

export const EMPTY_SLOT_STATE: TopicSlotState = {
  status:           'missing',
  confidence:       0,
  evidenceSnippets: [],
  lastAskedAtTurn:  null,
}

function emptyCategorySlots(category: UnderstandingCategory): Record<string, TopicSlotState> {
  return Object.fromEntries(
    TOPIC_SLOTS[category].map((slot) => [slot, { ...EMPTY_SLOT_STATE }]),
  )
}

export function createEmptyInterviewCoverage(): InterviewCoverage {
  return {
    slots: Object.fromEntries(
      COVERAGE_CATEGORIES.map((cat) => [cat, emptyCategorySlots(cat)]),
    ) as InterviewCoverage['slots'],
    turnCount: 0,
  }
}

export const InterviewCoverageSchema = z.object({
  slots:     z.record(z.string(), z.record(z.string(), TopicSlotStateSchema)).default({}),
  turnCount: z.number().int().min(0).default(0),
})
export type InterviewCoverage = {
  slots: Record<UnderstandingCategory, Record<string, TopicSlotState>>
  turnCount: number
}

const CategoryEnum = z.enum(COVERAGE_CATEGORIES)

export const TopicSlotUpdateSchema = z.object({
  category:   CategoryEnum,
  slot:       z.string().min(1).max(64),
  confidence: z.number().int().min(0).max(100),
  evidence:   z.string().max(200).default(''),
})
export type TopicSlotUpdate = z.infer<typeof TopicSlotUpdateSchema>

export const TopicSlotUpdatesSchema = z.array(TopicSlotUpdateSchema).max(12)
export type TopicSlotUpdates = z.infer<typeof TopicSlotUpdatesSchema>

export const QuestionDepthSchema = z.enum(['discover', 'follow_up', 'validation_planning', 'foundation'])
export type QuestionDepth = z.infer<typeof QuestionDepthSchema>

export const PlannedTopicSchema = z.object({
  category:   CategoryEnum,
  topicSlot:  z.string().min(1),
  depth:      QuestionDepthSchema,
  mustElicit: z.string().min(1),
  reason:     z.string().min(1),
})
export type PlannedTopic = z.infer<typeof PlannedTopicSchema>

export const QuestionHistoryEntrySchema = z.object({
  text:      z.string().min(1).max(2000),
  category:  CategoryEnum,
  topicSlot: z.string().min(1),
  turn:      z.number().int().min(0),
})
export type QuestionHistoryEntry = z.infer<typeof QuestionHistoryEntrySchema>

function confidenceToSlotStatus(confidence: number): SlotStatus {
  if (confidence >= SLOT_ADVANCE_THRESHOLD) return 'complete'
  if (confidence >= 30) return 'partial'
  return 'missing'
}

function isValidSlot(category: UnderstandingCategory, slot: string): boolean {
  return (TOPIC_SLOTS[category] as readonly string[]).includes(slot)
}

/** Merge extraction hits into coverage. One answer can complete multiple slots (sufficiency). */
export function mergeInterviewCoverage(
  existing: InterviewCoverage | null | undefined,
  updates: TopicSlotUpdate[],
  options: {
    turnCount?: number
    askedSlot?: { category: UnderstandingCategory; topicSlot: string } | null
    multiIcpDetected?: boolean
    marketplaceDetected?: boolean
  } = {},
): InterviewCoverage {
  const base = existing?.slots
    ? structuredClone({
        slots: normalizeCoverageSlots(existing.slots),
        turnCount: existing.turnCount ?? 0,
      })
    : createEmptyInterviewCoverage()

  const turnCount = options.turnCount ?? base.turnCount + 1
  base.turnCount = turnCount

  if (options.askedSlot && isValidSlot(options.askedSlot.category, options.askedSlot.topicSlot)) {
    const slotState = base.slots[options.askedSlot.category][options.askedSlot.topicSlot]
    if (slotState) slotState.lastAskedAtTurn = turnCount
  }

  for (const update of updates) {
    if (!isValidSlot(update.category, update.slot)) continue
    const prev = base.slots[update.category][update.slot] ?? { ...EMPTY_SLOT_STATE }
    const confidence = Math.max(prev.confidence, update.confidence)
    const evidenceSnippets = [...prev.evidenceSnippets]
    if (update.evidence && !evidenceSnippets.includes(update.evidence)) {
      evidenceSnippets.push(update.evidence)
    }
    base.slots[update.category][update.slot] = {
      status:           confidenceToSlotStatus(confidence),
      confidence,
      evidenceSnippets: evidenceSnippets.slice(0, 5),
      lastAskedAtTurn:  prev.lastAskedAtTurn,
    }
  }

  return base
}

function normalizeCoverageSlots(
  slots: InterviewCoverage['slots'] | Record<string, Record<string, TopicSlotState>>,
): InterviewCoverage['slots'] {
  const empty = createEmptyInterviewCoverage().slots
  for (const cat of COVERAGE_CATEGORIES) {
    const incoming = slots[cat] ?? {}
    for (const slotId of TOPIC_SLOTS[cat]) {
      const raw = incoming[slotId]
      if (raw) {
        empty[cat][slotId] = TopicSlotStateSchema.parse(raw)
      }
    }
  }
  return empty
}

export function getIncompleteSlots(
  coverage: InterviewCoverage,
  category: UnderstandingCategory,
  options: { multiIcpDetected?: boolean; marketplaceDetected?: boolean } = {},
): string[] {
  const slots = TOPIC_SLOTS[category].filter((slot) => {
    if (slot === 'beachhead' && !options.multiIcpDetected) return false
    if (category === 'supply_side' && !options.marketplaceDetected) return false
    return true
  })

  return slots.filter((slot) => {
    const state = coverage.slots[category]?.[slot]
    return !state || state.status !== 'complete'
  })
}

export function getSlotState(
  coverage: InterviewCoverage,
  category: UnderstandingCategory,
  slot: string,
): TopicSlotState {
  return coverage.slots[category]?.[slot] ?? { ...EMPTY_SLOT_STATE }
}

/** Normalize question text for lexical similarity. */
export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<answer_choices>[\s\S]*?<\/answer_choices>/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(text: string): Set<string> {
  return new Set(normalizeQuestionText(text).split(' ').filter((t) => t.length > 2))
}

/** Jaccard similarity on token sets. */
export function questionSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const t of ta) {
    if (tb.has(t)) intersection++
  }
  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function isDuplicateQuestion(
  candidateText: string,
  history: QuestionHistoryEntry[],
  threshold: number = DUPLICATE_SIMILARITY_THRESHOLD,
): boolean {
  return history.some((entry) => questionSimilarity(candidateText, entry.text) >= threshold)
}

/** True when the same category+slot has been asked enough that we should rotate. */
export function slotRecentlyAskedSimilar(
  category: UnderstandingCategory,
  topicSlot: string,
  mustElicit: string,
  history: QuestionHistoryEntry[],
  threshold: number = DUPLICATE_SIMILARITY_THRESHOLD,
): boolean {
  const recent = history.filter((h) => h.category === category && h.topicSlot === topicSlot)
  if (recent.length === 0) return false
  if (recent.length >= 2) return true
  return recent.some((h) => questionSimilarity(mustElicit, h.text) >= threshold)
}

export function appendQuestionHistory(
  history: QuestionHistoryEntry[],
  entry: QuestionHistoryEntry,
): QuestionHistoryEntry[] {
  return [...history, entry].slice(-MAX_QUESTION_HISTORY)
}
