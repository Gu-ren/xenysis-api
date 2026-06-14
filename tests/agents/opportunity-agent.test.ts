import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { AgentContext } from '../../src/agents/base/agent.interface.ts'
import type { GenerationEvent } from '../../src/agents/base/events.ts'
import type { DB } from '../../src/lib/db/index.ts'
import type { EvidenceRecordRow } from '../../src/lib/db/schema/understanding.ts'
import type { OpportunityAgentInput } from '../../src/agents/opportunity-agent/input-contract.ts'
import type { OpportunityAgentOutput } from '../../src/agents/opportunity-agent/types.ts'
import type { OpportunityAssessmentContent } from '../../src/lib/contracts/opportunity-assessment.ts'
import { EMPTY_FOUNDER_MEMORY } from '../../src/lib/contracts/founder-memory.ts'
import { EMPTY_UNDERSTANDING } from '../../src/lib/contracts/founder-understanding.ts'
import {
  TEST_USER_ID,
  TEST_STARTUP_ID,
  TEST_SESSION_ID,
  makeStartup,
} from '../helpers/test-utils.ts'

// ── Mocks (vitest hoists these before any module evaluation) ──────────────────

const mockComplete          = vi.fn()
const mockTrackUsage        = vi.fn()
const mockPersistAssessment = vi.fn()

vi.mock('../../src/lib/ai/adapters/index.ts', () => ({
  getAdapter: vi.fn(() => ({
    provider: 'openai' as const,
    complete: mockComplete,
  })),
}))

vi.mock('../../src/agents/base/utils.ts', () => ({
  trackUsage:  mockTrackUsage,
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/agents/opportunity-agent/persist.ts', () => ({
  persistAssessment: mockPersistAssessment,
}))

// ── Modules under test (dynamic import ensures mocks are active first) ────────
const { OpportunityAgent }    = await import('../../src/agents/opportunity-agent/index.ts')
const { trimEvidenceRecords } = await import('../../src/agents/opportunity-agent/prompt.ts')

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_JOB_ID      = '00000000-0000-0000-0000-000000000099'
const TEST_ASSESSMENT_ID = '00000000-0000-0000-0000-000000000010'
const TEST_VERSION_ID    = '00000000-0000-0000-0000-000000000011'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeValidAssessmentContent(
  overrides: Partial<OpportunityAssessmentContent> = {},
): OpportunityAssessmentContent {
  return {
    _schemaVersion:   '1.0',
    executiveSummary: 'A promising B2B SaaS opportunity with unvalidated core assumptions. Recommend customer discovery before committing engineering resources.',
    opportunityScore: 72,
    confidenceScore:  35,
    marketPotential: {
      size:      'high',
      growth:    'high',
      score:     75,
      narrative: 'Large and growing SMB market with strong tailwinds from digital transformation initiatives.',
    },
    founderFit: {
      domainExpertise:     'high',
      customerAccess:      'medium',
      executionCapability: 'high',
      score:               70,
      narrative:           'Founder has 10 years of domain experience and a strong technical background.',
    },
    competitiveAdvantage: {
      moat:            'Deep workflow integration that creates switching costs after 90-day onboarding.',
      differentiators: ['10x faster onboarding', 'Native integrations with legacy systems'],
      defensibility:   'medium',
      narrative:       'Workflow integration creates meaningful lock-in but incumbents could respond within 12 months.',
    },
    keyRisks: [
      {
        category:    'customer',
        title:       'Customer demand unvalidated',
        description: 'No external evidence of customer demand beyond founder assumption.',
        severity:    'high',
        mitigation:  'Conduct 20 structured customer discovery interviews in the next 4 weeks.',
      },
      {
        category:    'market',
        title:       'Market size estimate unverified',
        description: 'TAM/SAM numbers are founder-stated without third-party data.',
        severity:    'medium',
        mitigation:  'Build a bottoms-up model from LinkedIn company data or commission an industry report.',
      },
      {
        category:    'competition',
        title:       'Incumbent response risk',
        description: 'Large vendors could add similar features within 6-12 months.',
        severity:    'medium',
        mitigation:  'Accelerate customer lock-in through deep integrations before incumbents respond.',
      },
    ],
    validationPlan: [
      {
        priority:        1,
        category:        'customer',
        action:          'Conduct 20 customer discovery interviews with SMB operations managers.',
        successCriteria: '14 of 20 confirm the problem is a top-3 pain point.',
        effort:          'medium',
        timeline:        '4 weeks',
      },
      {
        priority:        2,
        category:        'pricing',
        action:          'Run a pricing survey with 50 qualified prospects using a Typeform.',
        successCriteria: '60% indicate willingness to pay $199-$499 per month.',
        effort:          'low',
        timeline:        '2 weeks',
      },
      {
        priority:        3,
        category:        'market',
        action:          'Build a bottoms-up market size model using LinkedIn company data.',
        successCriteria: 'SAM exceeds $500M validated with two independent data sources.',
        effort:          'low',
        timeline:        '1 week',
      },
    ],
    recommendation: {
      action:    'validate_first',
      rationale: 'Strong problem hypothesis and founder fit, but critical assumptions around customer demand and pricing remain unvalidated.',
      nextSteps: [
        'Schedule 20 customer discovery interviews this week.',
        'Build a landing page to test demand signals before engineering investment.',
        'Define the one metric that proves this is a real problem.',
      ],
    },
    ...overrides,
  }
}

