import type { Database } from 'bun:sqlite'
import { PAGE_SIZE } from './pagination'

export type FeedSnapshotPage<T> = {
  items: T[]
  page: number
  totalItems: number
  totalPages: number
}

/** Persist an ordered feed generation so restarts do not force it to be rebuilt. */
export function feedSnapshotPage<T>(database: Database, kind: string, viewerId: number, page: number,
  build: () => T[], pageSize = PAGE_SIZE): FeedSnapshotPage<T>
{
  const generation = (database.query('SELECT generation FROM feed_snapshot_generation WHERE id=1').get() as {
    generation: number
  }).generation
  let snapshot = database.query(`SELECT id,total_items,created_at FROM feed_snapshots
    WHERE kind=? AND viewer_id=? AND generation=?`).get(kind, viewerId, generation) as { id: number;
    total_items: number; created_at: string } | null
  if (snapshot && kind === 'hot'
    && Date.now() - Date.parse(`${snapshot.created_at.replace(' ', 'T')}Z`) > 15 * 60_000) snapshot = null

  if (!snapshot) {
    const items = build()
    database.transaction(() => {
      database.query('DELETE FROM feed_snapshots WHERE kind=? AND viewer_id=?').run(kind, viewerId)
      const result = database.query(`INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items)
        VALUES(?,?,?,?)`).run(kind, viewerId, generation, items.length)
      const snapshotId = Number(result.lastInsertRowid)
      const insert = database.query(`INSERT INTO feed_snapshot_items(snapshot_id,position,payload)
        VALUES(?,?,?)`)
      for (let position = 0; position < items.length; position++) {
        insert.run(snapshotId, position, JSON.stringify(items[position]))
      }
    })()
    snapshot = database.query(`SELECT id,total_items,created_at FROM feed_snapshots
      WHERE kind=? AND viewer_id=? AND generation=?`).get(kind, viewerId, generation) as { id: number;
      total_items: number; created_at: string }
  }

  const totalPages = Math.max(1, Math.ceil(snapshot.total_items / pageSize))
  const safePage = Math.min(page, totalPages)
  const rows = database.query(`SELECT payload FROM feed_snapshot_items WHERE snapshot_id=?
    AND position>=? AND position<? ORDER BY position`).all(
    snapshot.id,
    (safePage - 1) * pageSize,
    safePage * pageSize,
  ) as { payload: string }[]
  return { items: rows.map(row => JSON.parse(row.payload) as T), page: safePage, totalItems: snapshot.total_items,
    totalPages }
}
