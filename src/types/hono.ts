import type { User } from '@supabase/supabase-js'

export type HonoEnv = {
  Variables: {
    user: User
  }
}
