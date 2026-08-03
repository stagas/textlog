import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createPost, enrichPosts } from './posts'
import type { PostView } from './types'

function database() {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, parent_id INTEGER,
      body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL, tag TEXT NOT NULL CHECK(tag != 'fail'), PRIMARY KEY(post_id,tag));
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(post_id,user_id));
    CREATE TRIGGER reject_failed_tag BEFORE INSERT ON post_hashtags WHEN NEW.tag='fail'
      BEGIN SELECT RAISE(ABORT, 'metadata failure'); END;
    INSERT INTO users(id,handle) VALUES(1,'author'),(2,'reader');
  `)
  return db
}

describe('post persistence', () => {
  test('writes content and metadata atomically', () => {
    const db = database()
    expect(() => createPost(db, 1, 'rollback #fail @reader')).toThrow()
    expect(db.query('SELECT count(*) count FROM posts').get()).toEqual({ count: 0 })

    const result = createPost(db, 1, 'hello #build @reader')
    expect(result).toHaveProperty('id')
    expect(db.query('SELECT tag FROM post_hashtags').all()).toEqual([{ tag: 'build' }])
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
})
