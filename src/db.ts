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
CREATE TABLE IF NOT EXISTS email_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('verify','change')), email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 280), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS follows (follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(follower_id, following_id));
CREATE TABLE IF NOT EXISTS hashtag_follows (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(user_id, tag));
CREATE TABLE IF NOT EXISTS post_hashtags (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(post_id, tag));
CREATE TABLE IF NOT EXISTS post_mentions (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS blocks (blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(blocker_id, blocked_id), CHECK(blocker_id != blocked_id));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, reason TEXT NOT NULL CHECK(reason IN ('harassment','spam','impersonation','other')), created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(reporter_id, post_id));
CREATE TABLE IF NOT EXISTS auth_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, key_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS daily_visitors (day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY(day,visitor_hash));
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
db.run('CREATE INDEX IF NOT EXISTS post_hashtags_tag ON post_hashtags(tag, post_id)')
db.run('CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id, blocker_id)')
db.run('CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at DESC)')
db.run('CREATE INDEX IF NOT EXISTS auth_rate_limits_lookup ON auth_rate_limits(scope,key_hash,created_at)')
db.run('CREATE INDEX IF NOT EXISTS daily_visitors_hash_day ON daily_visitors(visitor_hash,day)')

const followColumns = db.query('PRAGMA table_info(follows)').all() as { name: string }[]
if (!followColumns.some(column => column.name === 'created_at')) {
  // Leave pre-existing follows undated so a deployment does not turn them into new activity.
  db.run('ALTER TABLE follows ADD COLUMN created_at TEXT')
}
db.run('CREATE INDEX IF NOT EXISTS follows_activity ON follows(following_id, created_at DESC)')

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
if (!userColumns.some(column => column.name === 'suspended_at')) {
  db.run('ALTER TABLE users ADD COLUMN suspended_at TEXT')
}
if (!userColumns.some(column => column.name === 'email_verified_at')) {
  db.run('ALTER TABLE users ADD COLUMN email_verified_at TEXT')
}

const sessionColumns = db.query('PRAGMA table_info(sessions)').all() as { name: string }[]
if (!sessionColumns.some(column => column.name === 'created_at')) {
  db.run('ALTER TABLE sessions ADD COLUMN created_at INTEGER')
  db.run('UPDATE sessions SET created_at=expires_at-2592000000 WHERE created_at IS NULL')
}
if (!sessionColumns.some(column => column.name === 'user_agent')) {
  db.run("ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''")
}

const reportColumns = db.query('PRAGMA table_info(reports)').all() as { name: string }[]
if (!reportColumns.some(column => column.name === 'status')) {
  db.run("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'")
}
if (!reportColumns.some(column => column.name === 'resolved_at')) {
  db.run('ALTER TABLE reports ADD COLUMN resolved_at TEXT')
}
if (!reportColumns.some(column => column.name === 'resolved_by')) {
  db.run('ALTER TABLE reports ADD COLUMN resolved_by INTEGER REFERENCES users(id)')
}
db.run('CREATE INDEX IF NOT EXISTS reports_status_created ON reports(status,created_at DESC)')
db.run(`CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('delete_post','suspend_user','restore_user','delete_user','resolve_report','dismiss_report')),
  target_user_id INTEGER REFERENCES users(id),
  target_post_id INTEGER REFERENCES posts(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`)
db.run('CREATE INDEX IF NOT EXISTS admin_actions_created ON admin_actions(created_at DESC)')

export type User = { id: number; handle: string; email: string; bio: string; suspended_at?: string | null;
  email_verified_at?: string | null }

// Keep short-lived authentication tables bounded without requiring a scheduler.
const now = Date.now()
db.query('DELETE FROM sessions WHERE expires_at<=?').run(now)
db.query('DELETE FROM password_resets WHERE expires_at<=?').run(now)
db.query('DELETE FROM email_tokens WHERE expires_at<=?').run(now)
db.query('DELETE FROM auth_rate_limits WHERE created_at<=?').run(now - 24 * 60 * 60 * 1000)
db.query("DELETE FROM daily_visitors WHERE day<date('now','-90 days')").run()
