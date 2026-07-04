import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return encoder.encode(secret)
}

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required',
    )
  }

  return { clientId, clientSecret, redirectUri }
}

export async function signOAuthState(frontendRedirectUri: string): Promise<string> {
  return new SignJWT({ frontendRedirectUri, type: 'oauth_state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSecret())
}

export async function verifyOAuthState(state: string): Promise<{ frontendRedirectUri: string }> {
  const { payload } = await jwtVerify(state, getSecret())
  if (payload.type !== 'oauth_state') {
    throw new Error('Invalid OAuth state')
  }
  const frontendRedirectUri =
    typeof payload.frontendRedirectUri === 'string' ? payload.frontendRedirectUri : ''
  if (!frontendRedirectUri) {
    throw new Error('Invalid OAuth state')
  }
  return { frontendRedirectUri }
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export interface GoogleUserInfo {
  sub: string
  email: string
}

export async function exchangeGoogleCode(code: string): Promise<GoogleUserInfo> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    throw new Error(`Google token exchange failed: ${body}`)
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string }
  if (!tokenData.access_token) {
    throw new Error('Google token exchange returned no access token')
  }

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!userRes.ok) {
    throw new Error('Failed to fetch Google user info')
  }

  const userInfo = (await userRes.json()) as { sub?: string; email?: string }
  if (!userInfo.sub || !userInfo.email) {
    throw new Error('Google user info missing required fields')
  }

  return { sub: userInfo.sub, email: userInfo.email }
}

export function buildFrontendCallbackUrl(
  frontendRedirectUri: string,
  tokens: { accessToken: string; refreshToken: string },
): string {
  const url = new URL(frontendRedirectUri)
  url.searchParams.set('accessToken', tokens.accessToken)
  url.searchParams.set('refreshToken', tokens.refreshToken)
  return url.toString()
}
