import React from 'preact/compat'

export const FEED_CHUNK_SIZE = 20
export const FEED_CHUNKS_PER_PAGE = 5

export function feedChunk(value?: string) {
  if (value === undefined) return 0
  const chunk = Number(value)
  return Number.isInteger(chunk) && chunk >= 1 && chunk < FEED_CHUNKS_PER_PAGE ? chunk : null
}

export function restoredFeedChunks(value?: string) {
  if (value === undefined) return 1
  const chunks = Number(value)
  return Number.isInteger(chunks) && chunks >= 1 && chunks <= FEED_CHUNKS_PER_PAGE ? chunks : null
}

export function chunkItems<T>(items: T[], chunk: number) {
  const start = chunk * FEED_CHUNK_SIZE
  return items.slice(start, start + FEED_CHUNK_SIZE)
}

/** Preserve which progressively loaded chunk an item's return path belongs to. */
export function feedChunkReturnPath(path: string, chunk: number) {
  if (chunk === 0) return path
  const url = new URL(path, 'http://textlog.local')
  url.searchParams.set('chunk', String(chunk + 1))
  return url.pathname + url.search + url.hash
}

export function InfiniteFeedChunk({ chunk, hasMore, children }: {
  chunk: number
  hasMore: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <div className="infinite-feed-chunk" data-feed-chunk={chunk + 1}>{children}</div>
      {hasMore && chunk + 1 < FEED_CHUNKS_PER_PAGE
        && <div className="infinite-feed-sentinel" data-feed-next={chunk + 1} aria-hidden="true" />}
    </>
  )
}
