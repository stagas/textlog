import { describe, expect, test } from 'bun:test'
import { decodePostCursor, encodePostCursor, postCursorPage } from './pagination'

describe('post cursor pagination', () => {
  test('round trips valid cursors and rejects malformed values', () => {
    const cursor = { id: 42, direction: 'next' as const }
    expect(decodePostCursor(encodePostCursor(cursor))).toEqual(cursor)
    expect(decodePostCursor('broken')).toBeNull()
    expect(decodePostCursor(Buffer.from(JSON.stringify([1, 0, 'next'])).toString('base64url'))).toBeNull()
  })

  test('builds forward and backward pages without duplicate boundary rows', () => {
    const first = postCursorPage([{ id: 5 }, { id: 4 }, { id: 3 }], null, 2)
    expect(first.rows.map(row => row.id)).toEqual([5, 4])
    expect(first.previousCursor).toBeNull()
    expect(decodePostCursor(first.nextCursor!)).toEqual({ id: 4, direction: 'next' })

    const previous = postCursorPage([{ id: 4 }, { id: 5 }, { id: 6 }], { id: 3, direction: 'previous' }, 2)
    expect(previous.rows.map(row => row.id)).toEqual([5, 4])
    expect(decodePostCursor(previous.previousCursor!)).toEqual({ id: 5, direction: 'previous' })
    expect(decodePostCursor(previous.nextCursor!)).toEqual({ id: 4, direction: 'next' })
  })
})
