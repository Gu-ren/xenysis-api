import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { HonoEnv } from '../../src/types/hono.ts'
import { authHeaders, makeUser, signTestAccessToken } from '../helpers/test-utils.ts'

const { requireAuth } = await import('../../src/middleware/auth.ts')

function buildApp() {
  const app = new Hono<HonoEnv>()
  app.get('/protected', requireAuth, (c) =>
    c.json({ data: { userId: c.var.user.id, email: c.var.user.email } }),
  )
  return app
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-vitest-only-32chars'
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

  it('returns 401 for an invalid JWT', async () => {
    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    })

    expect(res.status).toBe(401)
  })

  it('sets ctx.var.user and calls next on valid token', async () => {
    const user = makeUser({ id: 'user-abc', email: 'abc@example.com' })
    const token = await signTestAccessToken(user)

    const app = buildApp()
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.userId).toBe('user-abc')
    expect(body.data.email).toBe('abc@example.com')
  })

  it('accepts tokens signed with the configured JWT_SECRET', async () => {
    const headers = await authHeaders()
    const app = buildApp()
    const res = await app.request('/protected', { headers })

    expect(res.status).toBe(200)
  })
})
