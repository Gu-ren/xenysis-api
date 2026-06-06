import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types/hono.ts'

// Lazy singleton — deferred so tests can mock @supabase/supabase-js before
// any import of this module triggers createClient.
let _client: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required',
    )
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return _client
}

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
} as const

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(UNAUTHENTICATED, 401)
  }

  const token = authHeader.slice(7)
  const { data: { user }, error } = await getAdminClient().auth.getUser(token)

  if (error || !user) {
    return c.json(UNAUTHENTICATED, 401)
  }

  c.set('user', user)
  await next()
}

// Exported for testing only — resets the cached singleton so tests can control
// which mock is returned by createClient.
export function _resetAuthClientForTests() {
  _client = null
}
