import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

function defaultCachePath() {
  if (Bun.env.CACHE_DATABASE_PATH) return Bun.env.CACHE_DATABASE_PATH
  const source = Bun.env.DATABASE_PATH || 'storage/textlog.sqlite'
  if (source === ':memory:') return ':memory:'
  const extension = extname(source)
  const name = basename(source, extension)
  return join(dirname(source), `${name}.cache${extension || '.sqlite'}`)
}

export function createCacheDatabase(path = defaultCachePath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const database = new Database(path, { create: true, strict: true })
  const busyTimeoutMs = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
  database.run(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
    PRAGMA temp_store=MEMORY; PRAGMA cache_size=-16384; PRAGMA mmap_size=67108864;
    PRAGMA busy_timeout=${busyTimeoutMs};
    CREATE TABLE IF NOT EXISTS feed_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,
      generation INTEGER NOT NULL,total_items INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(kind,viewer_id,generation));
    CREATE TABLE IF NOT EXISTS feed_snapshot_items (
      snapshot_id INTEGER NOT NULL REFERENCES feed_snapshots(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,position));
    CREATE INDEX IF NOT EXISTS feed_snapshots_lookup ON feed_snapshots(kind,viewer_id,generation);
    CREATE INDEX IF NOT EXISTS feed_snapshots_last_accessed ON feed_snapshots(last_accessed_at);
    CREATE TABLE IF NOT EXISTS materialized_feed_pages_v2 (
      kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,variant TEXT NOT NULL,generation INTEGER NOT NULL,html TEXT NOT NULL,
      strict_generation INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(kind,viewer_id,variant,generation));
    CREATE INDEX IF NOT EXISTS materialized_feed_pages_v2_created ON materialized_feed_pages_v2(created_at);
    CREATE TABLE IF NOT EXISTS global_feed_page_cursors (
      kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,page_size INTEGER NOT NULL,page INTEGER NOT NULL,
      before_rank INTEGER,before_text TEXT,before_id INTEGER,generation TEXT NOT NULL,
      PRIMARY KEY(kind,viewer_id,page_size,page));
    CREATE TABLE IF NOT EXISTS recent_feed_visitors (
      user_id INTEGER PRIMARY KEY,request_url TEXT NOT NULL,cookie TEXT NOT NULL,page_size INTEGER NOT NULL,
      density TEXT NOT NULL,last_visited_at INTEGER NOT NULL,user_agent TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS recent_feed_visitors_visited ON recent_feed_visitors(last_visited_at DESC);`)
  const materializedColumns = database.query('PRAGMA table_info(materialized_feed_pages_v2)').all() as Array<{
    name: string
  }>
  if (!materializedColumns.some(column => column.name === 'strict_generation')) {
    database.run('ALTER TABLE materialized_feed_pages_v2 ADD COLUMN strict_generation INTEGER NOT NULL DEFAULT 0')
  }
  const recentVisitorColumns = database.query('PRAGMA table_info(recent_feed_visitors)').all() as Array<{
    name: string
  }>
  if (!recentVisitorColumns.some(column => column.name === 'user_agent')) {
    database.run("ALTER TABLE recent_feed_visitors ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''")
  }
  const globalCursorColumns = database.query('PRAGMA table_info(global_feed_page_cursors)').all() as Array<{
    name: string
  }>
  if (!globalCursorColumns.some(column => column.name === 'before_text')) {
    database.run('ALTER TABLE global_feed_page_cursors ADD COLUMN before_text TEXT')
  }
  if (!globalCursorColumns.some(column => column.name === 'before_id')) {
    database.run('ALTER TABLE global_feed_page_cursors ADD COLUMN before_id INTEGER')
  }
  return database
}

export function clearCacheDatabase(database: Database, preserveRecentVisitors = false) {
  database.transaction(() => {
    database.query('DELETE FROM feed_snapshots').run()
    database.query('DELETE FROM materialized_feed_pages_v2').run()
    database.query('DELETE FROM global_feed_page_cursors').run()
    if (!preserveRecentVisitors) database.query('DELETE FROM recent_feed_visitors').run()
  })()
}

export const cacheDb = createCacheDatabase()
