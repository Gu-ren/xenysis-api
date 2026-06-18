import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { authRouter } from './modules/auth/router.ts'
import { founderSessionsRouter } from './modules/founder-sessions/router.ts'
import { blueprintRouter } from './modules/blueprint/router.ts'
import { opportunityRouter } from './modules/opportunity/router.ts'
import { startupsRouter } from './modules/startups/router.ts'
import { errorResponse } from './middleware/errors.ts'
import type { HonoEnv } from './types/hono.ts'

const app = new Hono<HonoEnv>()

// ── Global middleware ─────────────────────────────────────────────────────────

app.use(secureHeaders())

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())

app.use(
  cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

// ── Health check (unauthenticated) ────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok' }))

// ── API v1 routes ─────────────────────────────────────────────────────────────

const v1 = new Hono<HonoEnv>()

v1.route('/auth', authRouter)
v1.route('/startups', startupsRouter)

// Founder sessions, opportunity assessments, and blueprints are nested under startups
v1.route('/startups', founderSessionsRouter)
v1.route('/startups', opportunityRouter)
v1.route('/startups', blueprintRouter)


app.route('/api/v1', v1)

// ── Global error handler ──────────────────────────────────────────────────────

app.onError((err, c) => {
  const { json, status } = errorResponse(err)
  return c.json(json, status)
})

app.notFound((c) => {
  return c.json(
    { error: { code: 'NOT_FOUND', message: 'Endpoint not found' } },
    404,
  )
})

// ── Server ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[xenysis-api] Listening on http://localhost:${info.port}`)
})

export { app }
