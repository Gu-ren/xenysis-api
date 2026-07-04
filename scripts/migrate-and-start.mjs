import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { spawn } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[migrate] DATABASE_URL is required')
  process.exit(1)
}

const connection = postgres(databaseUrl, { max: 1 })
const db = drizzle(connection)

try {
  console.log('[migrate] Running database migrations...')
  await migrate(db, { migrationsFolder: './drizzle/migrations' })
  console.log('[migrate] Migrations complete')
} catch (err) {
  console.error('[migrate] Migration failed:', err)
  process.exit(1)
} finally {
  await connection.end()
}

const child = spawn('node', ['dist/index.js'], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
