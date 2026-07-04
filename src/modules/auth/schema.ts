import { z } from 'zod'

export const registerBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const loginBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const refreshBody = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

export const logoutBody = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})
