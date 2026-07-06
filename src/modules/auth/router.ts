import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../lib/db/index.ts'
import { profiles } from '../../lib/db/schema/index.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { zValidator } from '../../middleware/validate.ts'
import { errorResponse } from '../../middleware/errors.ts'
import type { HonoEnv } from '../../types/hono.ts'
import {
  buildFrontendCallbackUrl,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  signOAuthState,
  verifyOAuthState,
} from './google.ts'
import { verifyEmailVerificationToken } from './jwt.ts'
import {
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
} from './schema.ts'
import {
  findOrCreateGoogleUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
  verifyUserEmail,
} from './service.ts'

export const authRouter = new Hono<HonoEnv>()

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:3000'
}

// POST /api/v1/auth/register
authRouter.post('/register', zValidator('json', registerBody), async (c) => {
  try {
    const { email, password } = c.req.valid('json')
    const result = await registerUser(email, password)
    return c.json({ data: result }, 201)
  } catch (err) {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  }
})

// POST /api/v1/auth/login
authRouter.post('/login', zValidator('json', loginBody), async (c) => {
  try {
    const { email, password } = c.req.valid('json')
    const result = await loginUser(email, password)
    return c.json({ data: result })
  } catch (err) {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  }
})

// POST /api/v1/auth/refresh
authRouter.post('/refresh', zValidator('json', refreshBody), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json')
    const result = await refreshAccessToken(refreshToken)
    return c.json({ data: result })
  } catch (err) {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  }
})

// POST /api/v1/auth/logout
authRouter.post('/logout', zValidator('json', logoutBody), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json')
    await logoutUser(refreshToken)
    return c.json({ data: { ok: true } })
  } catch (err) {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  }
})

// GET /api/v1/auth/verify-email?token=...
authRouter.get('/verify-email', async (c) => {
  const token = c.req.query('token')
  if (!token) {
    return c.redirect(`${frontendUrl()}/auth/confirm?error=missing_token`)
  }

  try {
    const { userId } = await verifyEmailVerificationToken(token)
    await verifyUserEmail(userId)
    return c.redirect(`${frontendUrl()}/auth/confirm?verified=1`)
  } catch {
    return c.redirect(`${frontendUrl()}/auth/confirm?error=invalid_token`)
  }
})

// GET /api/v1/auth/google?redirect_uri=...
authRouter.get('/google', async (c) => {
  try {
    const redirectUri =
      c.req.query('redirect_uri') ?? `${frontendUrl()}/auth/callback`
    const state = await signOAuthState(redirectUri)
    return c.redirect(buildGoogleAuthUrl(state))
  } catch (err) {
    const { json, status } = errorResponse(err)
    return c.json(json, status)
  }
})

// GET /api/v1/auth/google/callback
authRouter.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const oauthError = c.req.query('error')

  if (oauthError || !code || !state) {
    return c.redirect(`${frontendUrl()}/login?error=oauth_failed`)
  }

  try {
    const { frontendRedirectUri } = await verifyOAuthState(state)
    const googleUser = await exchangeGoogleCode(code)
    const result = await findOrCreateGoogleUser(googleUser.sub, googleUser.email)
    const callbackUrl = buildFrontendCallbackUrl(frontendRedirectUri, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    })
    return c.redirect(callbackUrl)
  } catch {
    return c.redirect(`${frontendUrl()}/login?error=oauth_failed`)
  }
})

// GET /api/v1/auth/me
authRouter.get('/me', requireAuth, async (c) => {
  const user = c.var.user

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  })

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      profile: profile ?? null,
    },
  })
})
