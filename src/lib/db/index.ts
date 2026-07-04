import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema/index.ts'
import { createPostgresClient } from './postgres-client.ts'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

const client = createPostgresClient(process.env.DATABASE_URL)

export const db = drizzle(client, { schema })

export type DB = typeof db
