import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../../src/types/hono.ts'
import {
  makeUser,
  makeStartup,
  TEST_STARTUP_ID,
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

const mockFindFirst = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../src/lib/db/index.ts', () => ({
  db: {
    query: {
      startups: { findFirst: mockFindFirst },
    },
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}))

const { startupsRouter } = await import('../../src/modules/startups/router.ts')

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.route('/api/v1/startups', startupsRouter)
  app.onError((err, c) => {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  })
  return app
}

const AUTH = { Authorization: 'Bearer valid-token' }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/startups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with the user startups', async () => {
    const rows = [makeStartup({ name: 'Startup A' }), makeStartup({ id: '00000000-0000-0000-0000-000000000099', name: 'Startup B' })]

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows),
        }),
      }),
    })

    const app = buildApp()
    const res = await app.request('/api/v1/startups', { headers: AUTH })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].name).toBe('Startup A')
  })
})

describe('POST /api/v1/startups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 201 with the created startup', async () => {
    const created = makeStartup({ name: 'New Venture' })

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      }),
    })

    const app = buildApp()
    const res = await app.request('/api/v1/startups', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Venture' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.name).toBe('New Venture')
  })

  it('returns 400 when name is missing', async () => {
    const app = buildApp()
    const res = await app.request('/api/v1/startups', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'no name' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when name is empty string', async () => {
    const app = buildApp()
    const res = await app.request('/api/v1/startups', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/v1/startups/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 when startup is owned by user', async () => {
    const startup = makeStartup()
    mockFindFirst.mockResolvedValue(startup)

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      headers: AUTH,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe(TEST_STARTUP_ID)
  })

  it('returns 404 when startup does not exist or is not owned', async () => {
    mockFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      headers: AUTH,
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 400 when id is not a valid UUID', async () => {
    const app = buildApp()
    const res = await app.request('/api/v1/startups/not-a-uuid', {
      headers: AUTH,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('PATCH /api/v1/startups/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with updated startup', async () => {
    const startup = makeStartup()
    const updated = makeStartup({ name: 'Renamed' })

    mockFindFirst.mockResolvedValue(startup)
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    })

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe('Renamed')
  })

  it('returns 404 when startup not owned', async () => {
    mockFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      method: 'PATCH',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/startups/:id (soft delete)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 204 on successful soft delete', async () => {
    mockFindFirst.mockResolvedValue(makeStartup())
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      method: 'DELETE',
      headers: AUTH,
    })

    expect(res.status).toBe(204)
  })

  it('returns 404 when startup not owned', async () => {
    mockFindFirst.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(`/api/v1/startups/${TEST_STARTUP_ID}`, {
      method: 'DELETE',
      headers: AUTH,
    })

    expect(res.status).toBe(404)
  })
})
