import type { Database } from 'bun:sqlite'
import { extractMentions } from './content'
import { migrateLegacySessionTokens } from './sessions'
import { rebuildHotPosts } from './hot'

type Migration = { version: number; name: string; up(database: Database): void }

function columns(database: Database, table: string) {
  return (database.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name)
}

function addColumn(database: Database, table: string, name: string, definition: string) {
  if (!columns(database, table).includes(name)) database.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function backfillMentions(database: Database) {
  const users = database.query('SELECT id,handle FROM users').all() as { id: number; handle: string }[]
  const userIds = new Map(users.map(user => [user.handle.toLowerCase(), user.id]))
  const posts = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL').all() as
    { id: number; body: string }[]
  const insert = database.query('INSERT OR IGNORE INTO post_mentions(post_id,user_id) VALUES(?,?)')
  for (const post of posts) {
    for (const handle of extractMentions(post.body)) {
      const userId = userIds.get(handle)
      if (userId) insert.run(post.id, userId)
    }
  }
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'core_schema',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,handle TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,
        bio TEXT DEFAULT '',password TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 280),created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(follower_id,following_id));
      CREATE TABLE IF NOT EXISTS hashtag_follows (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,tag TEXT NOT NULL,PRIMARY KEY(user_id,tag));
      CREATE TABLE IF NOT EXISTS post_hashtags (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,tag TEXT NOT NULL,PRIMARY KEY(post_id,tag));
      CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);`)
    },
  },
  {
    version: 2,
    name: 'conversations_and_safety',
    up(database) {
      const mentionsExisted = !!database.query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_mentions'",
      ).get()
      addColumn(database, 'posts', 'parent_id', 'INTEGER REFERENCES posts(id) ON DELETE CASCADE')
      addColumn(database, 'posts', 'deleted_at', 'TEXT')
      addColumn(database, 'follows', 'created_at', 'TEXT')
      const userColumns = columns(database, 'users')
      if (userColumns.includes('name')) database.run('ALTER TABLE users DROP COLUMN name')
      addColumn(database, 'users', 'deleted_at', 'TEXT')
      addColumn(database, 'users', 'suspended_at', 'TEXT')
      database.run(`CREATE TABLE IF NOT EXISTS post_mentions (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(post_id,user_id));
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id!=blocked_id));
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK(reason IN ('harassment','spam','impersonation','other')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(reporter_id,post_id));
      CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id,created_at);
      CREATE INDEX IF NOT EXISTS posts_user_created ON posts(user_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS post_mentions_user ON post_mentions(user_id,post_id);
      CREATE INDEX IF NOT EXISTS post_hashtags_tag ON post_hashtags(tag,post_id);
      CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id,blocker_id);
      CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at DESC);
      CREATE INDEX IF NOT EXISTS follows_activity ON follows(following_id,created_at DESC);`)
      if (!mentionsExisted) backfillMentions(database)
    },
  },
  {
    version: 3,
    name: 'account_security',
    up(database) {
      addColumn(database, 'users', 'email_verified_at', 'TEXT')
      addColumn(database, 'sessions', 'created_at', 'INTEGER')
      database.run('UPDATE sessions SET created_at=expires_at-2592000000 WHERE created_at IS NULL')
      addColumn(database, 'sessions', 'user_agent', "TEXT NOT NULL DEFAULT ''")
      database.run(`CREATE TABLE IF NOT EXISTS email_tokens (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('verify','change')),email TEXT NOT NULL,expires_at INTEGER NOT NULL);`)
    },
  },
  {
    version: 4,
    name: 'operations_and_moderation',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,key_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_visitors (
        day TEXT NOT NULL,visitor_hash TEXT NOT NULL,PRIMARY KEY(day,visitor_hash));`)
      addColumn(database, 'reports', 'status', "TEXT NOT NULL DEFAULT 'open'")
      addColumn(database, 'reports', 'resolved_at', 'TEXT')
      addColumn(database, 'reports', 'resolved_by', 'INTEGER REFERENCES users(id)')
      database.run(`CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER NOT NULL REFERENCES users(id),
        action TEXT NOT NULL CHECK(action IN ('delete_post','suspend_user','restore_user','delete_user','resolve_report','dismiss_report')),
        target_user_id INTEGER REFERENCES users(id),target_post_id INTEGER REFERENCES posts(id),
        note TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS auth_rate_limits_lookup ON auth_rate_limits(scope,key_hash,created_at);
      CREATE INDEX IF NOT EXISTS daily_visitors_hash_day ON daily_visitors(visitor_hash,day);
      CREATE INDEX IF NOT EXISTS reports_status_created ON reports(status,created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_actions_created ON admin_actions(created_at DESC);`)
    },
  },
  {
    version: 5,
    name: 'handle_history',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS handle_history (
        handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS handle_history_user ON handle_history(user_id);`)
    },
  },
  {
    version: 6,
    name: 'hashed_session_tokens',
    up(database) {
      migrateLegacySessionTokens(database)
    },
  },
  {
    version: 7,
    name: 'materialized_hot_scores',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS post_hot (
        post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        score REAL NOT NULL DEFAULT 0,score_updated_at TEXT NOT NULL,
        latest_activity_at TEXT NOT NULL);
      INSERT OR IGNORE INTO post_hot(post_id,score,score_updated_at,latest_activity_at)
        SELECT id,0,created_at,created_at FROM posts;
      CREATE INDEX IF NOT EXISTS post_hot_ranking
        ON post_hot(score DESC,latest_activity_at DESC,post_id DESC);
      CREATE TRIGGER IF NOT EXISTS post_hot_insert AFTER INSERT ON posts BEGIN
        INSERT INTO post_hot(post_id,score,score_updated_at,latest_activity_at)
        VALUES(new.id,0,new.created_at,new.created_at);
      END;`)
      rebuildHotPosts(database)
    },
  },
  {
    version: 8,
    name: 'rotating_ip_pseudonyms',
    up(database) {
      // Legacy values were unkeyed and cannot be transformed without retaining the source address.
      database.run('DELETE FROM daily_visitors')
    },
  },
  {
    version: 9,
    name: 'reserved_removed_illegal_content_notices',
    up() {},
  },
  {
    version: 10,
    name: 'remove_illegal_content_notices',
    up(database) {
      database.run('DROP TABLE IF EXISTS illegal_content_notices')
    },
  },
  {
    version: 11,
    name: 'illegal_activity_reports',
    up(database) {
      database.run(`CREATE TABLE illegal_activity_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL REFERENCES posts(id),content_url TEXT NOT NULL,
        details TEXT NOT NULL,reporter_email TEXT,status TEXT NOT NULL DEFAULT 'open',resolution_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT);
      CREATE INDEX illegal_activity_reports_status_created ON illegal_activity_reports(status,created_at DESC);`)
    },
  },
  {
    version: 12,
    name: 'report_receipts_and_notifier_details',
    up(database) {
      addColumn(database, 'illegal_activity_reports', 'reference', 'TEXT')
      addColumn(database, 'illegal_activity_reports', 'category', "TEXT NOT NULL DEFAULT 'other'")
      addColumn(database, 'illegal_activity_reports', 'reporter_name', 'TEXT')
      addColumn(database, 'illegal_activity_reports', 'good_faith', 'INTEGER NOT NULL DEFAULT 1')
      database.run("UPDATE illegal_activity_reports SET reference='RPT-' || printf('%08d',id) WHERE reference IS NULL")
      database.run('CREATE UNIQUE INDEX illegal_activity_reports_reference ON illegal_activity_reports(reference)')
    },
  },
]

export const latestMigrationVersion = migrations.at(-1)!.version

export function databaseVersion(database: Database) {
  return (database.query('PRAGMA user_version').get() as { user_version: number }).user_version
}

export function runMigrations(database: Database, onMigration?: (migration: Migration) => void) {
  const current = databaseVersion(database)
  if (current > latestMigrationVersion) {
    throw new Error(`Database version ${current} is newer than supported version ${latestMigrationVersion}`)
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue
    database.transaction(() => {
      migration.up(database)
      database.run(`PRAGMA user_version=${migration.version}`)
    })()
    onMigration?.(migration)
  }
  const integrity = database.query('PRAGMA foreign_key_check').all()
  if (integrity.length) throw new Error(`Database foreign-key check failed after migration: ${JSON.stringify(integrity)}`)
  return databaseVersion(database)
}
