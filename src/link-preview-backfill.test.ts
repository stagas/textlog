import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { isYouTubeUrl } from './link-preview'
import { runBioLinkPreviewBackfill, runLinkPreviewBackfill, runPostOgPreviewRefetch,
  runR2LinkPreviewBackfill } from './link-preview-backfill'

describe('link preview backfill', () => {
  test('recognizes YouTube video hosts without matching lookalikes', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true)
    expect(isYouTubeUrl('https://www.youtube-nocookie.com/embed/abc')).toBe(true)
    expect(isYouTubeUrl('https://youtube.com.example.test/watch?v=abc')).toBe(false)
  })

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

  test('backfills existing bios and records each URL only once', async () => {
    const previousUrl = Bun.env.APP_URL
    Bun.env.APP_URL = 'http://localhost:3000'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,bio TEXT,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,deleted_at TEXT);
      CREATE TABLE user_bio_link_previews(user_id INTEGER,url TEXT,image_url TEXT,title TEXT,description TEXT,
        site_name TEXT,image_width INTEGER,image_height INTEGER,PRIMARY KEY(user_id,url));
      CREATE TABLE user_bio_link_preview_backfill_attempts(user_id INTEGER,url TEXT,status TEXT,attempted_at TEXT
        DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,url));
      INSERT INTO users(id,handle,bio) VALUES(1,'writer','See http://localhost:3000/post/1');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'linked note');`)
    try {
      expect(await runBioLinkPreviewBackfill(database, { delayMs: 0, log: () => {} }))
        .toEqual({ pending: 1, fetched: 1, saved: 1 })
      expect(database.query('SELECT url,title FROM user_bio_link_previews').get()).toEqual({
        url: 'http://localhost:3000/post/1',
        title: '@writer wrote on textlog',
      })
      expect(await runBioLinkPreviewBackfill(database, { delayMs: 0, log: () => {} }))
        .toEqual({ pending: 0, fetched: 0, saved: 0 })
    }
    finally {
      database.close()
      Bun.env.APP_URL = previousUrl
    }
  })

  test('refetches previews using an app post OG image exactly once', async () => {
    const previousUrl = Bun.env.APP_URL
    Bun.env.APP_URL = 'https://textlog.test'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY,body TEXT,deleted_at TEXT);
      CREATE TABLE post_link_previews(post_id INTEGER,url TEXT,image_url TEXT,title TEXT,description TEXT,
        site_name TEXT,image_width INTEGER,image_height INTEGER,PRIMARY KEY(post_id,url));
      CREATE TABLE post_link_preview_backfill_attempts(post_id INTEGER,url TEXT,status TEXT,attempted_at TEXT
        DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,url));
      INSERT INTO posts(id,body) VALUES(1,'one'),(2,'two'),(3,'three'),(4,'four'),(5,'five');
      INSERT INTO post_link_previews(post_id,url,image_url,title) VALUES
        (1,'https://remote.test/article','https://textlog.test/post/42/og.png?v=2','old'),
        (2,'https://other.test/article','https://cdn.test/post/42/og.png?v=2','untouched'),
        (3,'remote.test/no-protocol','textlog.test/post/43/og.png?v=2','old'),
        (4,'https://remote.test/previously-run','images/previous.webp','old'),
        (5,'https://legacy-textlog.test/post/142','https://legacy-textlog.test/post/142/og.png?v=2','old');
      INSERT INTO post_link_preview_backfill_attempts(post_id,url,status) VALUES
        (4,'https://remote.test/previously-run','post-og-v3-refetch-saved');`)
    const fetched: string[] = []
    const discoverPreviews = async (url: string) => {
      fetched.push(url)
      return [{ url, imageUrl: 'https://cdn.test/refetched.png', title: 'refetched', description: 'new preview',
        siteName: 'Remote', imageWidth: 1200, imageHeight: 630 }]
    }
    try {
      expect(await runPostOgPreviewRefetch(database, { log: () => {}, discoverPreviews }))
        .toEqual({ pending: 4, fetched: 4, saved: 4 })
      expect(database.query('SELECT image_url,title FROM post_link_previews WHERE post_id=1').get()).toEqual({
        image_url: 'https://cdn.test/refetched.png',
        title: 'refetched',
      })
      expect(database.query('SELECT image_url,title FROM post_link_previews WHERE post_id=2').get()).toEqual({
        image_url: 'https://cdn.test/post/42/og.png?v=2',
        title: 'untouched',
      })
      expect(await runPostOgPreviewRefetch(database, { log: () => {}, discoverPreviews }))
        .toEqual({ pending: 0, fetched: 0, saved: 0 })
      expect(fetched).toEqual([
        'https://remote.test/article',
        'https://remote.test/no-protocol',
        'https://remote.test/previously-run',
        'https://legacy-textlog.test/post/142',
      ])
    }
    finally {
      database.close()
      Bun.env.APP_URL = previousUrl
    }
  })
})

