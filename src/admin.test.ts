import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { anonymizeUser, isAdmin, isAdminEmail, recordAdminAction, resolvePostReports, softDeletePost } from './admin'

function testDatabase() {
  const database = new Database(':memory:')
  database.run(`PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT DEFAULT '',password TEXT DEFAULT 'x',
      suspended_at TEXT,deleted_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER,body TEXT,deleted_at TEXT);
    CREATE TABLE sessions (token TEXT,user_id INTEGER);
    CREATE TABLE password_resets (user_id INTEGER);
    CREATE TABLE follows (follower_id INTEGER,following_id INTEGER);
    CREATE TABLE hashtag_follows (user_id INTEGER,tag TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
    CREATE TABLE post_mentions (post_id INTEGER,user_id INTEGER);
    CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
    CREATE TABLE reports (id INTEGER PRIMARY KEY,reporter_id INTEGER,post_id INTEGER,status TEXT DEFAULT 'open',
      resolved_at TEXT,resolved_by INTEGER);
    CREATE TABLE admin_actions (id INTEGER PRIMARY KEY,actor_id INTEGER,action TEXT,target_user_id INTEGER,
      target_post_id INTEGER,note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`)
  database.run(`INSERT INTO users(id,handle,email) VALUES
    (1,'admin','gstagas@gmail.com'),(2,'author','author@example.com'),(3,'reporter','reporter@example.com');
    INSERT INTO posts(id,user_id,body) VALUES(10,2,'reported post');
    INSERT INTO post_hashtags VALUES(10,'topic');
    INSERT INTO post_mentions VALUES(10,3);
    INSERT INTO reports(id,reporter_id,post_id) VALUES(20,3,10);
    INSERT INTO sessions VALUES('active',2);`)
  return database
}

describe('admin authorization', () => {
  test('matches the hardcoded email case-insensitively', () => {
    expect(isAdminEmail(' GSTAGAS@gmail.com ')).toBe(true)
    expect(isAdmin({ email: 'gstagas@gmail.com' } as any)).toBe(true)
    expect(isAdmin({ email: 'someone@example.com' } as any)).toBe(false)
  })
})

describe('admin moderation persistence', () => {
  test('deletes a post, resolves its open reports, and records the action', () => {
    const database = testDatabase()
    database.transaction(() => {
      softDeletePost(database, 10)
      resolvePostReports(database, 10, 1)
      recordAdminAction(database, 1, 'delete_post', 2, 10, ' confirmed violation ')
    })()

    expect(database.query('SELECT body,deleted_at FROM posts WHERE id=10').get()).toMatchObject({ body: '(deleted)' })
    expect(database.query('SELECT * FROM post_hashtags').all()).toHaveLength(0)
    expect(database.query('SELECT status,resolved_by FROM reports WHERE id=20').get())
      .toMatchObject({ status: 'resolved', resolved_by: 1 })
    expect(database.query('SELECT action,note FROM admin_actions').get())
      .toEqual({ action: 'delete_post', note: 'confirmed violation' })
  })

  test('anonymizes an account, invalidates sessions, and preserves resolved report records', () => {
    const database = testDatabase()
    anonymizeUser(database, 2, 1)

    expect(database.query('SELECT handle,email,deleted_at FROM users WHERE id=2').get())
      .toMatchObject({ handle: 'deleted-2', email: 'deleted-2@root.mx' })
    expect(database.query('SELECT * FROM sessions WHERE user_id=2').all()).toHaveLength(0)
    expect(database.query('SELECT body,deleted_at FROM posts WHERE id=10').get()).toMatchObject({ body: '(deleted)' })
    expect(database.query('SELECT status,resolved_by FROM reports WHERE id=20').get())
      .toMatchObject({ status: 'resolved', resolved_by: 1 })
  })
})
