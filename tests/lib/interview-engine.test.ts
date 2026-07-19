import { describe, it, expect } from 'vitest'
import {
  createEmptyInterviewCoverage,
  mergeInterviewCoverage,
  questionSimilarity,
  isDuplicateQuestion,
  slotRecentlyAskedSimilar,
  getIncompleteSlots,
  appendQuestionHistory,
  SLOT_ADVANCE_THRESHOLD,
  type QuestionHistoryEntry,
} from '../../src/lib/contracts/interview-coverage.ts'
import { planNextQuestion } from '../../src/services/interview-planner.ts'
import {
  EMPTY_UNDERSTANDING,
  type FounderUnderstanding,
  type UnderstandingCategory,
} from '../../src/lib/contracts/founder-understanding.ts'
import { buildChatSystemPrompt } from '../../src/modules/founder-sessions/chat-prompt.ts'
import type { Startup } from '../../src/lib/db/schema/startups.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

function withCategoryConfidence(
  base: FounderUnderstanding,
  conf: Partial<Record<UnderstandingCategory, number>>,
): FounderUnderstanding {
  const categories = { ...base.categories }
  for (const [cat, value] of Object.entries(conf) as [UnderstandingCategory, number][]) {
    categories[cat] = {
      ...categories[cat],
      confidence: value,
      status: value >= 80 ? 'complete' : value >= 30 ? 'partial' : 'missing',
    }
  }
  return {
    ...base,
    categories,
    overallConfidence: Math.round(
      Object.values(categories).reduce((s, c) => s + c.confidence, 0) / 9,
    ),
    weakestCategory: (Object.entries(categories).sort((a, b) => a[1].confidence - b[1].confidence)[0]?.[0]
      ?? 'problem') as UnderstandingCategory,
  }
}

const fakeStartup = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme',
  description: 'Test startup',
  category: 'SaaS',
  lifecycleStage: 'idea',
} as unknown as Startup

// ── Coverage merge / sufficiency ──────────────────────────────────────────────

describe('mergeInterviewCoverage', () => {
  it('marks multiple slots complete from one multi-topic answer', () => {
    const merged = mergeInterviewCoverage(createEmptyInterviewCoverage(), [
      { category: 'problem', slot: 'pain', confidence: 70, evidence: 'Invoice close takes 5 days' },
      { category: 'customer', slot: 'buyer_title', confidence: 65, evidence: 'Finance lead' },
      { category: 'solution', slot: 'mechanism', confidence: 60, evidence: 'Automated reconciliation' },
    ], { turnCount: 1 })

    expect(merged.slots.problem.pain.status).toBe('complete')
    expect(merged.slots.customer.buyer_title.status).toBe('complete')
    expect(merged.slots.solution.mechanism.status).toBe('complete')
    expect(merged.slots.problem.workaround.status).toBe('missing')
  })

  it('takes max confidence and appends unique evidence', () => {
    const first = mergeInterviewCoverage(null, [
      { category: 'problem', slot: 'pain', confidence: 40, evidence: 'Slow close' },
    ], { turnCount: 1 })
    const second = mergeInterviewCoverage(first, [
      { category: 'problem', slot: 'pain', confidence: 75, evidence: '5-day close' },
      { category: 'problem', slot: 'pain', confidence: 50, evidence: 'Slow close' },
    ], { turnCount: 2 })

    expect(second.slots.problem.pain.confidence).toBe(75)
    expect(second.slots.problem.pain.status).toBe('complete')
    expect(second.slots.problem.pain.evidenceSnippets).toEqual(['Slow close', '5-day close'])
  })

  it('records lastAskedAtTurn for the asked slot', () => {
    const merged = mergeInterviewCoverage(createEmptyInterviewCoverage(), [], {
      turnCount: 3,
      askedSlot: { category: 'pricing', topicSlot: 'price_point' },
    })
    expect(merged.slots.pricing.price_point.lastAskedAtTurn).toBe(3)
  })
})

// ── Duplicate checker ─────────────────────────────────────────────────────────

