import type { Database } from 'bun:sqlite'
import { discoverLinkPreviews, isDirectImageUrl, saveLinkPreviews } from './link-preview'
import { postLinks } from './utils'

export const LINK_PREVIEW_BACKFILL_DELAY_MS = 2500

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function runLinkPreviewBackfill(database: Database, options: {
  delayMs?: number
  log?: (message: string) => void
  directImagesOnly?: boolean
} = {}) {
  const delayMs = options.delayMs ?? LINK_PREVIEW_BACKFILL_DELAY_MS
  const log = options.log || console.log
  const rows = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL ORDER BY id')
    .all() as { id: number; body: string }[]
  const attempted = database.query(
    'SELECT status FROM post_link_preview_backfill_attempts WHERE post_id=? AND url=?',
  )
  const existing = database.query('SELECT 1 FROM post_link_previews WHERE post_id=? AND url=?')
  const record = database.query(`INSERT OR REPLACE INTO post_link_preview_backfill_attempts(post_id,url,status)
    VALUES(?,?,?)`)
  const pending = rows.flatMap(post => postLinks(post.body).map(url => ({ postId: post.id, url })))
    .filter(item => {
      if (options.directImagesOnly && !isDirectImageUrl(item.url)) return false
      const previous = attempted.get(item.postId, item.url) as { status: string } | null
      return !previous || (isDirectImageUrl(item.url) && previous.status === 'no-preview')
    })
  log(`link preview backfill start pending=${pending.length} delay=${delayMs}ms${
    options.directImagesOnly ? ' direct-images-only=true' : ''
  }`)
  let fetched = 0
  let saved = 0
  for (const item of pending) {
    if (existing.get(item.postId, item.url)) {
      record.run(item.postId, item.url, 'existing')
      log(`link preview backfill existing post=${item.postId} url=${item.url}`)
      continue
    }
    if (fetched) await wait(delayMs)
    log(`link preview backfill fetch post=${item.postId} url=${item.url}`)
    const previews = await discoverLinkPreviews(item.url, database)
    saveLinkPreviews(database, item.postId, previews)
    const status = previews.length ? 'saved' : isDirectImageUrl(item.url) ? 'no-preview-direct' : 'no-preview'
    record.run(item.postId, item.url, status)
    fetched++
    if (previews.length) saved++
    log(`link preview backfill ${status} post=${item.postId} url=${item.url}`)
  }
  log(`link preview backfill complete fetched=${fetched} saved=${saved}`)
  return { pending: pending.length, fetched, saved }
}
