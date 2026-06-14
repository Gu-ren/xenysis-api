import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../../src/types/hono.ts'
import {
  makeUser,
  makeStartup,
  makeSession,
  makeAnswer,
  TEST_STARTUP_ID,
  TEST_SESSION_ID,
} from '../helpers/test-utils.ts'
import { errorResponse } from '../../src/middleware/errors.ts'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: makeUser() },
        error: null,
      }),
    },
  })),
}))

const mockStartupFindFirst = vi.fn()
const mockSessionFindFirst = vi.fn()
const mockAnswerSelect = vi.fn()
const mockInsert = vi.fn()

vi.mock('../../src/lib/db/index.ts', () => ({
  db: {
    query: {
      startups: { findFirst: mockStartupFindFirst },
      founderSessions: { findFirst: mockSessionFindFirst },
    },
    select: mockAnswerSelect,
    insert: mockInsert,
  },
}))

const { founderSessionsRouter } = await import(
  '../../src/modules/founder-sessions/router.ts'
)

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/v1/startups', founderSessionsRouter)
  app.onError((err, c) => {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  })
  return app
}

const AUTH = { Authorization: 'Bearer valid-token' }

// ── POST /sessions ─────────────────────────────────────────────────────────────

describe('POST /api/v1/startups/:id/sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates and returns a session for an owned startup', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    const session = makeSession()
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([session]),
      }),
    })

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: 'A great problem that needs solving' }),
      },
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.startupId).toBe(TEST_STARTUP_ID)
  })

  it('returns 404 when startup is not owned by user', async () => {
    mockStartupFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: 'A great problem that needs solving' }),
      },
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 400 when idea is too short', async () => {
    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: 'short' }),
      },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ── GET /sessions/:sessionId ───────────────────────────────────────────────────

describe('GET /api/v1/startups/:id/sessions/:sessionId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns session with answers', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSessionFindFirst.mockResolvedValue(makeSession())
    const answers = [
      makeAnswer(),
      makeAnswer({ id: '00000000-0000-0000-0000-000000000099', sequenceOrder: 2 }),
    ]

    mockAnswerSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(answers),
        }),
      }),
    })

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}`,
      { headers: AUTH },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe(TEST_SESSION_ID)
    expect(body.data.answers).toHaveLength(2)
  })

  it('returns 404 when startup is not owned', async () => {
    mockStartupFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}`,
      { headers: AUTH },
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when session does not belong to startup', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSessionFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}`,
      { headers: AUTH },
    )

    expect(res.status).toBe(404)
  })
})

// ── POST /sessions/:sessionId/answers ─────────────────────────────────────────

describe('POST /api/v1/startups/:id/sessions/:sessionId/answers', () => {
  beforeEach(() => vi.clearAllMocks())

  const validAnswer = {
    questionId: 'q-problem-1',
    questionType: 'problem',
    question: 'What problem are you solving?',
    answer: 'Founders spend weeks building the wrong thing.',
    sequenceOrder: 1,
  }

  it('creates and returns an answer for an active session', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSessionFindFirst.mockResolvedValue(makeSession({ status: 'active' }))
    const answer = makeAnswer()
    // Route counts existing answers via db.select before inserting.
    mockAnswerSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ answerCount: 0 }]),
      }),
    })
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([answer]),
      }),
    })

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}/answers`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(validAnswer),
      },
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.sessionId).toBe(TEST_SESSION_ID)
  })

  it('returns 422 when session is completed (not active)', async () => {
    mockStartupFindFirst.mockResolvedValue(makeStartup())
    mockSessionFindFirst.mockResolvedValue(makeSession({ status: 'completed' }))

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}/answers`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(validAnswer),
      },
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('BUSINESS_RULE')
  })

  it('returns 400 when answer exceeds 2000 characters', async () => {
    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}/answers`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validAnswer,
          answer: 'x'.repeat(2001),
        }),
      },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when questionType is invalid', async () => {
    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}/answers`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validAnswer, questionType: 'unknown-type' }),
      },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 404 when startup not owned', async () => {
    mockStartupFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(
      `/api/v1/startups/${TEST_STARTUP_ID}/sessions/${TEST_SESSION_ID}/answers`,
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(validAnswer),
      },
    )

    expect(res.status).toBe(404)
  })
})
