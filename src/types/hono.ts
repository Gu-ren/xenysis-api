import type { AuthUser } from './auth.ts'

export type HonoEnv = {
  Variables: {
    user: AuthUser
  }
}
