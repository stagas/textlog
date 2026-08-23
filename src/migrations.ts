import type { Database } from 'bun:sqlite'
import { extractHashtags, extractMentions, postContentFlags } from './content'
import { rebuildHotPosts } from './hot'
import { migrateLegacySessionTokens } from './sessions'
import { parsePoll } from './polls'

type Migration = { version: number; name: string; transaction?: boolean; up(database: Database): void }

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

function rebuildPostHashtags(database: Database) {
  const posts = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL').all() as {
    id: number
    body: string
  }[]
  const insert = database.query('INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES(?,?)')
  database.run('DELETE FROM post_hashtags')
  for (const post of posts) {
    for (const tag of extractHashtags(post.body)) insert.run(post.id, tag)
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
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),created_at TEXT DEFAULT CURRENT_TIMESTAMP);
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
        reason TEXT NOT NULL CHECK(reason IN ('harassment','spam','impersonation','bot','other')),
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
  {
    version: 49,
    name: 'unicode_hashtag_backfill',
    up(database) {
      rebuildPostHashtags(database)
    },
  },
  {
    version: 50,
    name: 'password_login_nonces',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS password_login_nonces (
        token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS password_login_nonces_expiry ON password_login_nonces(expires_at);`)
    },
  },
  {
    version: 51,
    name: 'global_password_captcha',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS password_login_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS password_login_failures_created ON password_login_failures(created_at);
      CREATE TABLE IF NOT EXISTS password_captcha_state (
        id INTEGER PRIMARY KEY CHECK(id=1),required_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS password_captcha_challenges (
        token TEXT PRIMARY KEY,answer_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS password_captcha_challenges_expiry ON password_captcha_challenges(expires_at);`)
    },
  },
  {
    version: 52,
    name: 'post_content_flags',
    up(database) {
      addColumn(database, 'posts', 'has_latex', 'INTEGER CHECK(has_latex IN (0,1))')
      addColumn(database, 'posts', 'has_links', 'INTEGER CHECK(has_links IN (0,1))')
      addColumn(database, 'posts', 'has_code', 'INTEGER CHECK(has_code IN (0,1))')
      const posts = database.query('SELECT id,body FROM posts').all() as { id: number; body: string }[]
      const update = database.query('UPDATE posts SET has_latex=?,has_links=?,has_code=? WHERE id=?')
      for (const post of posts) {
        const flags = postContentFlags(post.body)
        update.run(flags.has_latex, flags.has_links, flags.has_code, post.id)
      }
    },
  },
  {
    version: 53,
    name: 'persistent_feed_pagination',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS feed_snapshot_generation (
        id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
      INSERT OR IGNORE INTO feed_snapshot_generation(id,generation) VALUES(1,1);
      CREATE TABLE IF NOT EXISTS feed_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,
        generation INTEGER NOT NULL,total_items INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(kind,viewer_id,generation));
      CREATE TABLE IF NOT EXISTS feed_snapshot_items (
        snapshot_id INTEGER NOT NULL REFERENCES feed_snapshots(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,position));
      CREATE INDEX IF NOT EXISTS feed_snapshots_lookup ON feed_snapshots(kind,viewer_id,generation);
      CREATE TRIGGER IF NOT EXISTS feed_generation_posts_insert AFTER INSERT ON posts BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_posts_update AFTER UPDATE ON posts BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_posts_delete AFTER DELETE ON posts BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_follows_insert AFTER INSERT ON follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_follows_update AFTER UPDATE ON follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_follows_delete AFTER DELETE ON follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hashtag_follows_insert AFTER INSERT ON hashtag_follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hashtag_follows_update AFTER UPDATE ON hashtag_follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hashtag_follows_delete AFTER DELETE ON hashtag_follows BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_blocks_insert AFTER INSERT ON blocks BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_blocks_delete AFTER DELETE ON blocks BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_blocked_tags_insert AFTER INSERT ON blocked_hashtags BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_blocked_tags_delete AFTER DELETE ON blocked_hashtags BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hot_insert AFTER INSERT ON post_hot BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hot_update AFTER UPDATE ON post_hot BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_hot_delete AFTER DELETE ON post_hot BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_users_insert AFTER INSERT ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_users_update AFTER UPDATE ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_users_delete AFTER DELETE ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_post_tags_insert AFTER INSERT ON post_hashtags BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_post_tags_delete AFTER DELETE ON post_hashtags BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_mentions_insert AFTER INSERT ON post_mentions BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS feed_generation_mentions_delete AFTER DELETE ON post_mentions BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;`)
    },
  },
  {
    version: 54,
    name: 'notification_user_agents',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS notification_user_agents (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT NOT NULL CHECK(length(user_agent) BETWEEN 1 AND 512),
        status TEXT NOT NULL CHECK(status IN ('enabled','dismissed')),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,user_agent));`)
    },
  },
  {
    version: 55,
    name: 'device_settings',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS device_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 20 AND 128),
        page_size INTEGER NOT NULL DEFAULT 40 CHECK(page_size IN (20,40,80,100)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,device_id));`)
    },
  },
  {
    version: 56,
    name: 'device_density',
    up(database) {
      addColumn(database, 'device_settings', 'density',
        'TEXT NOT NULL DEFAULT \'regular\' CHECK(density IN (\'compact\',\'regular\',\'relaxed\'))')
    },
  },
  {
    version: 57,
    name: 'multiple_accounts_per_email',
    // SQLite implements UNIQUE columns as table-owned indexes. Rebuilding the parent
    // table with foreign keys temporarily disabled is the supported way to remove it.
    transaction: false,
    up(database) {
      const groupsExist = !!database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'account_groups\'',
      ).get()
      if (groupsExist && columns(database, 'users').includes('account_group_id')) {
        const users = database.query(`SELECT id,email FROM users
          WHERE deleted_at IS NULL AND account_group_id IS NULL ORDER BY id`).all() as { id: number; email: string }[]
        const existingGroup = database.query('SELECT id FROM account_groups WHERE email=?')
        const insertGroup = database.query(`INSERT INTO account_groups(email,primary_user_id,selected_user_id)
          VALUES(?,?,?) RETURNING id`)
        const attach = database.query('UPDATE users SET account_group_id=? WHERE id=?')
        for (const user of users) {
          const group = (existingGroup.get(user.email)
            || insertGroup.get(user.email, user.id, user.id)) as { id: number }
          attach.run(group.id, user.id)
        }
        return
      }
      database.run(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,handle TEXT UNIQUE NOT NULL,email TEXT NOT NULL,
        bio TEXT DEFAULT '',password TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,suspended_at TEXT,email_verified_at TEXT,activity_read_at TEXT,handle_chosen_at TEXT,
        account_group_id INTEGER REFERENCES account_groups(id));
      INSERT INTO users_new(id,handle,email,bio,password,created_at,deleted_at,suspended_at,email_verified_at,
        activity_read_at,handle_chosen_at)
        SELECT id,handle,email,bio,password,created_at,deleted_at,suspended_at,email_verified_at,
          activity_read_at,handle_chosen_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE TRIGGER user_search_insert AFTER INSERT ON users BEGIN
        INSERT INTO user_search(rowid,handle,bio) VALUES(new.id,new.handle,new.bio); END;
      CREATE TRIGGER user_search_delete AFTER DELETE ON users BEGIN
        INSERT INTO user_search(user_search,rowid,handle,bio) VALUES('delete',old.id,old.handle,old.bio); END;
      CREATE TRIGGER user_search_update AFTER UPDATE OF handle,bio ON users BEGIN
        INSERT INTO user_search(user_search,rowid,handle,bio) VALUES('delete',old.id,old.handle,old.bio);
        INSERT INTO user_search(rowid,handle,bio) VALUES(new.id,new.handle,new.bio); END;
      CREATE TRIGGER feed_generation_users_insert AFTER INSERT ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER feed_generation_users_update AFTER UPDATE ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TRIGGER feed_generation_users_delete AFTER DELETE ON users BEGIN
        UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1; END;
      CREATE TABLE account_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,
        primary_user_id INTEGER NOT NULL REFERENCES users(id),
        selected_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX users_account_group ON users(account_group_id,id);`)
      const users = database.query(`SELECT id,email FROM users WHERE deleted_at IS NULL ORDER BY id`).all() as {
        id: number
        email: string
      }[]
      const insert = database.query(`INSERT INTO account_groups(email,primary_user_id,selected_user_id)
        VALUES(?,?,?) RETURNING id`)
      const attach = database.query('UPDATE users SET account_group_id=? WHERE id=?')
      for (const user of users) {
        const group = insert.get(user.email, user.id, user.id) as { id: number }
        attach.run(group.id, user.id)
      }
    },
  },
  {
    version: 58,
    name: 'multi_account_push_subscriptions',
    up(database) {
      database.run(`ALTER TABLE push_subscriptions RENAME TO push_subscriptions_legacy;
      CREATE TABLE push_subscriptions (
        endpoint TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,auth TEXT NOT NULL,
        notify_latest INTEGER NOT NULL DEFAULT 1,notify_replies INTEGER NOT NULL DEFAULT 1,
        notify_mentions INTEGER NOT NULL DEFAULT 1,notify_follows INTEGER NOT NULL DEFAULT 1,
        notify_own_posts INTEGER NOT NULL DEFAULT 1,notify_signups INTEGER NOT NULL DEFAULT 1,
        notify_follow_activity INTEGER NOT NULL DEFAULT 1,notify_following_notes INTEGER NOT NULL DEFAULT 0,
        device_id TEXT,PRIMARY KEY(endpoint,user_id));
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,notify_latest,notify_replies,notify_mentions,
        notify_follows,notify_own_posts,notify_signups,notify_follow_activity,notify_following_notes,device_id)
        SELECT endpoint,user_id,p256dh,auth,notify_latest,notify_replies,notify_mentions,notify_follows,
          notify_own_posts,notify_signups,notify_follow_activity,notify_following_notes,device_id
        FROM push_subscriptions_legacy;
      DROP TABLE push_subscriptions_legacy;
      CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
      CREATE INDEX push_subscriptions_device ON push_subscriptions(user_id,device_id);`)
    },
  },
  {
    version: 59,
    name: 'account_creation_events',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS account_creation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_group_id INTEGER NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS account_creation_events_group_created
        ON account_creation_events(account_group_id,created_at);
      INSERT INTO account_creation_events(account_group_id,user_id,created_at)
        SELECT u.account_group_id,u.id,COALESCE(u.created_at,CURRENT_TIMESTAMP)
        FROM users u JOIN account_groups g ON g.id=u.account_group_id
        WHERE u.id!=g.primary_user_id AND NOT EXISTS (
          SELECT 1 FROM account_creation_events e WHERE e.user_id=u.id);`)
    },
  },
  {
    version: 60,
    name: 'group_owned_handle_history',
    up(database) {
      addColumn(database, 'handle_history', 'account_group_id',
        'INTEGER REFERENCES account_groups(id) ON DELETE CASCADE')
      database.run(`CREATE INDEX IF NOT EXISTS handle_history_account_group
        ON handle_history(account_group_id);
      UPDATE handle_history SET account_group_id=COALESCE(
        (SELECT account_group_id FROM users WHERE users.id=handle_history.user_id),
        (SELECT account_group_id FROM account_creation_events
          WHERE account_creation_events.user_id=handle_history.user_id ORDER BY id DESC LIMIT 1))
        WHERE account_group_id IS NULL;`)
    },
  },
  {
    version: 61,
    name: 'bot_accounts',
    up(database) {
      addColumn(database, 'users', 'is_bot', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_bot IN (0,1))')
    },
  },
  {
    version: 62,
    name: 'moderator_managed_bots',
    up(database) {
      addColumn(database, 'users', 'bot_managed', 'INTEGER NOT NULL DEFAULT 0 CHECK(bot_managed IN (0,1))')
      database.run(`CREATE TABLE admin_actions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER NOT NULL REFERENCES users(id),
        action TEXT NOT NULL CHECK(action IN ('delete_post','suspend_user','restore_user','delete_user',
          'resolve_report','dismiss_report','mark_bot','unmark_bot')),
        target_user_id INTEGER REFERENCES users(id),target_post_id INTEGER REFERENCES posts(id),
        note TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO admin_actions_new SELECT * FROM admin_actions;
      DROP TABLE admin_actions;
      ALTER TABLE admin_actions_new RENAME TO admin_actions;
      CREATE INDEX admin_actions_created ON admin_actions(created_at DESC);`)
    },
  },
  {
    version: 63,
    name: 'url_fragment_hashtag_backfill',
    up(database) {
      rebuildPostHashtags(database)
    },
  },
  {
    version: 64,
    name: 'reply_only_hot_scores',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 65,
    name: 'bounded_feed_snapshots',
    up(database) {
      if (!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'feed_snapshots\'').get()) return
      addColumn(database, 'feed_snapshots', 'last_accessed_at', 'TEXT')
      database.run(`UPDATE feed_snapshots SET last_accessed_at=created_at WHERE last_accessed_at IS NULL;
        DELETE FROM feed_snapshots WHERE last_accessed_at < datetime('now','-1 day');
        DELETE FROM feed_snapshots WHERE id IN (
          SELECT id FROM feed_snapshots ORDER BY last_accessed_at DESC,id DESC LIMIT -1 OFFSET 200
        );
        CREATE INDEX IF NOT EXISTS feed_snapshots_last_accessed ON feed_snapshots(last_accessed_at);`)
    },
  },
  {
    version: 66,
    name: 'email_unique_hot_replies',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 67,
    name: 'conversation_activity_hot_recency',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 68,
    name: 'hot_conversation_depth',
    up(database) {
      addColumn(database, 'post_hot', 'activity_count', 'INTEGER NOT NULL DEFAULT 0')
      rebuildHotPosts(database)
    },
  },
  {
    version: 69,
    name: 'appearance_user_agents',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS appearance_user_agents (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT NOT NULL CHECK(length(user_agent) BETWEEN 1 AND 512),
        status TEXT NOT NULL CHECK(status IN ('seen','dismissed')),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,user_agent));`)
    },
  },
  {
    version: 70,
    name: 'external_feed_snapshot_cache',
    up(database) {
      database.query('DELETE FROM feed_snapshots WHERE kind=\'latest\' OR kind=\'hot\' OR kind LIKE \'hot:%\'').run()
    },
  },
  {
    version: 71,
    name: 'restore_personalized_feed_snapshots',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS feed_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,viewer_id INTEGER NOT NULL,
        generation INTEGER NOT NULL,total_items INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(kind,viewer_id,generation));
        CREATE TABLE IF NOT EXISTS feed_snapshot_items (
          snapshot_id INTEGER NOT NULL REFERENCES feed_snapshots(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,position));
        CREATE INDEX IF NOT EXISTS feed_snapshots_lookup ON feed_snapshots(kind,viewer_id,generation);
        CREATE INDEX IF NOT EXISTS feed_snapshots_last_accessed ON feed_snapshots(last_accessed_at);`)
    },
  },
  {
    version: 72,
    name: 'notification_for_you_bots',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_following_bots', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 73,
    name: 'disable_self_notifications',
    up(database) {
      database.run('UPDATE push_subscriptions SET notify_own_posts=0')
    },
  },
  {
    version: 74,
    name: 'notification_for_you_only_to_me',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_following_only_to_me', 'INTEGER NOT NULL DEFAULT 0')
    },
  },
  {
    version: 75,
    name: 'notification_bots_all_sources',
    up(database) {
      addColumn(database, 'push_subscriptions', 'notify_bots', 'INTEGER NOT NULL DEFAULT 0')
      database.run('UPDATE push_subscriptions SET notify_bots=notify_following_bots')
    },
  },
  {
    version: 76,
    name: 'notification_improvement_banner',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS notification_improvement_user_agents (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT NOT NULL CHECK(length(user_agent) BETWEEN 1 AND 512),
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,user_agent));`)
    },
  },
  {
    version: 77,
    name: 'post_link_previews',
    up(database) {
      addColumn(database, 'posts', 'preview_url', 'TEXT')
      addColumn(database, 'posts', 'preview_image_url', 'TEXT')
    },
  },
  {
    version: 78,
    name: 'post_link_preview_rows',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS post_link_previews (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        url TEXT NOT NULL,image_url TEXT NOT NULL,PRIMARY KEY(post_id,url));`)
      dropColumn(database, 'posts', 'preview_url')
      dropColumn(database, 'posts', 'preview_image_url')
    },
  },
  {
    version: 79,
    name: 'post_link_preview_metadata',
    up(database) {
      addColumn(database, 'post_link_previews', 'title', 'TEXT')
      addColumn(database, 'post_link_previews', 'description', 'TEXT')
      addColumn(database, 'post_link_previews', 'site_name', 'TEXT')
    },
  },
  {
    version: 80,
    name: 'post_link_preview_image_dimensions',
    up(database) {
      addColumn(database, 'post_link_previews', 'image_width', 'INTEGER')
      addColumn(database, 'post_link_previews', 'image_height', 'INTEGER')
    },
  },
  {
    version: 81,
    name: 'post_link_preview_backfill',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS post_link_preview_backfill_attempts (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        url TEXT NOT NULL,status TEXT NOT NULL,attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(post_id,url));`)
    },
  },
  {
    version: 82,
    name: 'user_timezone',
    up(database) {
      addColumn(database, 'users', 'timezone', 'TEXT NOT NULL DEFAULT \'UTC\'')
    },
  },
  {
    version: 83,
    name: 'daylight_saving_timezones',
    up(database) {
      const zones = [
        'Etc/GMT+12',
        'Pacific/Pago_Pago',
        'Pacific/Honolulu',
        'America/Anchorage',
        'America/Los_Angeles',
        'America/Denver',
        'America/Chicago',
        'America/New_York',
        'America/Halifax',
        'America/Argentina/Buenos_Aires',
        'America/Noronha',
        'Atlantic/Cape_Verde',
        'UTC',
        'Europe/Paris',
        'Europe/Athens',
        'Europe/Istanbul',
        'Asia/Dubai',
        'Asia/Karachi',
        'Asia/Dhaka',
        'Asia/Bangkok',
        'Asia/Singapore',
        'Asia/Tokyo',
        'Australia/Sydney',
        'Pacific/Noumea',
        'Pacific/Auckland',
      ]
      const legacy = Array.from({ length: 25 }, (_, index) => {
        const offset = index - 12
        return offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
      })
      const update = database.query('UPDATE users SET timezone=? WHERE timezone=?')
      for (let index = 0; index < legacy.length; index++) update.run(zones[index], legacy[index])
    },
  },
  {
    version: 84,
    name: 'donation_banner_dismissals',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS donation_banner_dismissals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
    },
  },
  {
    version: 85,
    name: 'user_bio_link_previews',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS user_bio_link_previews (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,image_url TEXT NOT NULL,title TEXT,description TEXT,site_name TEXT,
        image_width INTEGER,image_height INTEGER,PRIMARY KEY(user_id,url));
        CREATE TABLE IF NOT EXISTS user_bio_link_preview_backfill_attempts (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url TEXT NOT NULL,status TEXT NOT NULL,attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,url));`)
    },
  },
  {
    version: 86,
    name: 'background_tasks',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS background_tasks (
        name TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
    },
  },
  {
    version: 87,
    name: 'anonymous_visitor_activity',
    up(database) {
      addColumn(database, 'daily_visitors', 'anonymous_last_seen_at', 'INTEGER')
      database.run(
        'CREATE INDEX IF NOT EXISTS daily_visitors_anonymous_last_seen ON daily_visitors(anonymous_last_seen_at)',
      )
    },
  },
  {
    version: 88,
    name: 'invite_banner_dismissals',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS invite_banner_dismissals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
    },
  },
  {
    version: 89,
    name: 'post_og_preview_refetch_backfill',
    up() {
      // The asynchronous, one-time refetch is performed by scripts/backfill-link-previews.ts.
    },
  },
  {
    version: 90,
    name: 'user_link_preview_preference',
    up(database) {
      addColumn(database, 'users', 'show_link_previews',
        'INTEGER NOT NULL DEFAULT 1 CHECK(show_link_previews IN (0,1))')
    },
  },
  {
    version: 91,
    name: 'personalized_feed_keys',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS feed_keys (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);`)
    },
  },
  {
    version: 92,
    name: 'multiple_personalized_feed_keys',
    up(database) {
      database.run(`CREATE TABLE feed_keys_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),created_at INTEGER NOT NULL,
        expires_at INTEGER,last_used_at INTEGER);
      INSERT INTO feed_keys_new(token_hash,user_id,name,created_at)
        SELECT token_hash,user_id,'original feed key',created_at FROM feed_keys;
      DROP TABLE feed_keys;
      ALTER TABLE feed_keys_new RENAME TO feed_keys;
      CREATE INDEX feed_keys_user_created ON feed_keys(user_id,created_at DESC);`)
    },
  },
  {
    version: 93,
    name: 'recap_email_subscription',
    up(database) {
      addColumn(database, 'users', 'recap_emails', 'INTEGER NOT NULL DEFAULT 1 CHECK(recap_emails IN (0,1))')
    },
  },
  {
    version: 94,
    name: 'recap_unsubscribe_tokens',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS recap_unsubscribe_tokens (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
    },
  },
  {
    version: 95,
    name: 'durable_recap_unsubscribe_tokens',
    up(database) {
      database.run(`CREATE TABLE recap_unsubscribe_tokens_new (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO recap_unsubscribe_tokens_new(token_hash,user_id,created_at)
        SELECT token_hash,user_id,created_at FROM recap_unsubscribe_tokens;
      DROP TABLE recap_unsubscribe_tokens;
      ALTER TABLE recap_unsubscribe_tokens_new RENAME TO recap_unsubscribe_tokens;
      CREATE INDEX recap_unsubscribe_tokens_user ON recap_unsubscribe_tokens(user_id);`)
    },
  },
  {
    version: 96,
    name: 'recap_email_deliveries',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS recap_email_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_version TEXT NOT NULL,email TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('sending','sent','failed','uncertain')),
        run_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,attempts INTEGER NOT NULL DEFAULT 0,
        provider_id TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,
        UNIQUE(campaign_version,email));
      CREATE INDEX IF NOT EXISTS recap_email_deliveries_status
        ON recap_email_deliveries(campaign_version,status,id);`)
    },
  },
  {
    version: 97,
    name: 'to_me_reads',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS to_me_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,event_key));`)
      if (database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'for_you_reads\'').get()) {
        database.run(`INSERT OR IGNORE INTO to_me_reads(user_id,event_key,read_at)
          SELECT user_id,event_key,read_at FROM for_you_reads;`)
      }
      database.run('CREATE INDEX IF NOT EXISTS to_me_reads_user_read_at ON to_me_reads(user_id,read_at)')
    },
  },
  {
    version: 98,
    name: 'exclude_author_comments_from_hot_recency',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 99,
    name: 'daily_ip_request_blocks',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS daily_ip_requests (
        day TEXT NOT NULL,ip_hash TEXT NOT NULL,request_count INTEGER NOT NULL DEFAULT 0,
        blocked_at TEXT,blocked_by INTEGER REFERENCES users(id),PRIMARY KEY(day,ip_hash));
        CREATE INDEX IF NOT EXISTS daily_ip_requests_day_count
          ON daily_ip_requests(day,request_count DESC);`)
    },
  },
  {
    version: 100,
    name: 'remove_bot_accounts',
    up(database) {
      dropColumn(database, 'users', 'is_bot')
      dropColumn(database, 'users', 'bot_managed')
      dropColumn(database, 'push_subscriptions', 'notify_following_bots')
      dropColumn(database, 'push_subscriptions', 'notify_bots')
      if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_actions'").get()) {
        database.run(`CREATE TABLE admin_actions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('delete_post','suspend_user','restore_user','delete_user',
              'resolve_report','dismiss_report')),
            target_user_id INTEGER REFERENCES users(id),target_post_id INTEGER REFERENCES posts(id),
            note TEXT NOT NULL DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
          INSERT INTO admin_actions_new SELECT * FROM admin_actions
            WHERE action NOT IN ('mark_bot','unmark_bot');
          DROP TABLE admin_actions;
          ALTER TABLE admin_actions_new RENAME TO admin_actions;
          CREATE INDEX admin_actions_created ON admin_actions(created_at DESC);`)
      }
    },
  },
  {
    version: 101,
    name: 'post_polls',
    up(database) {
      if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='posts'").get()) return
      database.run(`CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,label TEXT NOT NULL,UNIQUE(post_id,position));
      CREATE TABLE IF NOT EXISTS poll_votes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,user_id));
      CREATE INDEX IF NOT EXISTS poll_votes_option ON poll_votes(option_id);`)
      const insert = database.query('INSERT OR IGNORE INTO poll_options(post_id,position,label) VALUES(?,?,?)')
      const posts = database.query('SELECT id,body FROM posts WHERE deleted_at IS NULL').all() as
        Array<{ id: number; body: string }>
      for (const post of posts) {
        parsePoll(post.body)?.options.forEach((label, position) => insert.run(post.id, position, label))
      }
    },
  },
  {
    version: 102,
    name: 'markdown_code_hashtag_backfill',
    up(database) {
      if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='posts'").get()) return
      rebuildPostHashtags(database)
    },
  },
  {
    version: 103,
    name: 'poll_vote_hot_scores',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 104,
    name: 'increase_poll_vote_hot_weight',
    up(database) {
      rebuildHotPosts(database)
    },
  },
  {
    version: 105,
    name: 'bot_report_reason',
    up(database) {
      if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reports'").get()) return
      database.run(`CREATE TABLE reports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK(reason IN ('harassment','spam','impersonation','bot','other')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL DEFAULT 'open',resolved_at TEXT,
        resolved_by INTEGER REFERENCES users(id),UNIQUE(reporter_id,post_id));
      INSERT INTO reports_new(id,reporter_id,post_id,reason,created_at,status,resolved_at,resolved_by)
        SELECT id,reporter_id,post_id,reason,created_at,status,resolved_at,resolved_by FROM reports;
      DROP TABLE reports;
      ALTER TABLE reports_new RENAME TO reports;
      CREATE INDEX reports_created ON reports(created_at DESC);
      CREATE INDEX reports_status_created ON reports(status,created_at DESC);`)
    },
  },
  {
    version: 106,
    name: 'post_drafts',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS drafts_user_updated ON drafts(user_id,updated_at DESC,id DESC);`)
    },
  },
  {
    version: 107,
    name: 'latest_reads',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS latest_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,post_id));
      CREATE INDEX IF NOT EXISTS latest_reads_user_read_at ON latest_reads(user_id,read_at);`)
    },
  },
  {
    version: 108,
    name: 'backfill_latest_reads_from_last_visit',
    up(database) {
      const hasTable = (name: string) => !!database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?',
      ).get(name)
      if (!hasTable('sessions') || !hasTable('posts') || !hasTable('latest_reads')) return
      database.run(`INSERT OR IGNORE INTO latest_reads(user_id,post_id,read_at)
        SELECT visits.user_id,p.id,datetime(visits.last_used_at / 1000,'unixepoch')
        FROM (SELECT user_id,max(last_used_at) last_used_at FROM sessions
          WHERE last_used_at IS NOT NULL GROUP BY user_id) visits
        JOIN posts p ON p.created_at<=datetime(visits.last_used_at / 1000,'unixepoch');`)
    },
  },
  {
    version: 109,
    name: 'initialize_latest_reads_for_new_users',
    up(database) {
      const hasTable = (name: string) => !!database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?',
      ).get(name)
      if (!hasTable('users') || !hasTable('posts') || !hasTable('latest_reads')) return
      database.run(`CREATE TRIGGER IF NOT EXISTS latest_reads_initialize_user AFTER INSERT ON users BEGIN
        INSERT OR IGNORE INTO latest_reads(user_id,post_id)
          SELECT new.id,id FROM posts;
      END;`)
    },
  },
  {
    version: 110,
    name: 'backfill_latest_reads_before_account_creation',
    up(database) {
      const hasTable = (name: string) => !!database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?',
      ).get(name)
      if (!hasTable('users') || !hasTable('posts') || !hasTable('latest_reads')) return
      const userColumns = (database.query('PRAGMA table_info(users)').all() as Array<{ name: string }>)
        .map(column => column.name)
      const postColumns = (database.query('PRAGMA table_info(posts)').all() as Array<{ name: string }>)
        .map(column => column.name)
      if (!userColumns.includes('created_at') || !postColumns.includes('created_at')) return
      database.run(`INSERT OR IGNORE INTO latest_reads(user_id,post_id)
        SELECT u.id,p.id FROM users u JOIN posts p ON p.created_at<=u.created_at;`)
    },
  },
  {
    version: 112,
    name: 'target_personalized_feed_snapshots',
    up(database) {
      if (!database.query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='feed_snapshots'`).get()) return
      database.run(`CREATE TABLE IF NOT EXISTS personalized_feed_generations (
        viewer_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,generation INTEGER NOT NULL DEFAULT 1);
        INSERT OR IGNORE INTO personalized_feed_generations(viewer_id) SELECT id FROM users;`)
      const clear = (viewer: string) => `INSERT INTO personalized_feed_generations(viewer_id,generation)
        WITH affected(id) AS (${viewer}) SELECT affected.id,2 FROM affected JOIN users ON users.id=affected.id
        ON CONFLICT(viewer_id) DO UPDATE SET generation=generation+1;`
      database.run(`
        DELETE FROM feed_snapshots WHERE kind LIKE 'for-you:%' OR kind LIKE 'to-me:%';
        DROP TRIGGER IF EXISTS personalized_feed_posts_insert;
        DROP TRIGGER IF EXISTS personalized_feed_posts_update;
        DROP TRIGGER IF EXISTS personalized_feed_posts_delete;
        DROP TRIGGER IF EXISTS personalized_feed_post_tags_insert;
        DROP TRIGGER IF EXISTS personalized_feed_post_tags_delete;
        DROP TRIGGER IF EXISTS personalized_feed_mentions_insert;
        DROP TRIGGER IF EXISTS personalized_feed_mentions_delete;
        DROP TRIGGER IF EXISTS personalized_feed_follows_insert;
        DROP TRIGGER IF EXISTS personalized_feed_follows_update;
        DROP TRIGGER IF EXISTS personalized_feed_follows_delete;
        DROP TRIGGER IF EXISTS personalized_feed_hashtag_follows_insert;
        DROP TRIGGER IF EXISTS personalized_feed_hashtag_follows_update;
        DROP TRIGGER IF EXISTS personalized_feed_hashtag_follows_delete;
        DROP TRIGGER IF EXISTS personalized_feed_blocks_insert;
        DROP TRIGGER IF EXISTS personalized_feed_blocks_delete;
        DROP TRIGGER IF EXISTS personalized_feed_blocked_tags_insert;
        DROP TRIGGER IF EXISTS personalized_feed_blocked_tags_delete;
        DROP TRIGGER IF EXISTS personalized_feed_users_insert;
        DROP TRIGGER IF EXISTS personalized_feed_users_update;
        DROP TRIGGER IF EXISTS personalized_feed_users_delete;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_posts_insert AFTER INSERT ON posts BEGIN
          ${clear(`SELECT follower_id FROM follows WHERE following_id=NEW.user_id
            UNION SELECT user_id FROM (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
              SELECT id,user_id,parent_id FROM posts WHERE id=NEW.parent_id UNION ALL
              SELECT p.id,p.user_id,p.parent_id FROM posts p JOIN ancestors a ON p.id=a.parent_id
            ) SELECT user_id FROM ancestors)`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_posts_update AFTER UPDATE ON posts BEGIN
          ${clear(`SELECT follower_id FROM follows WHERE following_id IN (OLD.user_id,NEW.user_id)
            UNION SELECT user_id FROM (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
              SELECT id,user_id,parent_id FROM posts WHERE id IN (OLD.parent_id,NEW.parent_id) UNION ALL
              SELECT p.id,p.user_id,p.parent_id FROM posts p JOIN ancestors a ON p.id=a.parent_id
            ) SELECT user_id FROM ancestors)
            UNION SELECT viewer_id FROM feed_snapshots s JOIN feed_snapshot_items i ON i.snapshot_id=s.id
              WHERE json_extract(i.payload,'$.id')=OLD.id`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_posts_delete AFTER DELETE ON posts BEGIN
          ${clear(`SELECT follower_id FROM follows WHERE following_id=OLD.user_id
            UNION SELECT user_id FROM (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
              SELECT id,user_id,parent_id FROM posts WHERE id=OLD.parent_id UNION ALL
              SELECT p.id,p.user_id,p.parent_id FROM posts p JOIN ancestors a ON p.id=a.parent_id
            ) SELECT user_id FROM ancestors)
            UNION SELECT viewer_id FROM feed_snapshots s JOIN feed_snapshot_items i ON i.snapshot_id=s.id
              WHERE json_extract(i.payload,'$.id')=OLD.id`)}
        END;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_post_tags_insert AFTER INSERT ON post_hashtags BEGIN
          ${clear(`SELECT user_id FROM hashtag_follows WHERE tag=NEW.tag`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_post_tags_delete AFTER DELETE ON post_hashtags BEGIN
          ${clear(`SELECT user_id FROM hashtag_follows WHERE tag=OLD.tag`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_mentions_insert AFTER INSERT ON post_mentions BEGIN
          ${clear('SELECT NEW.user_id')}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_mentions_delete AFTER DELETE ON post_mentions BEGIN
          ${clear('SELECT OLD.user_id')}
        END;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_follows_insert AFTER INSERT ON follows BEGIN
          ${clear(`SELECT NEW.follower_id UNION SELECT NEW.following_id
            UNION SELECT follower_id FROM follows WHERE following_id=NEW.follower_id`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_follows_update AFTER UPDATE ON follows BEGIN
          ${clear(`SELECT OLD.follower_id UNION SELECT OLD.following_id
            UNION SELECT NEW.follower_id UNION SELECT NEW.following_id
            UNION SELECT follower_id FROM follows WHERE following_id IN (OLD.follower_id,NEW.follower_id)`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_follows_delete AFTER DELETE ON follows BEGIN
          ${clear(`SELECT OLD.follower_id UNION SELECT OLD.following_id
            UNION SELECT follower_id FROM follows WHERE following_id=OLD.follower_id`)}
        END;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_hashtag_follows_insert AFTER INSERT ON hashtag_follows BEGIN
          ${clear(`SELECT NEW.user_id UNION SELECT follower_id FROM follows WHERE following_id=NEW.user_id
            UNION SELECT user_id FROM hashtag_follows WHERE tag=NEW.tag`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_hashtag_follows_update AFTER UPDATE ON hashtag_follows BEGIN
          ${clear(`SELECT OLD.user_id UNION SELECT NEW.user_id
            UNION SELECT follower_id FROM follows WHERE following_id IN (OLD.user_id,NEW.user_id)
            UNION SELECT user_id FROM hashtag_follows WHERE tag IN (OLD.tag,NEW.tag)`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_hashtag_follows_delete AFTER DELETE ON hashtag_follows BEGIN
          ${clear(`SELECT OLD.user_id UNION SELECT follower_id FROM follows WHERE following_id=OLD.user_id
            UNION SELECT user_id FROM hashtag_follows WHERE tag=OLD.tag`)}
        END;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_blocks_insert AFTER INSERT ON blocks BEGIN
          ${clear('SELECT NEW.blocker_id UNION SELECT NEW.blocked_id')}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_blocks_delete AFTER DELETE ON blocks BEGIN
          ${clear('SELECT OLD.blocker_id UNION SELECT OLD.blocked_id')}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_blocked_tags_insert AFTER INSERT ON blocked_hashtags BEGIN
          ${clear('SELECT NEW.user_id')}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_blocked_tags_delete AFTER DELETE ON blocked_hashtags BEGIN
          ${clear('SELECT OLD.user_id')}
        END;

        CREATE TRIGGER IF NOT EXISTS personalized_feed_users_insert AFTER INSERT ON users BEGIN
          INSERT INTO personalized_feed_generations(viewer_id,generation) VALUES(NEW.id,1)
            ON CONFLICT(viewer_id) DO UPDATE SET generation=generation+1;
          UPDATE personalized_feed_generations SET generation=generation+1 WHERE viewer_id!=NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_users_update AFTER UPDATE ON users BEGIN
          ${clear(`SELECT NEW.id UNION SELECT follower_id FROM follows WHERE following_id=NEW.id
            UNION SELECT viewer_id FROM feed_snapshots s JOIN feed_snapshot_items i ON i.snapshot_id=s.id
              WHERE json_extract(i.payload,'$.actor_id')=NEW.id
                OR json_extract(i.payload,'$.target_handle') IN (OLD.handle,NEW.handle)`)}
        END;
        CREATE TRIGGER IF NOT EXISTS personalized_feed_users_delete AFTER DELETE ON users BEGIN
          ${clear(`SELECT OLD.id UNION SELECT follower_id FROM follows WHERE following_id=OLD.id`)}
        END;
      `)
    },
  },
  {
    version: 113,
    name: 'link_preview_mime_types',
    up(database) {
      if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_link_previews'").get()) {
        addColumn(database, 'post_link_previews', 'mime_type', 'TEXT')
      }
      if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_bio_link_previews'").get()) {
        addColumn(database, 'user_bio_link_previews', 'mime_type', 'TEXT')
      }
    },
  },
  {
    version: 114,
    name: 'remove_orphaned_feed_snapshots',
    up(database) {
      if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feed_snapshots'").get()) return
      database.run(`DELETE FROM feed_snapshots WHERE viewer_id NOT IN (SELECT id FROM users);
        CREATE TRIGGER IF NOT EXISTS feed_snapshots_delete_user AFTER DELETE ON users BEGIN
          DELETE FROM feed_snapshots WHERE viewer_id=OLD.id;
        END;`)
    },
  },
  {
    version: 115,
    name: 'reinstall_safe_personalized_feed_triggers',
    up(database) {
      // Existing databases retain the trigger SQL originally installed by migration 112.
      // Re-run its idempotent installer so the affected-user query is joined against users.
      migrations.find(migration => migration.version === 112)!.up(database)
    },
  },
  {
    version: 116,
    name: 'bio_banner_dismissals',
    up(database) {
      database.run(`CREATE TABLE IF NOT EXISTS bio_banner_dismissals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
    },
  },
  {
    version: 117,
    name: 'increase_post_character_limit',
    transaction: false,
    up(database) {
      const tableSql = (name: string) => (database.query(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      ).get(name) as { sql: string } | null)?.sql || ''
      database.run('PRAGMA legacy_alter_table=ON')
      try {
        if (tableSql('posts').includes('CHECK(length(body) BETWEEN 1 AND 280)')) {
          const postObjects = database.query(`SELECT sql FROM sqlite_master
            WHERE tbl_name='posts' AND type IN ('index','trigger') AND sql IS NOT NULL`).all() as { sql: string }[]
          database.run(`ALTER TABLE posts RENAME TO posts_old;
            CREATE TABLE posts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,deleted_at TEXT,
              has_latex INTEGER CHECK(has_latex IN (0,1)),has_links INTEGER CHECK(has_links IN (0,1)),
              has_code INTEGER CHECK(has_code IN (0,1)));
            INSERT INTO posts SELECT * FROM posts_old;
            DROP TABLE posts_old;`)
          for (const { sql } of postObjects) database.run(sql)
        }

        if (tableSql('drafts').includes('CHECK(length(body) BETWEEN 1 AND 280)')) {
          database.run(`ALTER TABLE drafts RENAME TO drafts_old;
            CREATE TABLE drafts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
              body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO drafts SELECT * FROM drafts_old;
            DROP TABLE drafts_old;
            CREATE INDEX drafts_user_updated ON drafts(user_id,updated_at DESC,id DESC);`)
        }
      }
      finally {
        database.run('PRAGMA legacy_alter_table=OFF')
      }
    },
  },
  {
    version: 118,
    name: 'backfill_missed_hashtag_follow_activity',
    up(database) {
      // API hashtag follows created before this migration omitted created_at, which kept them out of For You.
      // The rows do not retain their write source or original time, so surface all undated follows from now on.
      if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hashtag_follows'").get()) return
      database.run('UPDATE hashtag_follows SET created_at=CURRENT_TIMESTAMP WHERE created_at IS NULL')
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
    if (migration.transaction === false) {
      const foreignKeys = (database.query('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
      if (foreignKeys) database.run('PRAGMA foreign_keys=OFF')
      try {
        database.transaction(() => {
          migration.up(database)
          database.run(`PRAGMA user_version=${migration.version}`)
        })()
      }
      finally {
        if (foreignKeys) database.run('PRAGMA foreign_keys=ON')
      }
    }
    else {
      database.transaction(() => {
        migration.up(database)
        database.run(`PRAGMA user_version=${migration.version}`)
      })()
    }
    onMigration?.(migration)
  }
  const integrity = database.query('PRAGMA foreign_key_check').all()
  if (integrity.length) {
    throw new Error(`Database foreign-key check failed after migration: ${JSON.stringify(integrity)}`)
  }
  return databaseVersion(database)
}