describe('R2 link preview backfill', () => {
  test('migrates legacy remote images serially and attempts each row only once', async () => {
    const previousUrl = Bun.env.APP_URL
    Bun.env.APP_URL = 'https://textlog.test'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY,body TEXT,deleted_at TEXT);
      CREATE TABLE post_link_previews(post_id INTEGER,url TEXT,image_url TEXT,title TEXT,description TEXT,
        site_name TEXT,image_width INTEGER,image_height INTEGER,PRIMARY KEY(post_id,url));
      CREATE TABLE post_link_preview_backfill_attempts(post_id INTEGER,url TEXT,status TEXT,attempted_at TEXT
        DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,url));
      INSERT INTO posts(id,body) VALUES(1,'one'),(2,'two');
      INSERT INTO post_link_previews(post_id,url,image_url) VALUES
        (1,'https://one.test','https://cdn.test/one.png'),
        (2,'https://two.test','https://cdn.test/two.png');`)
    let active = 0
    let maximumActive = 0
    const logs: string[] = []
    const failures: string[] = []
    let failSecondImage = true
    const storedUrls: string[] = []
    const storeImage = async (url: string) => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await Bun.sleep(5)
      active--
      storedUrls.push(url)
      if (url === 'https://cdn.test/two.png' && failSecondImage) throw new Error('test upload failure')
      return { key: `images/${crypto.randomUUID()}.png`, width: 1200, height: 630 }
    }
    try {
      expect(await runR2LinkPreviewBackfill(database, {
        log: message => logs.push(message),
        logFailure: (message, error) => failures.push(`${message}: ${(error as Error).message}`),
        storeImage,
      })).toEqual({ pending: 2, attempted: 2, saved: 1, failed: 1 })
      expect(maximumActive).toBe(1)
      expect(logs.some(message => message.includes('mode=serial delay=none'))).toBe(true)
      expect(logs.some(message => message.includes('key=images/'))).toBe(true)
      expect(storedUrls).toEqual(['https://cdn.test/one.png', 'https://cdn.test/two.png'])
      expect(failures).toEqual(['R2 link preview backfill failed post=2: test upload failure'])
      failSecondImage = false
      expect(await runR2LinkPreviewBackfill(database, { log: () => {}, storeImage }))
        .toEqual({ pending: 1, attempted: 1, saved: 1, failed: 0 })
      database.run(`INSERT INTO posts(id,body) VALUES(3,'three');
        INSERT INTO post_link_previews(post_id,url,image_url) VALUES
          (3,'https://three.test','https://cdn.test/three.png');
        INSERT INTO post_link_preview_backfill_attempts(post_id,url,status,attempted_at) VALUES
          (3,'https://three.test','r2-backfill-running',datetime('now','-16 minutes'));`)
      expect(await runR2LinkPreviewBackfill(database, { log: () => {}, storeImage }))
        .toEqual({ pending: 1, attempted: 1, saved: 1, failed: 0 })
      expect(await runR2LinkPreviewBackfill(database, { log: () => {}, storeImage }))
        .toEqual({ pending: 0, attempted: 0, saved: 0, failed: 0 })
      expect((database.query('SELECT status FROM post_link_preview_backfill_attempts ORDER BY post_id').all() as {
        status: string
      }[]).map(row => row.status)).toEqual(['r2-backfill-saved', 'r2-backfill-saved', 'r2-backfill-saved'])
    }
    finally {
      database.close()
      Bun.env.APP_URL = previousUrl
    }
  })
})
