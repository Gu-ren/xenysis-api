type PlainObject = Record<string, unknown>

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Recursively merges `patch` into `base`.
 * - Plain objects are merged key-by-key (deep).
 * - Arrays REPLACE.
 * - Scalars taken from patch.
 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const result: PlainObject = { ...base }
  for (const key of Object.keys(patch)) {
    result[key] = isPlainObject(base[key]) && isPlainObject(patch[key])
      ? deepMerge(base[key], patch[key])
      : patch[key]
  }
  return result
}
