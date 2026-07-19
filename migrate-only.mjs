import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

function createMigrationClient(connectionString) {
  const useSsl =
    process.env.NODE_ENV === 'production' ||
    connectionString.includes('railway') ||
    connectionString.includes('sslmode=require')

  return postgres(connectionString, {
    max: 1,
    ...(useSsl ? { ssl: 'require' } : {}),
  })
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is required')
  process.exit(1)
}

const connection = createMigrationClient(databaseUrl)
const db = drizzle(connection)

try {
  console.log('[migrate] Running database migrations...')
  await migrate(db, { migrationsFolder: './drizzle/migrations' })
  console.log('[migrate] Migrations complete')
  await connection.end()
  process.exit(0)
} catch (err) {
  console.error('[migrate] Migration failed:', err)
  await connection.end()
  process.exit(1)
}
