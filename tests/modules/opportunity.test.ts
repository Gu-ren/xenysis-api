import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../../src/types/hono.ts'
import {
  makeUser,
  makeStartup,
  makeSession,
  TEST_STARTUP_ID,
  TEST_SESSION_ID,
  TEST_USER_ID,
} from '../helpers/test-utils.ts'
import { errorResponse } from '../../src/middleware/errors.ts'
import {
  stageEvent,
  progressEvent,
  completeEvent,
} from '../../src/agents/base/events.ts'
import type { OpportunityAssessmentContent } from '../../src/lib/contracts/opportunity-assessment.ts'

// ── Test IDs ──────────────────────────────────────────────────────────────────

const TEST_JOB_ID        = '10000000-0000-0000-0000-000000000001'
const TEST_ASSESSMENT_ID = '10000000-0000-0000-0000-000000000002'
const TEST_VERSION_ID    = '10000000-0000-0000-0000-000000000003'

// ── Mock data ─────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id:            TEST_JOB_ID,
    userId:        TEST_USER_ID,
    startupId:     TEST_STARTUP_ID,
    type:          'opportunity',
    status:        'pending',
    model:         'gpt-4o',
    provider:      'openai',
    promptVersion: 'opportunity-v1.0',
    maxAttempts:   3,
    ...overrides,
  }
}

const MOCK_CONTENT: OpportunityAssessmentContent = {
  _schemaVersion:  '1.0',
  executiveSummary: 'This is a strong opportunity in an underserved market.',
  opportunityScore: 72,
  confidenceScore:  55,
  marketPotential: {
    size:      'high',
    growth:    'high',
    score:     75,
    narrative: 'Large addressable market with strong growth trends.',
  },
  founderFit: {
    domainExpertise:     'high',
    customerAccess:      'medium',
    executionCapability: 'high',
    score:               70,
    narrative:           'Founder has deep domain expertise.',
  },
  competitiveAdvantage: {
    moat:            'Proprietary data network effects',
    differentiators: ['Unique data pipeline', 'Founder industry access'],
    defensibility:   'medium',
    narrative:       'Moderate defensibility; requires validation.',
  },
  keyRisks: [
    {
      category:    'market',
      title:       'Market size uncertainty',
      description: 'TAM may be narrower than assumed.',
      severity:    'medium',
      mitigation:  'Conduct bottom-up market sizing from customer data.',
    },
    {
      category:    'customer',
      title:       'Customer acquisition cost',
      description: 'B2B sales cycles are long in this vertical.',
      severity:    'high',
      mitigation:  'Build a direct outbound channel to shorten the cycle.',
    },
    {
      category:    'problem',
      title:       'Problem validation gap',
      description: 'No structured interviews completed yet.',
      severity:    'critical',
      mitigation:  'Complete 10 customer discovery calls before building.',
    },
  ],
  validationPlan: [
    {
      priority:        1,
      category:        'problem',
      action:          'Interview 10 target customers about the pain point',
      successCriteria: '8 of 10 confirm they would pay to solve this',
      effort:          'low',
      timeline:        '2 weeks',
    },
    {
      priority:        2,
      category:        'customer',
      action:          'Define ideal customer profile in writing',
      successCriteria: 'ICP doc reviewed and approved by advisor',
      effort:          'low',
      timeline:        '1 week',
    },
    {
      priority:        3,
      category:        'solution',
      action:          'Build a clickable prototype',
      successCriteria: '5 beta users agree to pilot test',
      effort:          'high',
      timeline:        '6 weeks',
    },
  ],
  recommendation: {
    action:    'validate_first',
    rationale: 'Strong opportunity thesis but insufficient external evidence to proceed.',
    nextSteps: [
      'Complete 10 structured customer discovery interviews',
      'Define your ICP and document key pain point signals',
      'Build and test a low-fidelity prototype with 5 real users',
    ],
  },
}

const MOCK_AGENT_EVENTS = [
  stageEvent('collecting-context',   'Collecting context',    'Reading founder memory and evidence records', 'active'),
  stageEvent('collecting-context',   'Collecting context',    'Reading founder memory and evidence records', 'done'),
  progressEvent(10),
  stageEvent('generating-assessment', 'Generating assessment', 'Running opportunity analysis model', 'active'),
  stageEvent('generating-assessment', 'Generating assessment', 'Running opportunity analysis model', 'done'),
  progressEvent(75),
  stageEvent('validating-results',   'Validating results',    'Parsing and validating model output', 'done'),
  progressEvent(85),
  stageEvent('persisting-results',   'Persisting results',    'Saving assessment to database', 'done'),
  progressEvent(100),
  completeEvent(TEST_ASSESSMENT_ID, TEST_VERSION_ID, 'opportunity_assessment'),
]

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data:  { user: makeUser() },
        error: null,
      }),
    },
  })),
}))