describe('questionSimilarity / isDuplicateQuestion', () => {
  it('detects near-duplicate questions via Jaccard tokens', () => {
    const a = 'Who is the exact buyer and what triggers their purchase?'
    const b = 'Who is the exact buyer and what triggers a purchase decision?'
    expect(questionSimilarity(a, b)).toBeGreaterThan(0.5)
    expect(isDuplicateQuestion(b, [{ text: a, category: 'customer', topicSlot: 'buyer_title', turn: 1 }], 0.5)).toBe(true)
  })

  it('does not flag unrelated questions as duplicates', () => {
    const a = 'What is your revenue model and price point?'
    const b = 'How do you recruit supply-side providers onto the platform?'
    expect(isDuplicateQuestion(b, [{ text: a, category: 'pricing', topicSlot: 'revenue_model', turn: 1 }])).toBe(false)
  })

  it('slotRecentlyAskedSimilar rotates after two asks on the same slot', () => {
    const history: QuestionHistoryEntry[] = [
      { text: 'What pain do customers feel?', category: 'problem', topicSlot: 'pain', turn: 1 },
      { text: 'Can you describe the pain in more detail?', category: 'problem', topicSlot: 'pain', turn: 2 },
    ]
    expect(slotRecentlyAskedSimilar('problem', 'pain', 'the specific pain', history)).toBe(true)
    expect(slotRecentlyAskedSimilar('problem', 'workaround', 'current workaround', history)).toBe(false)
  })
})

describe('appendQuestionHistory', () => {
  it('caps history length', () => {
    let history: QuestionHistoryEntry[] = []
    for (let i = 0; i < 45; i++) {
      history = appendQuestionHistory(history, {
        text: `Question number ${i} about the problem pain`,
        category: 'problem',
        topicSlot: 'pain',
        turn: i,
      })
    }
    expect(history.length).toBe(40)
    expect(history[0].turn).toBe(5)
  })
})

// ── Interview planner ─────────────────────────────────────────────────────────

describe('planNextQuestion', () => {
  it('returns foundation plan on empty understanding', () => {
    const plan = planNextQuestion({ understanding: EMPTY_UNDERSTANDING })
    expect(plan).not.toBeNull()
    expect(plan!.depth).toBe('foundation')
    expect(plan!.category).toBe('problem')
  })

  it('returns null when session is complete', () => {
    const understanding = { ...EMPTY_UNDERSTANDING, isComplete: true, weakestCategory: 'problem' as const }
    expect(planNextQuestion({ understanding })).toBeNull()
  })

  it('runs required sprint on problem before supporting categories', () => {
    const understanding = withCategoryConfidence(EMPTY_UNDERSTANDING, {
      problem: 20,
      customer: 10,
      solution: 10,
      market: 0,
      pricing: 0,
    })
    const plan = planNextQuestion({ understanding })
    expect(plan).not.toBeNull()
    expect(plan!.category).toBe('problem')
    expect(plan!.depth).toBe('discover')
  })

  it('skips completed slots and picks next incomplete slot', () => {
    const coverage = createEmptyInterviewCoverage()
    coverage.slots.problem.pain = {
      status: 'complete',
      confidence: 80,
      evidenceSnippets: ['pain'],
      lastAskedAtTurn: 1,
    }
    const understanding = withCategoryConfidence(EMPTY_UNDERSTANDING, {
      problem: 40,
      customer: 10,
      solution: 10,
    })
    const plan = planNextQuestion({ understanding, coverage })
    expect(plan!.category).toBe('problem')
    expect(plan!.topicSlot).not.toBe('pain')
  })

  it('applies adaptive depth follow-up when last slot is still incomplete', () => {
    const coverage = createEmptyInterviewCoverage()
    coverage.slots.problem.pain = {
      status: 'partial',
      confidence: 40,
      evidenceSnippets: ['vague pain'],
      lastAskedAtTurn: 1,
    }
    const understanding = withCategoryConfidence({
      ...EMPTY_UNDERSTANDING,
      plannedTopic: {
        category: 'problem',
        topicSlot: 'pain',
        depth: 'discover',
        mustElicit: 'the specific pain or unmet need',
        reason: 'prior',
      },
      questionHistory: [
        { text: 'What pain do customers feel each month?', category: 'problem', topicSlot: 'pain', turn: 1 },
      ],
    }, { problem: 40, customer: 70, solution: 70 })

    const plan = planNextQuestion({ understanding, coverage })
    expect(plan!.depth).toBe('follow_up')
    expect(plan!.topicSlot).toBe('pain')
  })

  it('rotates away from a slot that was asked twice (duplicate gate)', () => {
    const coverage = createEmptyInterviewCoverage()
    const history: QuestionHistoryEntry[] = [
      { text: 'What pain do customers feel?', category: 'problem', topicSlot: 'pain', turn: 1 },
      { text: 'Describe the pain again please?', category: 'problem', topicSlot: 'pain', turn: 2 },
    ]
    const understanding = withCategoryConfidence({
      ...EMPTY_UNDERSTANDING,
      plannedTopic: {
        category: 'problem',
        topicSlot: 'pain',
        depth: 'follow_up',
        mustElicit: 'the specific pain or unmet need',
        reason: 'prior',
      },
      questionHistory: history,
    }, { problem: 35, customer: 70, solution: 70 })

    coverage.slots.problem.pain = {
      status: 'partial',
      confidence: 35,
      evidenceSnippets: [],
      lastAskedAtTurn: 2,
    }

    const plan = planNextQuestion({ understanding, coverage, questionHistory: history })
    // Should not stay on pain forever — either different slot or still pain via fallback
    expect(plan).not.toBeNull()
    if (plan!.depth === 'follow_up') {
      // follow_up only if slotRecentlyAskedSimilar returned false — with 2 history entries it should rotate
      expect(plan!.topicSlot).not.toBe('pain')
    } else {
      expect(plan!.topicSlot).not.toBe('pain')
    }
  })
})

