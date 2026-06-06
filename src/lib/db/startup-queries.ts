import { and, eq, isNull } from 'drizzle-orm'
import { db } from './index.ts'
import { startups } from './schema/index.ts'
import { NotFoundError } from '../../middleware/errors.ts'

export async function requireStartupOwner(startupId: string, userId: string) {
  const startup = await db.query.startups.findFirst({
    where: and(
      eq(startups.id, startupId),
      eq(startups.userId, userId),
      isNull(startups.deletedAt),
    ),
  })
  if (!startup) throw new NotFoundError()
  return startup
}
