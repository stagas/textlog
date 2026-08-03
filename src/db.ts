import { Database } from 'bun:sqlite'
import { extractMentions } from './content'

export const db = new Database('storage/root.sqlite', { create: true })
const postMentionsExisted = !!db.query(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_mentions'",
).get()
db.run(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, bio TEXT DEFAULT '', password TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 280), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS follows (follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(follower_id, following_id));
CREATE TABLE IF NOT EXISTS hashtag_follows (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(user_id, tag));
CREATE TABLE IF NOT EXISTS post_hashtags (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(post_id, tag));
CREATE TABLE IF NOT EXISTS post_mentions (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id, user_id));
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);`)

const postColumns = db.query('PRAGMA table_info(posts)').all() as { name: string }[]
if (!postColumns.some(column => column.name === 'parent_id')) {
  db.run('ALTER TABLE posts ADD COLUMN parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE')
}
if (!postColumns.some(column => column.name === 'deleted_at')) {
  db.run('ALTER TABLE posts ADD COLUMN deleted_at TEXT')
}
db.run('CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id, created_at)')
db.run('CREATE INDEX IF NOT EXISTS posts_user_created ON posts(user_id, created_at DESC)')
db.run('CREATE INDEX IF NOT EXISTS post_mentions_user ON post_mentions(user_id, post_id)')

if (!postMentionsExisted) {
  const users = db.query('SELECT id,handle FROM users').all() as { id: number; handle: string }[]
  const userIds = new Map(users.map(user => [user.handle.toLowerCase(), user.id]))
  const posts = db.query('SELECT id,body FROM posts WHERE deleted_at IS NULL').all() as { id: number; body: string }[]
  db.transaction(() => {
    const insert = db.query('INSERT OR IGNORE INTO post_mentions(post_id,user_id) VALUES(?,?)')
    for (const post of posts) {
      for (const handle of extractMentions(post.body)) {
        const userId = userIds.get(handle)
        if (userId) insert.run(post.id, userId)
      }
    }
  })()
}

const userColumns = db.query('PRAGMA table_info(users)').all() as { name: string }[]
if (userColumns.some(column => column.name === 'name')) db.run('ALTER TABLE users DROP COLUMN name')
if (!userColumns.some(column => column.name === 'deleted_at')) {
  db.run('ALTER TABLE users ADD COLUMN deleted_at TEXT')
}

export type User = { id: number; handle: string; email: string; bio: string }
