export const PAGE_SIZE = 40
export const CONNECTION_PAGE_SIZE = 10
export const TAG_PAGE_SIZE = 12

export type PostCursor = { id: number; direction: 'next' | 'previous' }

export function encodePostCursor(cursor: PostCursor) {
  return Buffer.from(JSON.stringify([1, cursor.id, cursor.direction])).toString('base64url')
}

export function decodePostCursor(value?: string): PostCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1
      || !Number.isInteger(decoded[1]) || decoded[1] < 1 || !['next', 'previous'].includes(decoded[2])) return null
    return { id: decoded[1], direction: decoded[2] }
  }
  catch {
    return null
  }
}

export function postCursorPage<T extends { id: number }>(rows: T[], cursor: PostCursor | null, pageSize = PAGE_SIZE) {
  const ordered = cursor?.direction === 'previous' ? [...rows].reverse() : rows
  const hasMore = ordered.length > pageSize
  const pageRows = cursor?.direction === 'previous' && hasMore
    ? ordered.slice(1)
    : ordered.slice(0, pageSize)
  const canGoBack = Boolean(cursor) && (cursor!.direction === 'next' || hasMore)
  const canGoNext = cursor?.direction === 'previous' || hasMore
  return {
    rows: pageRows,
    previousCursor: canGoBack && pageRows.length
      ? encodePostCursor({ id: pageRows[0].id, direction: 'previous' })
      : null,
    nextCursor: canGoNext && pageRows.length
      ? encodePostCursor({ id: pageRows[pageRows.length - 1].id, direction: 'next' })
      : null,
  }
}
