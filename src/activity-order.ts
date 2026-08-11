// Older deployments may contain numeric Unix timestamps while current rows use SQLite datetime text.
// Normalize seconds, milliseconds, and microseconds before comparing different activity kinds.
export const activityTimestamp = `CASE
  WHEN trim(CAST(activity.created_at AS TEXT)) NOT GLOB '*[^0-9.]*' THEN CASE
    WHEN CAST(activity.created_at AS REAL)>=100000000000000 THEN CAST(activity.created_at AS REAL)/1000000
    WHEN CAST(activity.created_at AS REAL)>=100000000000 THEN CAST(activity.created_at AS REAL)/1000
    ELSE CAST(activity.created_at AS REAL)
  END
  ELSE unixepoch(activity.created_at)
END`

export const activityOrderBy = `${activityTimestamp} DESC, activity.activity_key DESC`

export type ActivityCursor = { timestamp: number; key: string; direction: 'next' | 'previous' }

export function decodeActivityCursor(value?: string): ActivityCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 1
      || typeof decoded[1] !== 'number' || !Number.isFinite(decoded[1])
      || typeof decoded[2] !== 'string' || !decoded[2]
      || !['next', 'previous'].includes(decoded[3])) return null
    return { timestamp: decoded[1], key: decoded[2], direction: decoded[3] }
  }
  catch {
    return null
  }
}

export function encodeActivityCursor(cursor: ActivityCursor) {
  return Buffer.from(JSON.stringify([1, cursor.timestamp, cursor.key, cursor.direction])).toString('base64url')
}