// ── Prompt hard-injection ─────────────────────────────────────────────────────

describe('buildChatSystemPrompt planned topic', () => {
  it('injects PLANNED TOPIC hard rules when planner provides a topic', () => {
    const understanding = withCategoryConfidence(EMPTY_UNDERSTANDING, {
      problem: 40,
      customer: 50,
      solution: 30,
    })
    const prompt = buildChatSystemPrompt(
      fakeStartup,
      null,
      understanding,
      'building',
      false,
      {
        category: 'solution',
        topicSlot: 'mechanism',
        depth: 'discover',
        mustElicit: 'what the product lets the user do — must-have features and outcomes (not how it is built)',
        reason: 'test',
      },
    )
    expect(prompt).toContain('PLANNED TOPIC (MANDATORY')
    expect(prompt).toContain('Topic slot: mechanism')
    expect(prompt).toContain('Do NOT switch to a different category or topic slot')
    expect(prompt).toContain('application selects the next topic')
    expect(prompt).toContain('FEATURES / OUTCOMES ONLY')
    expect(prompt).toContain('must-have features and outcomes')
  })

  it('includes CEO VOICE and bans tech/scalability questions', () => {
    const prompt = buildChatSystemPrompt(fakeStartup, null, EMPTY_UNDERSTANDING, 'building', false, null)
    expect(prompt).toContain('CEO VOICE')
    expect(prompt).toContain('NEVER ask about: tech stack')
    expect(prompt).toContain('scalability')
    expect(prompt).toContain('Xenysis will decide scalability')
  })

  it('does not inject planned topic when session is complete', () => {
    const understanding = {
      ...withCategoryConfidence(EMPTY_UNDERSTANDING, { problem: 90, customer: 90, solution: 90 }),
      isComplete: true,
    }
    const prompt = buildChatSystemPrompt(
      fakeStartup,
      null,
      understanding,
      'building',
      false,
      {
        category: 'pricing',
        topicSlot: 'price_point',
        depth: 'discover',
        mustElicit: 'price',
        reason: 'should be ignored',
      },
    )
    expect(prompt).toContain('SESSION STATUS: COMPLETE')
    expect(prompt).not.toContain('PLANNED TOPIC (MANDATORY')
  })
})

describe('CEO-aligned SLOT_MUST_ELICIT', () => {
  it('uses feature/outcome language for solution.mechanism', async () => {
    const { SLOT_MUST_ELICIT } = await import('../../src/lib/contracts/interview-coverage.ts')
    expect(SLOT_MUST_ELICIT.solution.mechanism).toMatch(/features|outcomes|lets the user do/i)
    expect(SLOT_MUST_ELICIT.solution.mechanism).not.toMatch(/how the product works at a concrete level/)
    expect(SLOT_MUST_ELICIT.market.size).toMatch(/widespread|who else/i)
    expect(SLOT_MUST_ELICIT.risks.biggest_threat).toMatch(/business|customer/i)
  })
})

describe('getIncompleteSlots', () => {
  it('hides beachhead unless multiIcpDetected', () => {
    const coverage = createEmptyInterviewCoverage()
    const without = getIncompleteSlots(coverage, 'customer', { multiIcpDetected: false })
    const withMulti = getIncompleteSlots(coverage, 'customer', { multiIcpDetected: true })
    expect(without).not.toContain('beachhead')
    expect(withMulti).toContain('beachhead')
  })

  it('hides supply_side slots unless marketplaceDetected', () => {
    const coverage = createEmptyInterviewCoverage()
    expect(getIncompleteSlots(coverage, 'supply_side', { marketplaceDetected: false })).toEqual([])
    expect(getIncompleteSlots(coverage, 'supply_side', { marketplaceDetected: true }).length).toBeGreaterThan(0)
  })
})

describe('SLOT_ADVANCE_THRESHOLD', () => {
  it('is 60', () => {
    expect(SLOT_ADVANCE_THRESHOLD).toBe(60)
  })
})
