import type { Database } from 'bun:sqlite'
import { activeRequest } from './theme'

export const MAX_MATERIALIZED_PAGES = 1_024

function appearanceVariant(request: Request) {
  request = activeRequest(request)
  const cookie = request.headers.get('cookie') || ''
  const names = ['appearance', 'font', 'sans-serif-font', 'primary-font', 'font-size', 'corners', 'notification_device']
  return names.map(name => cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || '').join('|')
}

/** Reuse the fully rendered anonymous first page until a database mutation advances the feed generation. */
export type MaterializedFeedKind = 'latest' | 'new' | 'hot' | 'for-you' | 'to-me'

export function invalidateMaterializedFeedPages(viewerId: number, kinds: MaterializedFeedKind[], cache: Database) {
  if (!kinds.length) return
  cache.query(`DELETE FROM materialized_feed_pages_v2 WHERE viewer_id=? AND kind IN
    (${kinds.map(() => '?').join(',')})`).run(viewerId, ...kinds)
}

export async function materializedFeedPage(database: Database, request: Request, kind: MaterializedFeedKind,
  viewerId: number, render: () => Response, cache: Database, rerenderForCache = false, cacheVersion = 0)
{
  // Cached development HTML embeds the server's boot ID. Reusing it after a
  // restart makes the reload client refresh forever, so keep dev pages live.
  if (Bun.env.DEV_RELOAD === 'true') return render()

  const generation = (database.query('SELECT generation FROM feed_snapshot_generation WHERE id=1').get() as {
    generation: number
  }).generation
  const variant = `3|${cacheVersion ? `${cacheVersion}|` : ''}${appearanceVariant(request)}`
  const cached = cache.query(`SELECT html FROM materialized_feed_pages_v2
    WHERE kind=? AND viewer_id=? AND variant=? AND generation=?`).get(kind, viewerId, variant, generation) as {
    html: string
  } | null
  if (cached) {
    cache.query(`UPDATE materialized_feed_pages_v2 SET created_at=CURRENT_TIMESTAMP
      WHERE kind=? AND viewer_id=? AND variant=? AND generation=?
        AND created_at < datetime('now','-5 minutes')`).run(kind, viewerId, variant, generation)
    return new Response(cached.html, {
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }

  const response = render()
  if (response.status !== 200) return response
  const html = await response.text()
  const cachedHtml = rerenderForCache ? await render().text() : html
  cache.transaction(() => {
    cache.query('DELETE FROM materialized_feed_pages_v2 WHERE kind=? AND viewer_id=? AND generation!=?')
      .run(kind, viewerId, generation)
    cache.query(`INSERT OR REPLACE INTO materialized_feed_pages_v2(kind,viewer_id,variant,generation,html)
      VALUES(?,?,?,?,?)`).run(kind, viewerId, variant, generation, cachedHtml)
    cache.query(`DELETE FROM materialized_feed_pages_v2 WHERE rowid IN (
      SELECT rowid FROM materialized_feed_pages_v2 ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET ?
    )`).run(MAX_MATERIALIZED_PAGES)
  })()
  return new Response(html, { status: response.status, headers: response.headers })
}
