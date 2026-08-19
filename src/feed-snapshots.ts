import type { Database } from 'bun:sqlite'
import { cacheDb } from './cache-db'
import { PAGE_SIZE } from './pagination'

const SNAPSHOT_MAX_AGE = '-1 day'
const SNAPSHOT_ACCESS_REFRESH = '-5 minutes'
const MAX_SNAPSHOTS = 200

export type FeedSnapshotPage<T> = {
  snapshotId: number
  items: T[]
  page: number
  totalItems: number
  totalPages: number
}

/** Persist an ordered feed generation so restarts do not force it to be rebuilt. */
export function feedSnapshotPage<T>(database: Database, kind: string, viewerId: number, page: number, build: () => T[],
  pageSize = PAGE_SIZE, cache: Database = cacheDb): FeedSnapshotPage<T>
{
  const storage = kind === 'latest' || kind === 'hot' || kind.startsWith('hot:') ? cache : database
  const generation = (database.query('SELECT generation FROM feed_snapshot_generation WHERE id=1').get() as {
    generation: number
  }).generation
  let snapshot = storage.query(`SELECT id,total_items,created_at FROM feed_snapshots
    WHERE kind=? AND viewer_id=? AND generation=?`).get(kind, viewerId, generation) as { id: number;
    total_items: number; created_at: string } | null
  if (snapshot && (kind === 'hot' || kind.startsWith('hot:'))
    && Date.now() - Date.parse(`${snapshot.created_at.replace(' ', 'T')}Z`) > 15 * 60_000) snapshot = null

  if (!snapshot) {
    const items = build()
    storage.transaction(() => {
      storage.query(`DELETE FROM feed_snapshots
        WHERE last_accessed_at < datetime('now', ?)`).run(SNAPSHOT_MAX_AGE)
      if (kind.startsWith('hot:')) {
        storage.query(`DELETE FROM feed_snapshots
          WHERE kind LIKE 'hot:%' AND kind != ?`).run(kind)
      }
      storage.query('DELETE FROM feed_snapshots WHERE kind=? AND viewer_id=?').run(kind, viewerId)
      const result = storage.query(`INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items)
        VALUES(?,?,?,?)`).run(kind, viewerId, generation, items.length)
      const snapshotId = Number(result.lastInsertRowid)
      const insert = storage.query(`INSERT INTO feed_snapshot_items(snapshot_id,position,payload)
        VALUES(?,?,?)`)
      for (let position = 0; position < items.length; position++) {
        insert.run(snapshotId, position, JSON.stringify(items[position]))
      }
      storage.query(`DELETE FROM feed_snapshots WHERE id IN (
        SELECT id FROM feed_snapshots WHERE id != ?
        ORDER BY last_accessed_at DESC,id DESC LIMIT -1 OFFSET ?
      )`).run(snapshotId, MAX_SNAPSHOTS - 1)
    })()
    snapshot = storage.query(`SELECT id,total_items,created_at FROM feed_snapshots
      WHERE kind=? AND viewer_id=? AND generation=?`).get(kind, viewerId, generation) as { id: number;
      total_items: number; created_at: string }
  }

  storage.query(`UPDATE feed_snapshots SET last_accessed_at=CURRENT_TIMESTAMP
    WHERE id=? AND last_accessed_at < datetime('now', ?)`).run(snapshot.id, SNAPSHOT_ACCESS_REFRESH)

  const totalPages = Math.max(1, Math.ceil(snapshot.total_items / pageSize))
  const safePage = Math.min(page, totalPages)
  const rows = storage.query(`SELECT payload FROM feed_snapshot_items WHERE snapshot_id=?
    AND position>=? AND position<? ORDER BY position`).all(
    snapshot.id,
    (safePage - 1) * pageSize,
    safePage * pageSize,
  ) as { payload: string }[]
  return { snapshotId: snapshot.id, items: rows.map(row => JSON.parse(row.payload) as T), page: safePage,
    totalItems: snapshot.total_items, totalPages }
}
