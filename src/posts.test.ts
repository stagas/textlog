import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createPost, enrichPosts } from './posts'
import type { PostView } from './types'
import { linkify } from './utils'

function database() {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, bio TEXT DEFAULT '', deleted_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, parent_id INTEGER,
      body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL, tag TEXT NOT NULL CHECK(tag != 'fail'), PRIMARY KEY(post_id,tag));
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(post_id,user_id));
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(user_id,tag));
    CREATE TRIGGER reject_failed_tag BEFORE INSERT ON post_hashtags WHEN NEW.tag='fail'
      BEGIN SELECT RAISE(ABORT, 'metadata failure'); END;
    INSERT INTO users(id,handle) VALUES(1,'author'),(2,'reader');
  `)
  return db
}

describe('post persistence', () => {
  test('adds escaped bios to linkified post mentions', () => {
    expect(linkify('hello @Reader', { reader: 'Builder & "tester"' }))
      .toContain('<a href="/u/reader" title="Builder &amp; &quot;tester&quot;">@Reader</a>')
    expect(linkify('hello @Reader', { reader: '' }))
      .toContain('<a href="/u/reader" title="No bio yet.">@Reader</a>')
  })
  test('keeps apostrophes in linkified URLs', () => {
    expect(linkify("read https://example.com/people/O'Brien/profile"))
      .toBe("read <a href=\"https://example.com/people/O&#39;Brien/profile\" target=\"_blank\" rel=\"nofollow ugc noopener noreferrer\">https://example.com/people/O&#39;Brien/profile</a>")
  })
  test('supports Markdown links', () => {
    expect(linkify('[test](https://example.com/)'))
      .toBe('<a href="https://example.com/" title="https://example.com/" target="_blank" rel="nofollow ugc noopener noreferrer">test</a>')
  })
  test('opens links starting with APP_URL in the current tab', () => {
    expect(linkify('https://textlog.test/post/1', {}, [], 'https://textlog.test'))
      .toBe('<a href="https://textlog.test/post/1" rel="nofollow ugc">https://textlog.test/post/1</a>')
    expect(linkify('[post](https://textlog.test/post/1)', {}, [], 'https://textlog.test'))
      .toBe('<a href="https://textlog.test/post/1" title="https://textlog.test/post/1" rel="nofollow ugc">post</a>')
  })
  test('escapes Markdown link labels and destinations', () => {
    expect(linkify('[<test>](https://example.com/a\'b)'))
      .toBe('<a href="https://example.com/a&#39;b" title="https://example.com/a&#39;b" target="_blank" rel="nofollow ugc noopener noreferrer">&lt;test&gt;</a>')
  })

  test('highlights search terms without breaking escaping or links', () => {
    expect(linkify('Search <notes> at #Searchable', {}, ['sear']))
      .toBe('<mark>Sear</mark>ch &lt;notes&gt; at <a href="/tag/Searchable">#<mark>Sear</mark>chable</a>')
  })
  test('writes content and metadata atomically', () => {
    const db = database()
    expect(() => createPost(db, 1, 'rollback #fail @reader')).toThrow()
    expect(db.query('SELECT count(*) count FROM posts').get()).toEqual({ count: 0 })

    const result = createPost(db, 1, 'hello #build @reader')
    expect(result).toHaveProperty('id')
    expect(db.query('SELECT tag FROM post_hashtags').all()).toEqual([{ tag: 'build' }])
    expect(db.query('SELECT user_id FROM post_mentions').all()).toEqual([{ user_id: 2 }])
  })

  test('resolves mentions made with a previous handle', () => {
    const db = database()
    db.run('INSERT INTO handle_history(handle,user_id) VALUES(\'old_reader\',2)')

    createPost(db, 1, 'hello @old_reader')

    expect(db.query('SELECT user_id FROM post_mentions').all()).toEqual([{ user_id: 2 }])
  })

  test('preloads visible reply counts and parent summaries', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'parent','2026-08-03 10:00:00'),
      (2,2,1,'visible','2026-08-03 11:00:00'),
      (3,2,1,'deleted','2026-08-03 12:00:00');
      UPDATE posts SET deleted_at='2026-08-03 12:30:00' WHERE id=3;`)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    const [view] = enrichPosts(db, [child])
    expect(view.parent?.reply_count).toBe(1)
    expect(view.parent?.body).toBe('parent')
  })

  test('excludes blocked replies and parent summaries for the viewer', () => {
    const db = database()
    db.run(`INSERT INTO users(id,handle) VALUES(3,'blocked');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'parent','2026-08-03 10:00:00'),
        (2,2,1,'visible reply','2026-08-03 11:00:00'),
        (3,3,1,'blocked reply','2026-08-03 12:00:00');
      INSERT INTO blocks VALUES(2,3);`)
    const parentPost = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView
    expect(enrichPosts(db, [parentPost], 2)[0].reply_count).toBe(1)

    db.query('INSERT INTO blocks VALUES(?,?)').run(2, 1)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    expect(enrichPosts(db, [child], 2)[0].parent).toBeNull()
  })

  test('excludes replies and parent summaries carrying a blocked hashtag', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'parent #spoilers','2026-08-03 10:00:00'),
      (2,2,1,'visible reply','2026-08-03 11:00:00'),
      (3,1,1,'hidden reply #spoilers','2026-08-03 12:00:00');
      INSERT INTO post_hashtags VALUES(1,'spoilers'),(3,'spoilers');
      INSERT INTO blocked_hashtags VALUES(2,'spoilers');`)
    const parentPost = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView
    expect(enrichPosts(db, [parentPost], 2)[0].reply_count).toBe(1)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    expect(enrichPosts(db, [child], 2)[0].parent).toBeNull()
  })
})
