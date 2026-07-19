/** In-memory presence for collaborative editing (single-instance). */

export interface PresencePeer {
  userId: string
  displayName: string
  sectionId: string | null
  updatedAt: number
}

const ROOM_TTL_MS = 45_000
const rooms = new Map<string, Map<string, PresencePeer>>()

function prune(startupId: string) {
  const room = rooms.get(startupId)
  if (!room) return
  const now = Date.now()
  for (const [uid, peer] of room) {
    if (now - peer.updatedAt > ROOM_TTL_MS) room.delete(uid)
  }
  if (room.size === 0) rooms.delete(startupId)
}

export function heartbeatPresence(
  startupId: string,
  userId: string,
  displayName: string,
  sectionId: string | null,
): PresencePeer[] {
  prune(startupId)
  let room = rooms.get(startupId)
  if (!room) {
    room = new Map()
    rooms.set(startupId, room)
  }
  room.set(userId, { userId, displayName, sectionId, updatedAt: Date.now() })
  return [...room.values()].filter((p) => p.userId !== userId)
}

export function listPresence(startupId: string, excludeUserId?: string): PresencePeer[] {
  prune(startupId)
  const room = rooms.get(startupId)
  if (!room) return []
  return [...room.values()].filter((p) => p.userId !== excludeUserId)
}