const mockStartupFindFirst    = vi.fn()
const mockSessionFindFirst    = vi.fn()
const mockAssessmentFindFirst = vi.fn()
const mockInsert              = vi.fn()
const mockSelect              = vi.fn()

vi.mock('../../src/lib/db/index.ts', () => ({
  db: {
    query: {
      startups:               { findFirst: mockStartupFindFirst },
      founderSessions:        { findFirst: mockSessionFindFirst },
      opportunityAssessments: { findFirst: mockAssessmentFindFirst },
    },
    select: mockSelect,
    insert: mockInsert,
  },
}))

// AI client singletons: stub so the constructor doesn't require real credentials.
vi.mock('../../src/lib/ai/client.ts', () => ({
  openai:    {},
  anthropic: {},
}))

// runAgent is mocked so tests exercise route wiring without re-testing agent internals
// (agent orchestration is covered by opportunity-agent.test.ts).
const mockRunAgent = vi.fn()
vi.mock('../../src/agents/base/runner.ts', () => ({ runAgent: mockRunAgent }))

// context-builder is mocked to avoid loading/parsing DB rows in route-level tests.
const mockBuildOpportunityContext = vi.fn()
vi.mock('../../src/agents/opportunity-agent/context-builder.ts', () => ({
  buildOpportunityContext: mockBuildOpportunityContext,
}))

// Dynamic import after all vi.mock() calls so modules under test see the mocks.
const { opportunityRouter } = await import('../../src/modules/opportunity/router.ts')

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/v1/startups', opportunityRouter)
  app.onError((err, c) => {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  })
  return app
}

const AUTH    = { Authorization: 'Bearer valid-token' }
const BASE    = `/api/v1/startups/${TEST_STARTUP_ID}/opportunity`
const BODY    = { sessionId: TEST_SESSION_ID }
const HEADERS = { ...AUTH, 'Content-Type': 'application/json' }

/** Parses SSE response body text into an array of event objects. */
function parseSSEEvents(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
      return dataLine ? JSON.parse(dataLine.slice(6)) : null
    })
    .filter(Boolean)
}

// ── POST /opportunity/generate ────────────────────────────────────────────────