function makeAdapterResult(content: OpportunityAssessmentContent) {
  return {
    rawContent:   JSON.stringify(content),
    inputTokens:  1200,
    outputTokens: 600,
    model:        'gpt-4o',
  }
}

function makeEvidenceRecord(
  idx: number,
  overrides: Partial<EvidenceRecordRow> = {},
): EvidenceRecordRow {
  return {
    id:               `00000000-0000-0000-0001-${String(idx).padStart(12, '0')}`,
    sessionId:        TEST_SESSION_ID,
    startupId:        TEST_STARTUP_ID,
    userId:           TEST_USER_ID,
    category:         'problem',
    evidence:         `Evidence statement ${idx}`,
    evidenceStrength: 3,
    sourceMessageId:  null,
    confidenceImpact: 10,
    noveltySignal:    'new',
    createdAt:        new Date(),
    ...overrides,
  }
}

function makeCtx(
  overrides: Partial<AgentContext<OpportunityAgentInput>> = {},
): AgentContext<OpportunityAgentInput> {
  return {
    db:        {} as unknown as DB,
    anthropic: {} as unknown as Anthropic,
    openai:    {} as unknown as OpenAI,
    model:     'gpt-4o',
    provider:  'openai',
    input: {
      userId:          TEST_USER_ID,
      startupId:       TEST_STARTUP_ID,
      sessionId:       TEST_SESSION_ID,
      jobId:           TEST_JOB_ID,
      startup:         makeStartup(),
      founderMemory:   EMPTY_FOUNDER_MEMORY,
      understanding:   EMPTY_UNDERSTANDING,
      evidenceRecords: [],
      latestSummary:   undefined,
    },
    ...overrides,
  }
}

