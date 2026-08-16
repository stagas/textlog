import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runLinkPreviewBackfill } from './link-preview-backfill'

describe('link preview backfill', () => {
  test('records attempts, logs work, and does not crawl the same link twice', async () => {
    const previousUrl = Bun.env.APP_URL
    Bun.env.APP_URL = 'http://localhost:3000'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,deleted_at TEXT);
      CREATE TABLE post_link_previews(post_id INTEGER,url TEXT,image_url TEXT,title TEXT,description TEXT,
        site_name TEXT,image_width INTEGER,image_height INTEGER,PRIMARY KEY(post_id,url));
      CREATE TABLE post_link_preview_backfill_attempts(post_id INTEGER,url TEXT,status TEXT,attempted_at TEXT
        DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,url));
      INSERT INTO users(id,handle) VALUES(1,'writer');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'linked post'),
        (2,1,'see http://localhost:3000/post/1');`)
    const logs: string[] = []
    try {
      expect(await runLinkPreviewBackfill(database, { delayMs: 0, log: message => logs.push(message) }))
        .toEqual({ pending: 1, fetched: 1, saved: 1 })
      expect(logs.some(message => message.includes('fetch post=2'))).toBe(true)
      expect(logs.some(message => message.includes('saved post=2'))).toBe(true)
      expect(await runLinkPreviewBackfill(database, { delayMs: 0, log: message => logs.push(message) }))
        .toEqual({ pending: 0, fetched: 0, saved: 0 })
    }
    finally {
      database.close()
      Bun.env.APP_URL = previousUrl
    }
  })
})
