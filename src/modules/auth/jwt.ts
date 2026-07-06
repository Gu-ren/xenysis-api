import { createHash } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required')
  }
  return encoder.encode(secret)
}

function parseExpiry(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

export async function signAccessToken(userId: string, email: string): Promise<string> {
  const expiry = parseExpiry(process.env.JWT_ACCESS_EXPIRY, '15m')
  return new SignJWT({ email, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecret())
}

export async function signRefreshToken(userId: string): Promise<string> {
  const expiry = parseExpiry(process.env.JWT_REFRESH_EXPIRY, '7d')
  return new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(getSecret())
}

export async function signEmailVerificationToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email, type: 'email_verify' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret())
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('Invalid access token')
  }
  const email = typeof payload.email === 'string' ? payload.email : ''
  return { userId: payload.sub, email }
}

export async function verifyRefreshToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'refresh' || typeof payload.sub !== 'string') {
    throw new Error('Invalid refresh token')
  }
  return { userId: payload.sub }
}

export async function verifyEmailVerificationToken(
  token: string,
): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, getSecret())
  if (payload.type !== 'email_verify' || typeof payload.sub !== 'string') {
    throw new Error('Invalid verification token')
  }
  const email = typeof payload.email === 'string' ? payload.email : ''
  return { userId: payload.sub, email }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
