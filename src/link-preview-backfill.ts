import type { Database } from 'bun:sqlite'
import { discoverLinkPreviews, saveLinkPreviews } from './link-preview'
import { postLinks } from './utils'

export const LINK_PREVIEW_BACKFILL_DELAY_MS = 2500

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function runLinkPreviewBackfill(database: Database, options: {
  delayMs?: number
  log?: (message: string) => void
} = {}) {
  const delayMs = options.delayMs ?? LINK_PREVIEW_BACKFILL_DELAY_MS
  const log = options.log || console.log
  const rows = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL ORDER BY id')
    .all() as { id: number; body: string }[]
  const attempted = database.query(
    'SELECT 1 FROM post_link_preview_backfill_attempts WHERE post_id=? AND url=?',
  )
  const existing = database.query('SELECT 1 FROM post_link_previews WHERE post_id=? AND url=?')
  const record = database.query(`INSERT OR REPLACE INTO post_link_preview_backfill_attempts(post_id,url,status)
    VALUES(?,?,?)`)
  const pending = rows.flatMap(post => postLinks(post.body).map(url => ({ postId: post.id, url })))
    .filter(item => !attempted.get(item.postId, item.url))
  log(`link preview backfill start pending=${pending.length} delay=${delayMs}ms`)
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
    const status = previews.length ? 'saved' : 'no-preview'
    record.run(item.postId, item.url, status)
    fetched++
    if (previews.length) saved++
    log(`link preview backfill ${status} post=${item.postId} url=${item.url}`)
  }
  log(`link preview backfill complete fetched=${fetched} saved=${saved}`)
  return { pending: pending.length, fetched, saved }
}

let started = false

export function startLinkPreviewBackfill(database: Database, onError: (error: unknown) => void = console.error) {
  if (started) return
  started = true
  void runLinkPreviewBackfill(database).catch(onError)
}
