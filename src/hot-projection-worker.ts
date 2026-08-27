import { Database } from 'bun:sqlite'
import { defaultDatabasePath } from './database-backup'
import { hotFeedProjectionNeedsRefresh, refreshHotFeedProjection } from './hot'

declare const self: Worker

const database = new Database(defaultDatabasePath, { create: false, strict: true })
const busyTimeoutMs = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
database.run(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
  PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=${busyTimeoutMs};`)

self.onmessage = event => {
  try {
    const now = new Date((event.data as { now?: string }).now || Date.now())
    if (!hotFeedProjectionNeedsRefresh(database, now.getTime())) {
      self.postMessage({ refreshed: false })
      return
    }
    self.postMessage({ refreshed: true, ...refreshHotFeedProjection(database, now) })
  }
  catch (error) {
    self.postMessage({ error: error instanceof Error ? error.stack || error.message : String(error) })
  }
}
