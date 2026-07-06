import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../../lib/db/index.ts'
import { profiles, refreshTokens, users } from '../../lib/db/schema/index.ts'
import { AppError, ConflictError } from '../../middleware/errors.ts'
import type { AuthTokens, AuthUserResponse } from '../../types/auth.ts'
import {
  hashToken,
  signAccessToken,
  signEmailVerificationToken,
  signRefreshToken,
} from './jwt.ts'
import { sendEmailVerification } from './email-verification.ts'

const BCRYPT_ROUNDS = 12

function toAuthUserResponse(row: typeof users.$inferSelect): AuthUserResponse {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  }
}

async function createProfile(userId: string): Promise<void> {
  await db.insert(profiles).values({ id: userId }).onConflictDoNothing()
}

async function issueTokens(userId: string, email: string): Promise<AuthTokens> {
  const accessToken = await signAccessToken(userId, email)
  const refreshToken = await signRefreshToken(userId)
  const tokenHash = hashToken(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    expiresAt,
  })

  return { accessToken, refreshToken }
}

export async function registerUser(
  email: string,
  password: string,
): Promise<{ message: string }> {
  const normalizedEmail = email.toLowerCase().trim()
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  })

  if (existing) {
    throw new ConflictError('An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  const [user] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      passwordHash,
    })
    .returning()

  await createProfile(user.id)

  const verificationToken = await signEmailVerificationToken(user.id, user.email)
  await sendEmailVerification({ to: user.email, token: verificationToken })

  return { message: 'Check your email to confirm your account' }
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: AuthUserResponse; accessToken: string; refreshToken: string }> {
  const normalizedEmail = email.toLowerCase().trim()
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  })

  if (!user?.passwordHash) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  if (!user.emailVerifiedAt) {
    throw new AppError(
      'EMAIL_NOT_VERIFIED',
      'Please verify your email before signing in',
      403,
    )
  }

  const tokens = await issueTokens(user.id, user.email)
  return { user: toAuthUserResponse(user), ...tokens }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; user: AuthUserResponse }> {
  const tokenHash = hashToken(refreshToken)
  const stored = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
  })

  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', 'Invalid or expired refresh token', 401)
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, stored.userId),
  })

  if (!user) {
    throw new AppError('INVALID_TOKEN', 'Invalid or expired refresh token', 401)
  }

  await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id))

  const tokens = await issueTokens(user.id, user.email)
  return { ...tokens, user: toAuthUserResponse(user) }
}

export async function logoutUser(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken)
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
}

export async function verifyUserEmail(userId: string): Promise<AuthUserResponse> {
  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()

  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found', 404)
  }

  await createProfile(user.id)
  return toAuthUserResponse(user)
}

export async function findOrCreateGoogleUser(
  googleId: string,
  email: string,
): Promise<{ user: AuthUserResponse; accessToken: string; refreshToken: string }> {
  const normalizedEmail = email.toLowerCase().trim()

  let user = await db.query.users.findFirst({
    where: eq(users.googleId, googleId),
  })

  if (!user) {
    user = await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    })

    if (user) {
      const [updated] = await db
        .update(users)
        .set({
          googleId,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning()
      user = updated
    } else {
      const [created] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          googleId,
          emailVerifiedAt: new Date(),
        })
        .returning()
      user = created
      await createProfile(user.id)
    }
  }

  const tokens = await issueTokens(user.id, user.email)
  return { user: toAuthUserResponse(user), ...tokens }
}
