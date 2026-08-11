import type { Database } from 'bun:sqlite'
import { extractMentions } from './content'
import { rebuildHotPosts } from './hot'
import { migrateLegacySessionTokens } from './sessions'

type Migration = { version: number; name: string; up(database: Database): void }

function columns(database: Database, table: string) {
  return (database.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name)
}

function addColumn(database: Database, table: string, name: string, definition: string) {
  if (!columns(database, table).includes(name)) database.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function dropColumn(database: Database, table: string, name: string) {
  if (columns(database, table).includes(name)) database.run(`ALTER TABLE ${table} DROP COLUMN ${name}`)
}

function backfillMentions(database: Database) {
  const users = database.query('SELECT id,handle FROM users').all() as { id: number; handle: string }[]
  const userIds = new Map(users.map(user => [user.handle.toLowerCase(), user.id]))
  const posts = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL').all() as { id: number;
    body: string }[]
  const insert = database.query('INSERT OR IGNORE INTO post_mentions(post_id,user_id) VALUES(?,?)')
  for (const post of posts) {
    for (const handle of extractMentions(post.body)) {
      const userId = userIds.get(handle)
      if (userId) insert.run(post.id, userId)
    }
  }
}

function backfillLegacyActivityReads(database: Database) {
  database.run(`INSERT OR IGNORE INTO activity_reads(user_id,event_key,read_at)
    SELECT recipient_id,event_key,read_at FROM (
      SELECT recipient.id recipient_id,'post:' || p.id event_key,recipient.activity_read_at read_at
        FROM users recipient
        JOIN posts parent ON parent.user_id=recipient.id
        JOIN posts p ON p.parent_id=parent.id
        WHERE recipient.activity_read_at IS NOT NULL AND p.created_at<=recipient.activity_read_at
      UNION
      SELECT recipient.id,'post:' || p.id,recipient.activity_read_at
        FROM users recipient
        JOIN post_mentions pm ON pm.user_id=recipient.id
        JOIN posts p ON p.id=pm.post_id
        WHERE recipient.activity_read_at IS NOT NULL AND p.user_id!=recipient.id
          AND p.created_at<=recipient.activity_read_at
      UNION
      SELECT recipient.id,'follow:' || f.follower_id || ':' || f.created_at,recipient.activity_read_at
        FROM users recipient
        JOIN follows f ON f.following_id=recipient.id
        WHERE recipient.activity_read_at IS NOT NULL AND f.created_at IS NOT NULL
          AND f.created_at<=recipient.activity_read_at
    )`)
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
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_mentions\'',
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
      addColumn(database, 'sessions', 'user_agent', 'TEXT NOT NULL DEFAULT \'\'')
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
      addColumn(database, 'reports', 'status', 'TEXT NOT NULL DEFAULT \'open\'')
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
      addColumn(database, 'illegal_activity_reports', 'category', 'TEXT NOT NULL DEFAULT \'other\'')
      addColumn(database, 'illegal_activity_reports', 'reporter_name', 'TEXT')
      addColumn(database, 'illegal_activity_reports', 'good_faith', 'INTEGER NOT NULL DEFAULT 1')
      database.run(
        'UPDATE illegal_activity_reports SET reference=\'RPT-\' || printf(\'%08d\',id) WHERE reference IS NULL',
      )
      database.run('CREATE UNIQUE INDEX illegal_activity_reports_reference ON illegal_activity_reports(reference)')
    },
  },
  {
    version: 13,
    name: 'post_cursor_indexes',
    up(database) {
      database.run('CREATE INDEX IF NOT EXISTS posts_user_id_desc ON posts(user_id,id DESC)')
    },
  },
  {
    version: 14,
    name: 'bucketed_api_rate_limits',
    up(database) {
      database.run(`CREATE TABLE api_rate_limit_buckets (
        scope TEXT NOT NULL,key_hash TEXT NOT NULL,bucket_start INTEGER NOT NULL,count INTEGER NOT NULL,
        PRIMARY KEY(scope,key_hash,bucket_start));
      CREATE INDEX api_rate_limit_buckets_expiry ON api_rate_limit_buckets(bucket_start);`)
    },
  },
  {
    version: 15,
    name: 'activity_read_status',
    up(database) {
      addColumn(database, 'users', 'activity_read_at', 'TEXT')
    },
  },
  {
    version: 16,
    name: 'per_entry_activity_reads',
    up(database) {
      database.run(`CREATE TABLE activity_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,event_key));`)
      backfillLegacyActivityReads(database)
    },
  },
  {
    version: 17,
    name: 'blocked_hashtags',
    up(database) {
      database.run(`CREATE TABLE blocked_hashtags (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,tag));
      CREATE INDEX blocked_hashtags_tag ON blocked_hashtags(tag,user_id);`)
    },
  },
  {
    version: 18,
    name: 'magic_link_authentication',
    up(database) {
      addColumn(database, 'users', 'handle_chosen_at', 'TEXT')
      database.run('UPDATE users SET handle_chosen_at=COALESCE(handle_chosen_at,created_at,CURRENT_TIMESTAMP)')
      database.run(`CREATE TABLE magic_links (
        token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        next_path TEXT NOT NULL DEFAULT '/',expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX magic_links_expiry ON magic_links(expires_at);`)
    },
  },
  {
    version: 19,
    name: 'backfill_legacy_activity_reads',
    up(database) {
      // Version 16 initially created the per-entry table without carrying over the old per-user cutoff.
      backfillLegacyActivityReads(database)
    },
  },
  {
    version: 20,
    name: 'direct_reply_hot_scores',
    up(database) {
      // Scores materialized before this version include replies at every nesting depth.
      rebuildHotPosts(database)
    },
  },
  {
    version: 21,
    name: 'exclude_self_replies_from_hot_scores',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 22,
    name: 'increase_direct_reply_hot_weight',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 23,
    name: 'include_decaying_nested_replies_in_hot_scores',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 24,
    name: 'api_writes',
    up(database) {
      addColumn(database, 'magic_links', 'code_hash', 'TEXT')
      addColumn(database, 'magic_links', 'attempts', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 25,
    name: 'api_writes_for_all_accounts',
    up(database) {
      dropColumn(database, 'users', 'api_writes_enabled_at')
    },
  },
  {
    version: 26,
    name: 'post_full_text_search',
    up(database) {
      database.run(`CREATE VIRTUAL TABLE IF NOT EXISTS post_search USING fts5(
        body,content='posts',content_rowid='id',tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS post_search_insert AFTER INSERT ON posts BEGIN
        INSERT INTO post_search(rowid,body) VALUES(new.id,new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS post_search_delete AFTER DELETE ON posts BEGIN
        INSERT INTO post_search(post_search,rowid,body) VALUES('delete',old.id,old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS post_search_update AFTER UPDATE OF body ON posts BEGIN
        INSERT INTO post_search(post_search,rowid,body) VALUES('delete',old.id,old.body);
        INSERT INTO post_search(rowid,body) VALUES(new.id,new.body);
      END;
      INSERT INTO post_search(post_search) VALUES('rebuild');`)
    },
  },
  {
    version: 27,
    name: 'exponential_reply_hot_decay',
    up(database) {
      addColumn(database, 'post_hot', 'reply_count', 'INTEGER NOT NULL DEFAULT 0')
      rebuildHotPosts(database)
    },
  },
  {
    version: 28,
    name: 'deduplicate_hot_replies_by_user',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 29,
    name: 'session_activity',
    up(database) {
      addColumn(database, 'sessions', 'last_used_at', 'INTEGER')
      database.run('UPDATE sessions SET last_used_at=created_at WHERE last_used_at IS NULL')
      database.run('CREATE INDEX IF NOT EXISTS sessions_last_used ON sessions(last_used_at,user_id)')
    },
  },
  {
    version: 30,
    name: 'account_deletion_confirmation',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS account_deletion_tokens (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS account_deletion_tokens_user ON account_deletion_tokens(user_id);`)
    },
  },
  {
    version: 31,
    name: 'account_deletion_token_email',
    up(database) {
      addColumn(database, 'account_deletion_tokens', 'email', 'TEXT NOT NULL DEFAULT \'\'')
      database.run(`UPDATE account_deletion_tokens SET email=(
        SELECT email FROM users WHERE users.id=account_deletion_tokens.user_id
      ) WHERE email=''`)
    },
  },
  {
    version: 32,
    name: 'password_enable_confirmation',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS password_enable_tokens (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS password_enable_tokens_user ON password_enable_tokens(user_id);`)
    },
  },
  {
    version: 33,
    name: 'email_change_authorization',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS email_change_authorizations (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_email TEXT NOT NULL,new_email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS email_change_authorizations_user ON email_change_authorizations(user_id);`)
    },
  },
  {
    version: 34,
    name: 'discussion_steam_hot_scores',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 35,
    name: 'push_subscriptions',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,auth TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);`)
    },
  },
  {
    version: 36,
    name: 'push_notification_preferences',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_latest', 'INTEGER NOT NULL DEFAULT 1')
      addColumn(database, 'push_subscriptions', 'notify_replies', 'INTEGER NOT NULL DEFAULT 1')
      addColumn(database, 'push_subscriptions', 'notify_mentions', 'INTEGER NOT NULL DEFAULT 1')
      addColumn(database, 'push_subscriptions', 'notify_follows', 'INTEGER NOT NULL DEFAULT 1')
    },
  },
  {
    version: 37,
    name: 'push_own_post_preference',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_own_posts', 'INTEGER NOT NULL DEFAULT 1')
    },
  },
  {
    version: 38,
    name: 'api_keys',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),created_at INTEGER NOT NULL,
        expires_at INTEGER,last_used_at INTEGER);
      CREATE INDEX IF NOT EXISTS api_keys_user_created ON api_keys(user_id,created_at DESC);`)
    },
  },
  {
    version: 39,
    name: 'people_and_tag_full_text_search',
    up(database) {
      database.run(`CREATE VIRTUAL TABLE IF NOT EXISTS user_search USING fts5(
        handle,bio,content='users',content_rowid='id',tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS user_search_insert AFTER INSERT ON users BEGIN
        INSERT INTO user_search(rowid,handle,bio) VALUES(new.id,new.handle,new.bio);
      END;
      CREATE TRIGGER IF NOT EXISTS user_search_delete AFTER DELETE ON users BEGIN
        INSERT INTO user_search(user_search,rowid,handle,bio) VALUES('delete',old.id,old.handle,old.bio);
      END;
      CREATE TRIGGER IF NOT EXISTS user_search_update AFTER UPDATE OF handle,bio ON users BEGIN
        INSERT INTO user_search(user_search,rowid,handle,bio) VALUES('delete',old.id,old.handle,old.bio);
        INSERT INTO user_search(rowid,handle,bio) VALUES(new.id,new.handle,new.bio);
      END;
      INSERT INTO user_search(user_search) VALUES('rebuild');
      CREATE VIRTUAL TABLE IF NOT EXISTS tag_search USING fts5(
        tag,content='post_hashtags',content_rowid='rowid',tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS tag_search_insert AFTER INSERT ON post_hashtags BEGIN
        INSERT INTO tag_search(rowid,tag) VALUES(new.rowid,new.tag);
      END;
      CREATE TRIGGER IF NOT EXISTS tag_search_delete AFTER DELETE ON post_hashtags BEGIN
        INSERT INTO tag_search(tag_search,rowid,tag) VALUES('delete',old.rowid,old.tag);
      END;
      CREATE TRIGGER IF NOT EXISTS tag_search_update AFTER UPDATE OF tag ON post_hashtags BEGIN
        INSERT INTO tag_search(tag_search,rowid,tag) VALUES('delete',old.rowid,old.tag);
        INSERT INTO tag_search(rowid,tag) VALUES(new.rowid,new.tag);
      END;
      INSERT INTO tag_search(tag_search) VALUES('rebuild');`)
    },
  },
  {
    version: 40,
    name: 'admin_signup_push_preference',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_signups', 'INTEGER NOT NULL DEFAULT 1')
    },
  },
  {
    version: 41,
    name: 'hashtag_follow_activity',
    up(database) {
      addColumn(database, 'hashtag_follows', 'created_at', 'TEXT')
      database.run('CREATE INDEX IF NOT EXISTS hashtag_follows_activity ON hashtag_follows(tag,created_at DESC)')
    },
  },
  {
    version: 42,
    name: 'backfill_follow_activity',
    up(database) {
      database.run('UPDATE follows SET created_at=CURRENT_TIMESTAMP WHERE created_at IS NULL')
    },
  },
  {
    version: 43,
    name: 'remove_hashtag_follow_backfill',
    up(database) {
      // Version 42 briefly backfilled these timestamps. Clearing them removes old tag follows from the timeline;
      // newly followed tags receive a timestamp through the write route after this migration.
      database.run('UPDATE hashtag_follows SET created_at=NULL')
    },
  },
  {
    version: 44,
    name: 'follow_activity_push_preference',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_follow_activity', 'INTEGER NOT NULL DEFAULT 1')
    },
  },
  {
    version: 45,
    name: 'following_notes_push_preference',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_following_notes', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 46,
    name: 'push_subscription_devices',
    up(database) {
      addColumn(database, 'push_subscriptions', 'device_id', 'TEXT')
      database.run('CREATE INDEX IF NOT EXISTS push_subscriptions_device ON push_subscriptions(user_id,device_id)')
    },
  },
  {
    version: 47,
    name: 'for_you_read_status',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS for_you_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,event_key));`)
    },
  },
  {
    version: 48,
    name: 'sync_post_read_status',
    up(database) {
      database.run(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key,read_at)
        SELECT user_id,'post:' || printf('%020d',CAST(substr(event_key,6) AS INTEGER)),read_at
        FROM activity_reads WHERE event_key GLOB 'post:[0-9]*';
        INSERT OR IGNORE INTO activity_reads(user_id,event_key,read_at)
        SELECT user_id,'post:' || CAST(substr(event_key,6) AS INTEGER),read_at
        FROM for_you_reads WHERE event_key GLOB 'post:[0-9]*';`)
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
  if (integrity.length) {
    throw new Error(`Database foreign-key check failed after migration: ${JSON.stringify(integrity)}`)
  }
  return databaseVersion(database)
}
