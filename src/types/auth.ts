export interface AuthUser {
  id: string
  email: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthUserResponse {
  id: string
  email: string
  createdAt: string
}
