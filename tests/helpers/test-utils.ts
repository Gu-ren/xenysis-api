import type { User } from '@supabase/supabase-js'

export const TEST_USER_ID    = '00000000-0000-0000-0000-000000000001'
export const TEST_STARTUP_ID = '00000000-0000-0000-0000-000000000002'
export const TEST_SESSION_ID = '00000000-0000-0000-0000-000000000003'
export const TEST_ANSWER_ID  = '00000000-0000-0000-0000-000000000004'

/** Minimal Supabase User stub for auth tests. */
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: TEST_USER_ID,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email: 'test@example.com',
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    ...overrides,
  } as User
}

/** A minimal Startup row shape for use in DB mocks. */
export function makeStartup(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_STARTUP_ID,
    userId: TEST_USER_ID,
    name: 'Test Startup',
    description: null,
    category: null,
    lifecycleStage: 'founder-session' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

/** A minimal FounderSession row shape for use in DB mocks. */
export function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_SESSION_ID,
    startupId: TEST_STARTUP_ID,
    userId: TEST_USER_ID,
    idea: 'A great startup idea',
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** A minimal SessionAnswer row shape for use in DB mocks. */
export function makeAnswer(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_ANSWER_ID,
    sessionId: TEST_SESSION_ID,
    questionId: 'q1',
    questionType: 'problem' as const,
    question: 'What problem are you solving?',
    answer: 'A very real problem',
    sequenceOrder: 1,
    createdAt: new Date(),
    ...overrides,
  }
}