describe('POST /api/v1/startups/:id/opportunity/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: owned startup, completed session, successful job creation.
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSessionFindFirst.mockResolvedValue(makeSession({ status: 'completed' }))
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([makeJob()]),
      }),
    })
    mockBuildOpportunityContext.mockResolvedValue({
      jobId:     TEST_JOB_ID,
      userId:    TEST_USER_ID,
      startupId: TEST_STARTUP_ID,
      sessionId: TEST_SESSION_ID,
    })
    mockRunAgent.mockImplementation(async function* () {
      for (const event of MOCK_AGENT_EVENTS) yield event
    })
  })

  it('returns 200 with SSE content-type', async () => {
    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('streams all agent events in SSE format', async () => {
    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    const events = parseSSEEvents(await res.text())
    expect(events).toHaveLength(MOCK_AGENT_EVENTS.length)

    // Verify first stage event shape
    expect(events[0]).toMatchObject({
      type: 'stage',
      data: { stageId: 'collecting-context', state: 'active' },
    })

    // Verify complete event is last and carries the right artifact IDs
    const lastEvent = events.at(-1) as { type: string; data: Record<string, unknown> }
    expect(lastEvent.type).toBe('complete')
    expect(lastEvent.data.artifactId).toBe(TEST_ASSESSMENT_ID)
    expect(lastEvent.data.versionId).toBe(TEST_VERSION_ID)
    expect(lastEvent.data.artifactType).toBe('opportunity_assessment')
  })

  it('creates a generation_jobs row with correct model and provider', async () => {
    const mockValues    = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([makeJob()]),
    })
    mockInsert.mockReturnValue({ values: mockValues })

    await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(mockInsert).toHaveBeenCalledOnce()
    const insertedValues = mockValues.mock.calls[0][0]
    expect(insertedValues.type).toBe('opportunity')
    expect(insertedValues.model).toBe('gpt-4o')
    expect(insertedValues.provider).toBe('openai')
    expect(insertedValues.status).toBe('pending')
  })

  it('calls buildOpportunityContext with the job ID and session ID', async () => {
    await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(mockBuildOpportunityContext).toHaveBeenCalledWith(
      expect.anything(),  // db
      TEST_STARTUP_ID,
      TEST_SESSION_ID,
      TEST_USER_ID,
      TEST_JOB_ID,
    )
  })

  it('emits a terminal error event when runAgent throws', async () => {
    mockRunAgent.mockImplementation(async function* () {
      throw new Error('Model provider returned 503')
    })

    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(res.status).toBe(200)  // SSE stream always opens with 200
    const events = parseSSEEvents(await res.text())
    const errorEv = events.find((e) => (e as { type: string }).type === 'error') as {
      type: string; data: { code: string; message: string }
    } | undefined
    expect(errorEv).toBeDefined()
    expect(errorEv!.data.code).toBe('GENERATION_FAILED')
    expect(errorEv!.data.message).toContain('503')
  })

  it('returns 404 when startup is not owned by user', async () => {
    mockStartupFindFirst.mockResolvedValue(null)

    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 when session is not found', async () => {
    mockSessionFindFirst.mockResolvedValue(null)

    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 422 when session is not completed', async () => {
    mockSessionFindFirst.mockResolvedValue(makeSession({ status: 'active' }))

    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(BODY),
    })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('BUSINESS_RULE')
    expect(body.error.message).toContain('completed')
  })

  it('returns 400 when sessionId is missing from body', async () => {
    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when sessionId is not a valid UUID', async () => {
    const res = await buildApp().request(`${BASE}/generate`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({ sessionId: 'not-a-uuid' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 401 when no auth token is provided', async () => {
    const res = await buildApp().request(`${BASE}/generate`, {
      method: 'POST',
      body:   JSON.stringify(BODY),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(401)
  })
})

// ── GET /opportunity ──────────────────────────────────────────────────────────

describe('GET /api/v1/startups/:id/opportunity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with current assessment and validated content', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                assessmentId:  TEST_ASSESSMENT_ID,
                versionId:     TEST_VERSION_ID,
                versionNumber: 1,
                content:       MOCK_CONTENT,
                generatedAt:   new Date('2026-06-14T12:00:00Z'),
              },
            ]),
          }),
        }),
      }),
    })

    const res  = await buildApp().request(BASE, { headers: AUTH })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.assessmentId).toBe(TEST_ASSESSMENT_ID)
    expect(body.data.versionId).toBe(TEST_VERSION_ID)
    expect(body.data.versionNumber).toBe(1)
    expect(body.data.content.opportunityScore).toBe(72)
    expect(body.data.content.confidenceScore).toBe(55)
    expect(body.data.content.recommendation.action).toBe('validate_first')
  })

  it('returns 404 when no assessment exists for the startup', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })

    const res = await buildApp().request(BASE, { headers: AUTH })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 when startup is not owned by user', async () => {
    mockStartupFindFirst.mockResolvedValue(null)

    const res = await buildApp().request(BASE, { headers: AUTH })
    expect(res.status).toBe(404)
  })

  it('returns 401 when no auth token is provided', async () => {
    const res = await buildApp().request(BASE)
    expect(res.status).toBe(401)
  })
})

// ── GET /opportunity/versions ─────────────────────────────────────────────────

describe('GET /api/v1/startups/:id/opportunity/versions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with all version headers for the startup', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockAssessmentFindFirst.mockResolvedValue({ id: TEST_ASSESSMENT_ID })
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            { versionId: TEST_VERSION_ID, versionNumber: 1, isCurrent: true,  generatedAt: new Date() },
            { versionId: '10000000-0000-0000-0000-000000000099', versionNumber: 2, isCurrent: false, generatedAt: new Date() },
          ]),
        }),
      }),
    })

    const res = await buildApp().request(`${BASE}/versions`, { headers: AUTH })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].versionNumber).toBe(1)
    expect(body.data[1].versionNumber).toBe(2)
  })

  it('returns 404 when no assessment exists', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockAssessmentFindFirst.mockResolvedValue(null)

    const res = await buildApp().request(`${BASE}/versions`, { headers: AUTH })
    expect(res.status).toBe(404)
  })
})
