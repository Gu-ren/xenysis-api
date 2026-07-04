import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { spawn } from 'node:child_process'

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
  console.error('[start] DATABASE_URL is required')
  process.exit(1)
}

// Start HTTP server immediately so Railway healthchecks pass while migrations run.
console.log('[start] Starting API server...')
const child = spawn('node', ['dist/index.js'], {
  stdio: 'inherit',
  env: process.env,
})

child.on('error', (err) => {
  console.error('[start] Failed to start server:', err)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[start] Server killed by signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})

const connection = createMigrationClient(databaseUrl)
const db = drizzle(connection)

try {
  console.log('[migrate] Running database migrations...')
  await migrate(db, { migrationsFolder: './drizzle/migrations' })
  console.log('[migrate] Migrations complete')
} catch (err) {
  console.error('[migrate] Migration failed:', err)
  child.kill('SIGTERM')
  process.exit(1)
} finally {
  await connection.end()
}