// ── Generator consumer ────────────────────────────────────────────────────────
// Drains an async generator, collecting all yielded events and capturing the
// return value. Propagates any throw from the generator to the caller.
async function consumeAgent(
  ctx: AgentContext<OpportunityAgentInput>,
): Promise<{ events: GenerationEvent[]; result: OpportunityAgentOutput }> {
  const agent  = new OpportunityAgent()
  const events: GenerationEvent[] = []
  const gen    = agent.execute(ctx)

  while (true) {
    const tick = await gen.next()
    if (tick.done) {
      return { events, result: tick.value }
    }
    events.push(tick.value)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stageIds(events: GenerationEvent[]): string[] {
  return events
    .filter((e): e is Extract<GenerationEvent, { type: 'stage' }> => e.type === 'stage')
    .map((e) => `${e.data.stageId}:${e.data.state}`)
}

function eventTypes(events: GenerationEvent[]): string[] {
  return events.map((e) => {
    if (e.type === 'stage')    return `stage:${e.data.stageId}:${e.data.state}`
    if (e.type === 'progress') return `progress:${e.data.percent}`
    return e.type
  })
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default success wiring — individual tests override as needed.
  mockComplete.mockResolvedValue(makeAdapterResult(makeValidAssessmentContent()))
  mockTrackUsage.mockResolvedValue(undefined)
  mockPersistAssessment.mockResolvedValue({
    assessmentId:  TEST_ASSESSMENT_ID,
    versionId:     TEST_VERSION_ID,
    versionNumber: 1,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// OpportunityAgent.execute()
// ═════════════════════════════════════════════════════════════════════════════

describe('OpportunityAgent', () => {

  // ── 1. Golden path ──────────────────────────────────────────────────────────
  describe('golden path', () => {
    it('emits stages in correct order', async () => {
      const { events } = await consumeAgent(makeCtx())

      expect(stageIds(events)).toEqual([
        'collecting-context:active',
        'collecting-context:done',
        'generating-assessment:active',
        'generating-assessment:done',
        'validating-results:active',
        'validating-results:done',
        'persisting-results:active',
        'persisting-results:done',
      ])
    })

    it('emits progress checkpoints at correct percentages', async () => {
      const { events } = await consumeAgent(makeCtx())

      const progress = events
        .filter((e): e is Extract<GenerationEvent, { type: 'progress' }> => e.type === 'progress')
        .map((e) => e.data.percent)

      expect(progress).toEqual([10, 75, 85, 100])
    })

    it('emits complete event as the final event with correct artifact IDs', async () => {
      const { events } = await consumeAgent(makeCtx())

      const last = events[events.length - 1]
      expect(last.type).toBe('complete')
      if (last.type === 'complete') {
        expect(last.data.artifactId).toBe(TEST_ASSESSMENT_ID)
        expect(last.data.versionId).toBe(TEST_VERSION_ID)
        expect(last.data.artifactType).toBe('opportunity_assessment')
      }
    })

    it('emits 13 total events: 8 stage + 4 progress + 1 complete', async () => {
      const { events } = await consumeAgent(makeCtx())
      expect(events).toHaveLength(13)
    })

    it('calls trackUsage with model, tokens, and correct purpose', async () => {
      await consumeAgent(makeCtx())

      expect(mockTrackUsage).toHaveBeenCalledOnce()
      expect(mockTrackUsage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId:          TEST_USER_ID,
          startupId:       TEST_STARTUP_ID,
          generationJobId: TEST_JOB_ID,
          usage:           { model: 'gpt-4o', inputTokens: 1200, outputTokens: 600 },
          purpose:         'opportunity_gen',
        }),
      )
    })

    it('calls persistAssessment with validated content and correct identifiers', async () => {
      const content = makeValidAssessmentContent()
      mockComplete.mockResolvedValue(makeAdapterResult(content))

      await consumeAgent(makeCtx())

      expect(mockPersistAssessment).toHaveBeenCalledOnce()
      expect(mockPersistAssessment).toHaveBeenCalledWith(
        expect.objectContaining({
          userId:    TEST_USER_ID,
          startupId: TEST_STARTUP_ID,
          sessionId: TEST_SESSION_ID,
          jobId:     TEST_JOB_ID,
          content:   expect.objectContaining({
            opportunityScore: content.opportunityScore,
            confidenceScore:  content.confidenceScore,
            recommendation:   expect.objectContaining({ action: content.recommendation.action }),
          }),
        }),
      )
    })

    it('returns OpportunityAgentOutput with assessment identifiers and content', async () => {
      const { result } = await consumeAgent(makeCtx())

      expect(result.assessmentId).toBe(TEST_ASSESSMENT_ID)
      expect(result.versionId).toBe(TEST_VERSION_ID)
      expect(result.versionNumber).toBe(1)
      expect(result.content).toBeDefined()
      expect(result.content.opportunityScore).toBe(72)
    })
  })

  // ── 2. Invalid JSON from model ──────────────────────────────────────────────
  describe('invalid JSON from model', () => {
    beforeEach(() => {
      mockComplete.mockResolvedValue({
        rawContent:   'this is not json {{{',
        inputTokens:  800,
        outputTokens: 10,
        model:        'gpt-4o',
      })
    })

    it('throws an error describing the JSON parse failure', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow(
        'Opportunity assessment response was not valid JSON',
      )
    })

    it('does not call trackUsage', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow()
      expect(mockTrackUsage).not.toHaveBeenCalled()
    })

    it('does not call persistAssessment', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow()
      expect(mockPersistAssessment).not.toHaveBeenCalled()
    })

    it('emits generating-assessment:active before failing', async () => {
      const events: GenerationEvent[] = []
      const gen = new OpportunityAgent().execute(makeCtx())

      try {
        while (true) {
          const tick = await gen.next()
          if (tick.done) break
          events.push(tick.value)
        }
      } catch { /* expected */ }

      expect(stageIds(events)).toContain('generating-assessment:done')
      expect(stageIds(events)).toContain('validating-results:active')
      expect(stageIds(events)).not.toContain('persisting-results:active')
    })
  })

  // ── 3. Schema validation failure ────────────────────────────────────────────
  describe('schema validation failure', () => {
    beforeEach(() => {
      // Valid JSON but missing required fields — schema parse will reject.
      mockComplete.mockResolvedValue({
        rawContent:   JSON.stringify({
          _schemaVersion:   '1.0',
          executiveSummary: 'Missing all required sub-objects.',
          // opportunityScore, confidenceScore, marketPotential, etc. absent
        }),
        inputTokens:  900,
        outputTokens: 50,
        model:        'gpt-4o',
      })
    })

    it('throws an error describing the schema validation failure', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow(
        'Opportunity assessment failed schema validation',
      )
    })

    it('does not call trackUsage', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow()
      expect(mockTrackUsage).not.toHaveBeenCalled()
    })

    it('does not call persistAssessment', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow()
      expect(mockPersistAssessment).not.toHaveBeenCalled()
    })
  })

  // ── 4. Persistence failure ──────────────────────────────────────────────────
  describe('persistence failure', () => {
    beforeEach(() => {
      mockPersistAssessment.mockRejectedValue(new Error('unique constraint violation'))
    })

    it('propagates the persistence error', async () => {
      await expect(consumeAgent(makeCtx())).rejects.toThrow('unique constraint violation')
    })

    it('does not emit a complete event', async () => {
      const events: GenerationEvent[] = []
      const gen = new OpportunityAgent().execute(makeCtx())

      try {
        while (true) {
          const tick = await gen.next()
          if (tick.done) break
          events.push(tick.value)
        }
      } catch { /* expected */ }

      expect(events.every((e) => e.type !== 'complete')).toBe(true)
    })

    it('calls trackUsage before the persistence failure', async () => {
      // trackUsage is called before persistAssessment in persisting-results stage.
      // A persistence failure must not suppress the usage record.
      const gen = new OpportunityAgent().execute(makeCtx())
      try {
        while (true) {
          const tick = await gen.next()
          if (tick.done) break
        }
      } catch { /* expected */ }

      expect(mockTrackUsage).toHaveBeenCalledOnce()
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// trimEvidenceRecords() — pure function, no mocks needed
// ═════════════════════════════════════════════════════════════════════════════

describe('trimEvidenceRecords()', () => {

  // ── 5a. Duplicate collapsing ─────────────────────────────────────────────
  describe('duplicate collapsing', () => {
    it('collapses two records with the same text into one "N independent signals" record', () => {
      const text = 'Founder spoke with 5 potential enterprise buyers'
      const records = [
        makeEvidenceRecord(1, { evidence: text, evidenceStrength: 3 }),
        makeEvidenceRecord(2, { evidence: text, evidenceStrength: 4 }),
      ]

      const result = trimEvidenceRecords(records)

      expect(result).toHaveLength(1)
      expect(result[0].evidence).toBe(`2 independent signals: ${text}`)
    })

    it('uses the maximum evidenceStrength from the cluster', () => {
      const text = 'Repeated customer complaint about onboarding time'
      const records = [
        makeEvidenceRecord(1, { evidence: text, evidenceStrength: 2 }),
        makeEvidenceRecord(2, { evidence: text, evidenceStrength: 5 }),
        makeEvidenceRecord(3, { evidence: text, evidenceStrength: 3 }),
      ]

      const result = trimEvidenceRecords(records)

      expect(result).toHaveLength(1)
      expect(result[0].evidenceStrength).toBe(5)
    })

    it('marks collapsed records as noveltySignal "new"', () => {
      const text = 'Three interviews confirmed billing pain'
      const records = [
        makeEvidenceRecord(1, { evidence: text, noveltySignal: 'repetitive' }),
        makeEvidenceRecord(2, { evidence: text, noveltySignal: 'repetitive' }),
      ]

      const result = trimEvidenceRecords(records)

      expect(result[0].noveltySignal).toBe('new')
    })

    it('normalizes whitespace and case before deduplicating', () => {
      const records = [
        makeEvidenceRecord(1, { evidence: 'Customers hate  the  billing flow' }),
        makeEvidenceRecord(2, { evidence: 'customers hate the billing flow' }),
        makeEvidenceRecord(3, { evidence: '  Customers HATE the billing flow  ' }),
      ]

      const result = trimEvidenceRecords(records)

      // All three normalize to the same key.
      expect(result).toHaveLength(1)
      expect(result[0].evidence).toMatch(/^3 independent signals:/)
    })

    it('does not collapse records with different texts', () => {
      const records = [
        makeEvidenceRecord(1, { evidence: 'First distinct finding', evidenceStrength: 3 }),
        makeEvidenceRecord(2, { evidence: 'Second distinct finding', evidenceStrength: 3 }),
      ]

      const result = trimEvidenceRecords(records)
      expect(result).toHaveLength(2)
    })
  })

  // ── 5b. Per-category cap ─────────────────────────────────────────────────
  describe('per-category cap (PER_CATEGORY_CAP = 3)', () => {
    it('retains at most 3 records per category', () => {
      const records = Array.from({ length: 5 }, (_, i) =>
        makeEvidenceRecord(i + 1, { category: 'problem' }),
      )

      const result = trimEvidenceRecords(records)

      const problemRecords = result.filter((r) => r.category === 'problem')
      expect(problemRecords).toHaveLength(3)
    })

    it('keeps the highest-strength records when capping', () => {
      const records = [
        makeEvidenceRecord(1, { category: 'market', evidence: 'Weak signal A',   evidenceStrength: 1 }),
        makeEvidenceRecord(2, { category: 'market', evidence: 'Strong signal B',  evidenceStrength: 5 }),
        makeEvidenceRecord(3, { category: 'market', evidence: 'Medium signal C',  evidenceStrength: 3 }),
        makeEvidenceRecord(4, { category: 'market', evidence: 'Medium signal D',  evidenceStrength: 3 }),
        makeEvidenceRecord(5, { category: 'market', evidence: 'Strong signal E',  evidenceStrength: 4 }),
      ]

      const result = trimEvidenceRecords(records)
      const kept   = result.filter((r) => r.category === 'market')

      expect(kept).toHaveLength(3)
      // All kept records should be strength ≥ 3 (the weak signal is dropped).
      expect(kept.every((r) => r.evidenceStrength >= 3)).toBe(true)
    })

    it('balances across categories — does not collapse all slots into one category', () => {
      // 3 records per category across two categories.
      const records = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeEvidenceRecord(i + 1, { category: 'problem', evidence: `Problem ${i}` }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeEvidenceRecord(i + 10, { category: 'customer', evidence: `Customer ${i}` }),
        ),
      ]

      const result = trimEvidenceRecords(records)

      const problemCount  = result.filter((r) => r.category === 'problem').length
      const customerCount = result.filter((r) => r.category === 'customer').length
      expect(problemCount).toBe(3)
      expect(customerCount).toBe(3)
    })
  })

  // ── 5c. Total cap ───────────────────────────────────────────────────────
  describe('total cap (TOTAL_CAP = 30)', () => {
    it('caps total output at 30 records across all categories', () => {
      // 12 categories × 3 unique records each = 36 unique records.
      // Per-category cap passes all 3 per category (3 ≤ 3).
      // Total cap reduces 36 → 30.
      const categories = Array.from({ length: 12 }, (_, i) => `cat-${i}`)
      const records: EvidenceRecordRow[] = []
      let idx = 0
      for (const cat of categories) {
        for (let j = 0; j < 3; j++) {
          records.push(
            makeEvidenceRecord(idx++, { category: cat, evidence: `${cat} evidence ${j}` }),
          )
        }
      }

      const result = trimEvidenceRecords(records)
      expect(result).toHaveLength(30)
    })

    it('prioritizes highest-strength records when applying the total cap', () => {
      const categories = Array.from({ length: 12 }, (_, i) => `cat-${i}`)
      const records: EvidenceRecordRow[] = []
      let idx = 0

      for (let i = 0; i < 12; i++) {
        const cat = categories[i]
        // First 6 categories get strength 5; last 6 get strength 2.
        const strength = i < 6 ? 5 : 2
        for (let j = 0; j < 3; j++) {
          records.push(
            makeEvidenceRecord(idx++, {
              category:         cat,
              evidence:         `${cat} evidence ${j}`,
              evidenceStrength: strength,
            }),
          )
        }
      }

      const result = trimEvidenceRecords(records)

      // All 30 retained records should come from strength-5 categories
      // (6 categories × 3 records = 18) plus the best of the strength-2 ones.
      const strength5Count = result.filter((r) => r.evidenceStrength === 5).length
      const strength2Count = result.filter((r) => r.evidenceStrength === 2).length

      expect(strength5Count).toBe(18)   // all 18 high-strength records retained
      expect(strength2Count).toBe(12)   // 30 - 18 = 12 low-strength records fill the rest
    })

    it('returns all records unchanged when count is below the total cap', () => {
      // 4 categories × 2 records = 8 records — well under TOTAL_CAP.
      const records = [
        makeEvidenceRecord(1, { category: 'problem',  evidence: 'Problem A' }),
        makeEvidenceRecord(2, { category: 'problem',  evidence: 'Problem B' }),
        makeEvidenceRecord(3, { category: 'customer', evidence: 'Customer A' }),
        makeEvidenceRecord(4, { category: 'customer', evidence: 'Customer B' }),
        makeEvidenceRecord(5, { category: 'market',   evidence: 'Market A' }),
        makeEvidenceRecord(6, { category: 'market',   evidence: 'Market B' }),
        makeEvidenceRecord(7, { category: 'solution', evidence: 'Solution A' }),
        makeEvidenceRecord(8, { category: 'solution', evidence: 'Solution B' }),
      ]

      const result = trimEvidenceRecords(records)
      expect(result).toHaveLength(8)
    })
  })

  // ── 5d. Empty input ─────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns an empty array for empty input', () => {
      expect(trimEvidenceRecords([])).toEqual([])
    })

    it('handles a single record without modification', () => {
      const record = makeEvidenceRecord(1, { evidenceStrength: 4 })
      const result = trimEvidenceRecords([record])
      expect(result).toHaveLength(1)
      expect(result[0].evidence).toBe(record.evidence)
    })
  })
})
