import postgres from 'postgres'

/** Postgres client options shared by runtime and migration scripts. */
export function createPostgresClient(connectionString: string) {
  const useSsl =
    process.env.NODE_ENV === 'production' ||
    connectionString.includes('railway') ||
    connectionString.includes('sslmode=require')

  return postgres(connectionString, {
    ...(useSsl ? { ssl: 'require' } : {}),
  })
}
