import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../../src/types/hono.ts'
import { makeUser } from '../helpers/test-utils.ts'

// ── Mock @supabase/supabase-js before importing auth middleware ────────────────
// vi.mock is hoisted, so createClient returns our mock client throughout the suite.

const mockGetUser = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

// Import AFTER mocking so the factory receives the mocked createClient.
const { requireAuth, _resetAuthClientForTests } = await import(
  '../../src/middleware/auth.ts'
)

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.get('/protected', requireAuth, (c) =>
    c.json({ data: { userId: c.var.user.id } }),
  )
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the cached singleton so the next call to requireAuth creates a fresh
    // client via the (already mocked) createClient.
    _resetAuthClientForTests()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp()
    const res = await app.request('/protected')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns 401 when Authorization header has wrong scheme', async () => {
    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic abc123' },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns 401 when Supabase returns an error for the token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    })

    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    })

    expect(res.status).toBe(401)
    expect(mockGetUser).toHaveBeenCalledWith('invalid-token')
  })

  it('returns 401 when Supabase returns null user without error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer expired-token' },
    })

    expect(res.status).toBe(401)
  })

  it('calls supabase.auth.getUser (online verification, not JWT decode)', async () => {
    const user = makeUser()
    mockGetUser.mockResolvedValue({ data: { user }, error: null })

    const app = buildApp()
    await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    // Verifies the token string is forwarded to getUser — not just decoded locally.
    expect(mockGetUser).toHaveBeenCalledWith('valid-token')
  })

  it('sets ctx.var.user and calls next on valid token', async () => {
    const user = makeUser({ id: 'user-abc', email: 'abc@example.com' })
    mockGetUser.mockResolvedValue({ data: { user }, error: null })

    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.userId).toBe('user-abc')
  })
})
