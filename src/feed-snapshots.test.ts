import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { feedSnapshotPage } from './feed-snapshots'

function database() {
  const db = new Database(':memory:', { strict: true })
  db.run(`PRAGMA foreign_keys=ON;
    CREATE TABLE feed_snapshot_generation(id INTEGER PRIMARY KEY,generation INTEGER NOT NULL);
    INSERT INTO feed_snapshot_generation VALUES(1,1);
    CREATE TABLE feed_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,
      generation INTEGER NOT NULL,total_items INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(kind,viewer_id,generation));
    CREATE TABLE feed_snapshot_items(snapshot_id INTEGER REFERENCES feed_snapshots(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,position));`)
  return db
}

test('persistent feed snapshots reuse a generation and rebuild after invalidation', () => {
  const db = database()
  let builds = 0
  const build = () => {
    builds++
    return Array.from({ length: 25 }, (_, id) => ({ id }))
  }
  expect(feedSnapshotPage(db, 'hot', -1, 1, build).items).toHaveLength(20)
  expect(feedSnapshotPage(db, 'hot', -1, 2, build).items.map(item => item.id)).toEqual([20, 21, 22, 23, 24])
  expect(builds).toBe(1)

  db.run('UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1')
  expect(feedSnapshotPage(db, 'hot', -1, 1, build).totalPages).toBe(2)
  expect(builds).toBe(2)
  expect((db.query('SELECT count(*) count FROM feed_snapshots').get() as { count: number }).count).toBe(1)
})
