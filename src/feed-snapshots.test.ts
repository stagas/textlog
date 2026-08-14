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
      last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

test('larger page sizes combine 20-item materialized page units without rebuilding', () => {
  const db = database()
  let builds = 0
  const build = () => {
    builds++
    return Array.from({ length: 105 }, (_, id) => ({ id }))
  }
  const page = feedSnapshotPage(db, 'latest', -1, 2, build, 40)
  expect(page.items.map(item => item.id)).toEqual(Array.from({ length: 40 }, (_, index) => index + 40))
  expect(page.totalPages).toBe(3)
  expect(feedSnapshotPage(db, 'latest', -1, 1, build, 80).items).toHaveLength(80)
  expect(builds).toBe(1)
})

test('snapshot creation removes stale, obsolete hot, and least recently used snapshots', () => {
  const db = database()
  const insert = db.query(`INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items,last_accessed_at)
    VALUES(?,?,1,0,?)`)
  insert.run('stale', 1, '2000-01-01 00:00:00')
  insert.run('hot:old', 1, '2999-01-01 00:00:00')
  for (let id = 0; id < 205; id++) insert.run(`profile:${id}:notes`, id, '2999-01-01 00:00:00')

  feedSnapshotPage(db, 'hot:new', -1, 1, () => [{ id: 1 }])

  expect(db.query("SELECT count(*) count FROM feed_snapshots WHERE kind IN ('stale','hot:old')").get())
    .toEqual({ count: 0 })
  expect(db.query('SELECT count(*) count FROM feed_snapshots').get()).toEqual({ count: 200 })
  expect(db.query("SELECT count(*) count FROM feed_snapshots WHERE kind='hot:new'").get()).toEqual({ count: 1 })
})
