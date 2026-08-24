import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { databaseVersion, latestMigrationVersion, migrations, runMigrations } from './migrations'
import { sessionHash } from './sessions'

describe('database migrations', () => {
  test('upgrades the original single feed key schema without invalidating its key', () => {
    const database = new Database(':memory:')
    database.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(7);
      CREATE TABLE feed_keys (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
      INSERT INTO feed_keys VALUES(7,'existing-hash',1234);
      PRAGMA user_version=91;`)

    expect(runMigrations(database)).toBe(latestMigrationVersion)
    expect(database.query(`SELECT id,token_hash,user_id,name,created_at,expires_at,last_used_at
      FROM feed_keys`).get()).toEqual({
      id: 1,
      token_hash: 'existing-hash',
      user_id: 7,
      name: 'original feed key',
      created_at: 1234,
      expires_at: null,
      last_used_at: null,
    })
  })

  test('builds the current schema from an empty database and is idempotent', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    const applied: number[] = []

    expect(runMigrations(database, migration => applied.push(migration.version))).toBe(latestMigrationVersion)
    expect(applied).toEqual(migrations.map(migration => migration.version))
    expect((database.query('PRAGMA table_info(sessions)').all() as { name: string }[]).map(column => column.name))
      .toContain('token_hash')
    expect((database.query('PRAGMA table_info(sessions)').all() as { name: string }[]).map(column => column.name))
      .toContain('last_used_at')
    expect(
      database.query('SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'handle_history\'').get(),
    )
      .toEqual({ count: 1 })
    expect(database.query('SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'post_hot\'').get())
      .toEqual({ count: 1 })
    const userColumns = (database.query('PRAGMA table_info(users)').all() as { name: string }[])
      .map(column => column.name)
    expect(userColumns).toContain('activity_read_at')
    expect(userColumns).toContain('account_group_id')
    expect(userColumns).toContain('timezone')
    expect(userColumns).not.toContain('api_writes_enabled_at')
    expect((database.query('PRAGMA table_info(handle_history)').all() as { name: string }[])
      .map(column => column.name)).toContain('account_group_id')
    expect(
      database.query('SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'activity_reads\'').get(),
    )
      .toEqual({ count: 1 })
    expect(
      database.query('SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'blocked_hashtags\'')
        .get(),
    )
      .toEqual({ count: 1 })
    expect(
      database.query(
        'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'illegal_activity_reports\'',
      ).get(),
    )
      .toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'post_search\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'user_search\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'tag_search\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'push_subscriptions\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'notification_user_agents\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'appearance_user_agents\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'device_settings\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'api_keys\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'feed_keys\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'account_groups\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'account_creation_events\'',
    ).get()).toEqual({ count: 1 })
    expect(database.query(
      'SELECT count(*) count FROM sqlite_master WHERE type=\'table\' AND name=\'password_login_nonces\'',
    ).get()).toEqual({ count: 1 })
    const pushColumns = (database.query('PRAGMA table_info(push_subscriptions)').all() as { name: string }[])
      .map(column => column.name)
    expect(pushColumns).toContain('notify_latest')
    expect(pushColumns).toContain('notify_replies')
    expect(pushColumns).toContain('notify_mentions')
    expect(pushColumns).toContain('notify_follows')
    expect(pushColumns).toContain('notify_own_posts')
    expect(pushColumns).toContain('notify_signups')
    expect(pushColumns).toContain('notify_follow_activity')
    expect(pushColumns).toContain('notify_following_notes')
    expect(pushColumns).not.toContain('notify_following_bots')
    expect(pushColumns).toContain('notify_following_only_to_me')
    expect(pushColumns).not.toContain('notify_bots')
    expect(pushColumns).toContain('device_id')
    expect((database.query('PRAGMA table_info(push_subscriptions)').all() as { name: string; pk: number }[])
      .filter(column => column.pk).map(column => column.name)).toEqual(['endpoint', 'user_id'])
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='notification_improvement_user_agents'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='donation_banner_dismissals'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='invite_banner_dismissals'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='bio_banner_dismissals'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='recap_unsubscribe_tokens'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='recap_email_deliveries'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='interacted_unsubscribe_tokens'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='interacted_email_deliveries'`).get()).toEqual({ count: 1 })
    const deviceSettingColumns = (database.query('PRAGMA table_info(device_settings)').all() as { name: string }[])
      .map(column => column.name)
    expect(deviceSettingColumns).toContain('page_size')
    expect(deviceSettingColumns).toContain('density')
    const migratedUserColumns = (database.query('PRAGMA table_info(users)').all() as { name: string }[])
      .map(column => column.name)
    expect(migratedUserColumns).toContain('show_link_previews')
    expect(migratedUserColumns).toContain('recap_emails')
    expect(migratedUserColumns).toContain('interaction_emails')
    const hashtagFollowColumns = (database.query('PRAGMA table_info(hashtag_follows)').all() as { name: string }[])
      .map(column => column.name)
    expect(hashtagFollowColumns).toContain('created_at')

    const reapplied: number[] = []
    expect(runMigrations(database, migration => reapplied.push(migration.version))).toBe(latestMigrationVersion)
    expect(reapplied).toEqual([])
  })

  test('marks latest posts before each user most recent visit as read', () => {
    const database = new Database(':memory:')
    database.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
        last_used_at INTEGER);
      CREATE TABLE latest_reads(user_id INTEGER NOT NULL REFERENCES users(id),
        post_id INTEGER NOT NULL REFERENCES posts(id),read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,post_id));
      INSERT INTO users(id) VALUES(1),(2),(3);
      INSERT INTO posts(id,user_id,created_at) VALUES
        (10,2,'2026-08-20 09:00:00'),(11,2,'2026-08-20 11:00:00'),(12,2,'2026-08-20 13:00:00');
      INSERT INTO sessions(token_hash,user_id,last_used_at) VALUES
        ('old',1,${new Date('2026-08-20T10:00:00Z').getTime()}),
        ('new',1,${new Date('2026-08-20T12:00:00Z').getTime()}),
        ('other',2,${new Date('2026-08-20T10:00:00Z').getTime()});
      PRAGMA user_version=107;`)

    expect(runMigrations(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT user_id,post_id FROM latest_reads ORDER BY user_id,post_id').all()).toEqual([
      { user_id: 1, post_id: 10 },
      { user_id: 1, post_id: 11 },
      { user_id: 2, post_id: 10 },
    ])
    database.query('INSERT INTO users(id) VALUES(4)').run()
    expect(database.query('SELECT post_id FROM latest_reads WHERE user_id=4 ORDER BY post_id').all()).toEqual([
      { post_id: 10 }, { post_id: 11 }, { post_id: 12 },
    ])
  })

  test('repairs accounts whose existing posts were not initialized as latest reads', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,created_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,last_used_at INTEGER);
      CREATE TABLE latest_reads(user_id INTEGER,post_id INTEGER,read_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,post_id));
      INSERT INTO users VALUES(1,'2026-08-20 12:00:00');
      INSERT INTO posts VALUES
        (10,2,'2026-08-20 11:00:00'),(11,2,'2026-08-20 12:00:00'),(12,2,'2026-08-20 13:00:00');
      PRAGMA user_version=109;`)

    expect(runMigrations(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT post_id FROM latest_reads WHERE user_id=1 ORDER BY post_id').all())
      .toEqual([{ post_id: 10 }, { post_id: 11 }])
  })

  test('moves migration-time hashtag follows into the past without losing read state', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE hashtag_follows(user_id INTEGER NOT NULL,tag TEXT NOT NULL,created_at TEXT,
        PRIMARY KEY(user_id,tag));
      CREATE TABLE for_you_reads(user_id INTEGER NOT NULL,event_key TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,event_key));
      INSERT INTO users VALUES(1),(2),(3);
      INSERT INTO hashtag_follows VALUES(2,'news','2026-08-23 12:00:00');
      INSERT INTO for_you_reads VALUES(1,
        'tag-follow:00000000000000000002:news:2026-08-23 12:00:00','2026-08-23 12:01:00');
      PRAGMA user_version=118;`)

    expect(runMigrations(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT created_at FROM hashtag_follows').get())
      .toEqual({ created_at: '1970-01-01 00:00:00' })
    expect(database.query(`SELECT read_at FROM for_you_reads
      WHERE event_key='tag-follow:00000000000000000002:news:1970-01-01 00:00:00'`).get())
      .toMatchObject({ read_at: expect.any(String) })
    expect(database.query(`SELECT count(*) count FROM for_you_reads
      WHERE event_key='tag-follow:00000000000000000002:news:1970-01-01 00:00:00'`).get())
      .toEqual({ count: 3 })
  })

  test('upgrades legacy data and backfills follow activity timestamps', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    migrations[0].up(database)
    database.run(`PRAGMA user_version=1;
      INSERT INTO users(id,handle,email,password) VALUES
        (1,'author','author@example.com','x'),(2,'reader','reader@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'hello @reader');
      INSERT INTO follows(follower_id,following_id) VALUES(1,2);
      INSERT INTO hashtag_follows(user_id,tag) VALUES(1,'legacy');
      INSERT INTO sessions(token,user_id,expires_at) VALUES('legacy-cookie',1,9999999999999);`)

    runMigrations(database)

    expect(databaseVersion(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT user_id FROM post_mentions WHERE post_id=1').get()).toEqual({ user_id: 2 })
    expect((database.query('SELECT created_at FROM follows WHERE follower_id=1').get() as {
      created_at: string | null
    }).created_at).not.toBeNull()
    expect((database.query('SELECT created_at FROM hashtag_follows WHERE tag=\'legacy\'').get() as {
      created_at: string | null
    }).created_at).toBe('1970-01-01 00:00:00')
    expect(database.query('SELECT token_hash FROM sessions').get())
      .toEqual({ token_hash: sessionHash('legacy-cookie') })
    expect(database.query(`SELECT g.primary_user_id,g.selected_user_id,u.account_group_id
      FROM users u JOIN account_groups g ON g.id=u.account_group_id WHERE u.id=1`).get()).toMatchObject({
      primary_user_id: 1,
      selected_user_id: 1,
    })
    expect(() =>
      database.query('INSERT INTO users(handle,email,password) VALUES(?,?,?)')
        .run('second_persona', 'author@example.com', '!')
    ).not.toThrow()
    expect(database.query('SELECT score FROM post_hot WHERE post_id=1').get()).toEqual({ score: 0 })
    expect(database.query('SELECT rowid FROM post_search WHERE post_search MATCH \'hello\'').get()).toEqual({
      rowid: 1,
    })
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('rebuilds Unicode hashtags without changing posts or hashtag follows', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,body,created_at) VALUES
        (1,1,'hello #Ελλάδα #café','2020-01-02 03:04:05'),
        (2,1,'deleted #日本語','2020-02-03 04:05:06');
      UPDATE posts SET deleted_at='2021-01-01 00:00:00' WHERE id=2;
      INSERT INTO post_hashtags(post_id,tag) VALUES(1,'stale'),(2,'日本語');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'stale','2022-03-04 05:06:07');
      PRAGMA user_version=48;`)

    runMigrations(database)

    expect(database.query('SELECT post_id,tag FROM post_hashtags ORDER BY tag').all()).toEqual([
      { post_id: 1, tag: 'café' },
      { post_id: 1, tag: 'ελλάδα' },
    ])
    expect(database.query('SELECT body,created_at FROM posts ORDER BY id').all()).toEqual([
      { body: 'hello #Ελλάδα #café', created_at: '2020-01-02 03:04:05' },
      { body: 'deleted #日本語', created_at: '2020-02-03 04:05:06' },
    ])
    expect(database.query('SELECT tag,created_at FROM hashtag_follows').all())
      .toEqual([{ tag: 'stale', created_at: '1970-01-01 00:00:00' }])
    expect(database.query('SELECT tag FROM tag_search WHERE tag_search MATCH \'ελλάδα\'').get())
      .toEqual({ tag: 'ελλάδα' })
  })

  test('rebuilds hashtags without URL fragments', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES
        (1,1,'https://example.com/docs#plain [guide](https://example.com/docs#markdown) #actual'),
        (2,1,'deleted #old');
      UPDATE posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=2;
      INSERT INTO post_hashtags(post_id,tag) VALUES
        (1,'plain'),(1,'markdown'),(2,'old');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES
        (1,'plain','2026-08-01 02:03:04'),(1,'actual','2026-08-02 03:04:05');
      PRAGMA user_version=62;`)

    runMigrations(database)

    expect(database.query('SELECT post_id,tag FROM post_hashtags ORDER BY post_id,tag').all())
      .toEqual([{ post_id: 1, tag: 'actual' }])
    expect(database.query('SELECT tag FROM tag_search WHERE tag_search MATCH \'actual\'').get())
      .toEqual({ tag: 'actual' })
    expect(database.query('SELECT tag,created_at FROM hashtag_follows ORDER BY tag').all()).toEqual([
      { tag: 'actual', created_at: '1970-01-01 00:00:00' },
      { tag: 'plain', created_at: '1970-01-01 00:00:00' },
    ])
  })

  test('rebuilds hashtags without Markdown code while preserving tag relationships', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES
        (1,'author','author@example.com','x'),(2,'reader','reader@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES
        (1,1,'#visible \`#inline\`\n\`\`\`ts\n#fenced\n\`\`\`'),
        (2,1,'deleted #old');
      UPDATE posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=2;
      INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES
        (1,'inline'),(1,'fenced'),(2,'old');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES
        (2,'inline','2026-08-03 04:05:06'),(2,'visible','2026-08-04 05:06:07');
      INSERT INTO blocked_hashtags(user_id,tag) VALUES(2,'fenced');
      PRAGMA user_version=101;`)

    runMigrations(database)

    expect(database.query('SELECT post_id,tag FROM post_hashtags ORDER BY post_id,tag').all())
      .toEqual([{ post_id: 1, tag: 'visible' }])
    expect(database.query('SELECT tag,created_at FROM hashtag_follows ORDER BY tag').all()).toEqual([
      { tag: 'inline', created_at: '1970-01-01 00:00:00' },
      { tag: 'visible', created_at: '1970-01-01 00:00:00' },
    ])
    expect(database.query('SELECT user_id,tag FROM blocked_hashtags').all())
      .toEqual([{ user_id: 2, tag: 'fenced' }])
    expect(database.query("SELECT tag FROM tag_search WHERE tag_search MATCH 'visible'").get())
      .toEqual({ tag: 'visible' })
    expect(database.query("SELECT tag FROM tag_search WHERE tag_search MATCH 'inline'").get()).toBeNull()
  })

  test('repairs account deletion tables created by the original version 30 migration', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`DROP TABLE account_deletion_tokens;
      CREATE TABLE account_deletion_tokens (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL);
      INSERT INTO users(id,handle,email,password) VALUES(1,'reader','reader@example.com','!');
      INSERT INTO account_deletion_tokens VALUES('token',1,9999999999999);
      PRAGMA user_version=30;`)

    runMigrations(database)

    expect(databaseVersion(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT email FROM account_deletion_tokens WHERE user_id=1').get())
      .toEqual({ email: 'reader@example.com' })
  })

  test('preserves the legacy activity read cutoff when upgrading per-entry reads', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password,activity_read_at) VALUES
        (1,'reader','reader@example.com','x','2026-08-05 12:00:00'),
        (2,'author','author@example.com','x',NULL);
      INSERT INTO posts(id,user_id,body,created_at) VALUES
        (1,1,'root','2026-08-05 09:00:00'),
        (2,2,'old reply','2026-08-05 10:00:00'),
        (3,2,'new reply','2026-08-05 13:00:00');
      UPDATE posts SET parent_id=1 WHERE id IN (2,3);
      INSERT INTO follows(follower_id,following_id,created_at) VALUES
        (2,1,'2026-08-05 11:00:00');
      DELETE FROM activity_reads;
      PRAGMA user_version=18;`)

    runMigrations(database)

    expect(database.query('SELECT event_key FROM activity_reads ORDER BY event_key').all())
      .toEqual([{ event_key: 'follow:2:2026-08-05 11:00:00' }, { event_key: 'post:2' }])
  })

  test('synchronizes existing post reads between activity and for-you', () => {
    const database = new Database(':memory:')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES
        (1,'one','one@example.com','x'),(2,'two','two@example.com','x');
      INSERT INTO activity_reads(user_id,event_key) VALUES(1,'post:12');
      INSERT INTO for_you_reads(user_id,event_key) VALUES(2,'post:00000000000000000034');
      PRAGMA user_version=47;`)

    runMigrations(database)

    expect(database.query('SELECT event_key FROM for_you_reads WHERE user_id=1').get())
      .toEqual({ event_key: 'post:00000000000000000012' })
    expect(database.query('SELECT event_key FROM activity_reads WHERE user_id=2').get())
      .toEqual({ event_key: 'post:34' })
  })

  test('refuses a database created by a newer application version', () => {
    const database = new Database(':memory:')
    database.run(`PRAGMA user_version=${latestMigrationVersion + 1}`)
    expect(() => runMigrations(database)).toThrow('newer than supported')
  })

  test('does not retain bot account flags', () => {
    const database = new Database(':memory:')
    runMigrations(database)
    database.query('INSERT INTO users(handle,email,password) VALUES(\'person\',\'person@example.com\',\'x\')').run()

    const columns = (database.query('PRAGMA table_info(users)').all() as { name: string }[]).map(row => row.name)
    expect(columns).not.toContain('is_bot')
    expect(columns).not.toContain('bot_managed')
  })

  test('removes the obsolete per-account API write flag from version 24 databases', () => {
    const database = new Database(':memory:')
    runMigrations(database)
    database.run('ALTER TABLE users ADD COLUMN api_writes_enabled_at TEXT; PRAGMA user_version=24')

    runMigrations(database)

    expect((database.query('PRAGMA table_info(users)').all() as { name: string }[]).map(column => column.name))
      .not.toContain('api_writes_enabled_at')
  })

  test('preserves a device subscription while allowing that endpoint for another account', () => {
    const database = new Database(':memory:')
    database.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(1),(2);
      CREATE TABLE push_subscriptions (
        endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,auth TEXT NOT NULL,notify_latest INTEGER NOT NULL DEFAULT 1,
        notify_replies INTEGER NOT NULL DEFAULT 1,notify_mentions INTEGER NOT NULL DEFAULT 1,
        notify_follows INTEGER NOT NULL DEFAULT 1,notify_own_posts INTEGER NOT NULL DEFAULT 1,
        notify_signups INTEGER NOT NULL DEFAULT 1,notify_follow_activity INTEGER NOT NULL DEFAULT 1,
        notify_following_notes INTEGER NOT NULL DEFAULT 0,device_id TEXT);
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,notify_mentions,device_id)
        VALUES('https://push.example/shared',1,'key','auth',0,'device');`)

    migrations.find(migration => migration.version === 58)!.up(database)
    database.query(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/shared',2,'key','auth')`).run()

    expect(database.query(`SELECT user_id,notify_mentions,device_id FROM push_subscriptions
      WHERE endpoint='https://push.example/shared' ORDER BY user_id`).all()).toEqual([
      { user_id: 1, notify_mentions: 0, device_id: 'device' },
      { user_id: 2, notify_mentions: 1, device_id: null },
    ])
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('discards legacy unkeyed visitor hashes during the privacy migration', () => {
    const database = new Database(':memory:')
    database.run('CREATE TABLE daily_visitors(day TEXT,visitor_hash TEXT)')
    database.query('INSERT INTO daily_visitors VALUES(?,?)').run('2026-08-04', 'legacy-unsalted-hash')
    migrations.find(migration => migration.name === 'rotating_ip_pseudonyms')!.up(database)
    expect(database.query('SELECT count(*) count FROM daily_visitors').get()).toEqual({ count: 0 })
  })

  test('removes the withdrawn illegal-content notice table from version 9 databases', () => {
    const database = new Database(':memory:')
    database.run('CREATE TABLE illegal_content_notices(id INTEGER); PRAGMA user_version=9')
    migrations.find(migration => migration.version === 10)!.up(database)
    expect(database.query('SELECT count(*) count FROM sqlite_master WHERE name=\'illegal_content_notices\'').get())
      .toEqual({ count: 0 })
  })

  test('rebuilds hot scores to exclude nested reply weight while retaining conversation activity', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES
        (1,'author','author@example.com','x'),(2,'replier','replier@example.com','x');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'root','2026-08-05 09:00:00'),
        (2,2,1,'direct','2026-08-05 10:00:00'),
        (3,1,2,'nested','2026-08-05 11:00:00');
      UPDATE post_hot SET score=99,score_updated_at='2026-08-05 11:00:00',
        latest_activity_at='2026-08-05 11:00:00' WHERE post_id=1;
      PRAGMA user_version=19;`)

    runMigrations(database)

    expect(database.query('SELECT latest_activity_at FROM post_hot WHERE post_id=1').get())
      .toEqual({ latest_activity_at: '2026-08-05 10:00:00' })
    expect(database.query('SELECT score FROM post_hot WHERE post_id=1').get()).not.toEqual({ score: 99 })
  })

  test('rebuilds hot scores to exclude author participation while retaining conversation activity', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'root','2026-08-05 09:00:00'),
        (2,1,1,'self reply','2026-08-05 10:00:00');
      UPDATE post_hot SET score=2,score_updated_at='2026-08-05 10:00:00',
        latest_activity_at='2026-08-05 10:00:00' WHERE post_id=1;
      PRAGMA user_version=20;`)

    runMigrations(database)

    expect(database.query('SELECT score,latest_activity_at FROM post_hot WHERE post_id=1').get())
      .toEqual({ score: 0, latest_activity_at: '2026-08-05 09:00:00' })
  })

  test('rebuilds hot scores to include votes cast before vote-aware ranking', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES
        (1,'author','author@example.com','x'),(2,'voter','voter@example.com','x');
      INSERT INTO posts(id,user_id,body,created_at) VALUES
        (1,1,'Question? #poll\nYes\nNo','2026-08-05 09:00:00');
      INSERT INTO poll_options(id,post_id,position,label) VALUES(1,1,0,'Yes'),(2,1,1,'No');
      INSERT INTO poll_votes(post_id,option_id,user_id,created_at)
        VALUES(1,1,2,'2026-08-05 11:00:00');
      UPDATE post_hot SET score=0,reply_count=0,score_updated_at='2026-08-05 09:00:00',
        latest_activity_at='2026-08-05 09:00:00' WHERE post_id=1;
      PRAGMA user_version=102;`)

    runMigrations(database)

    expect(database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1').get())
      .toEqual({ score: 2, reply_count: 0, latest_activity_at: '2026-08-05 11:00:00' })
  })

  test('removes quiz explanations that were stored as answer options', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,body,created_at) VALUES
        (1,1,'Planet? #quiz\nEarth\n> Jupiter\n\nJupiter has the shortest day.','2026-08-23 09:00:00');
      DELETE FROM poll_options WHERE post_id=1;
      INSERT INTO poll_options(post_id,position,label) VALUES
        (1,0,'Earth'),(1,1,'Jupiter'),(1,2,'Jupiter has the shortest day.');
      PRAGMA user_version=119;`)

    runMigrations(database)

    expect(database.query('SELECT position,label FROM poll_options WHERE post_id=1 ORDER BY position').all())
      .toEqual([{ position: 0, label: 'Earth' }, { position: 1, label: 'Jupiter' }])
  })

  test('removes orphaned feed snapshots before post updates invalidate personalized feeds', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'hello');
      PRAGMA foreign_keys=OFF;
      INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items) VALUES('for-you:stale',999,1,1);
      INSERT INTO feed_snapshot_items(snapshot_id,position,payload)
        VALUES(last_insert_rowid(),0,'{"id":1}');
      PRAGMA foreign_keys=ON;
      PRAGMA user_version=113;`)

    runMigrations(database)

    expect(database.query('SELECT count(*) count FROM feed_snapshots WHERE viewer_id=999').get()).toEqual({ count: 0 })
    expect(() => database.query("UPDATE posts SET body='(deleted)' WHERE id=1").run()).not.toThrow()
  })

  test('reinstalls foreign-key-safe personalized feed triggers on existing databases', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'hello');
      DROP TRIGGER personalized_feed_posts_update;
      CREATE TRIGGER personalized_feed_posts_update AFTER UPDATE ON posts BEGIN
        INSERT INTO personalized_feed_generations(viewer_id,generation)
        WITH affected(id) AS (
          SELECT viewer_id FROM feed_snapshots s JOIN feed_snapshot_items i ON i.snapshot_id=s.id
          WHERE json_extract(i.payload,'$.id')=OLD.id
        ) SELECT id,2 FROM affected WHERE id IS NOT NULL
        ON CONFLICT(viewer_id) DO UPDATE SET generation=generation+1;
      END;
      PRAGMA foreign_keys=OFF;
      INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items) VALUES('for-you:stale',999,1,1);
      INSERT INTO feed_snapshot_items(snapshot_id,position,payload)
        VALUES(last_insert_rowid(),0,'{"id":1}');
      PRAGMA foreign_keys=ON;
      PRAGMA user_version=114;`)

    expect(() => database.query("UPDATE posts SET body='fails' WHERE id=1").run()).toThrow()

    runMigrations(database)

    const sql = (database.query(`SELECT sql FROM sqlite_master
      WHERE type='trigger' AND name='personalized_feed_posts_update'`).get() as { sql: string }).sql
    expect(sql).toContain('JOIN users ON users.id=affected.id')
    expect(() => database.query("UPDATE posts SET body='works' WHERE id=1").run()).not.toThrow()
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('invalidates an author personalized feed when their own posts change', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    database.run("INSERT INTO users(id,handle,email,password) VALUES(1,'author','author@example.com','x')")
    const generation = () => (database.query(
      'SELECT generation FROM personalized_feed_generations WHERE viewer_id=1',
    ).get() as { generation: number }).generation

    const initial = generation()
    database.run("INSERT INTO posts(id,user_id,body) VALUES(1,1,'hello')")
    expect(generation()).toBe(initial + 1)
    database.run("UPDATE posts SET body='edited' WHERE id=1")
    expect(generation()).toBe(initial + 2)
    database.run('DELETE FROM posts WHERE id=1')
    expect(generation()).toBe(initial + 3)
  })

  test('replaces legacy internal OG previews with native post references', () => {
    const previous = Bun.env.APP_URL
    Bun.env.APP_URL = 'http://localhost:3000'
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,deleted_at TEXT);
      CREATE TABLE post_link_previews(post_id INTEGER,url TEXT,image_url TEXT,title TEXT,description TEXT,
        site_name TEXT,image_width INTEGER,image_height INTEGER,mime_type TEXT,linked_post_id INTEGER,
        PRIMARY KEY(post_id,url));
      INSERT INTO users(id) VALUES(1);
      INSERT INTO posts(id,user_id) VALUES(12,1),(20,1);
      INSERT INTO post_link_previews VALUES
        (20,'http://localhost:3000/post/12','http://localhost:3000/post/12/og.png?v=7','old title',
          'old description','textlog',1200,630,NULL,NULL),
        (20,'http://localhost:3000/post/999','old-stale-image','stale',NULL,NULL,NULL,NULL,NULL,NULL),
        (20,'https://example.com/story','remote-image','remote',NULL,NULL,NULL,NULL,NULL,NULL);`)
    try {
      migrations.find(migration => migration.version === 125)!.up(database)
      expect(database.query(`SELECT url,image_url,title,description,site_name,image_width,image_height,
        linked_post_id FROM post_link_previews WHERE url='http://localhost:3000/post/12'`).get()).toEqual({
        url: 'http://localhost:3000/post/12', image_url: 'http://localhost:3000/post/12', title: null,
        description: null, site_name: null, image_width: null, image_height: null, linked_post_id: 12,
      })
      expect(database.query(
        "SELECT 1 FROM post_link_previews WHERE url='http://localhost:3000/post/999'",
      ).get()).toBeNull()
      expect(database.query(
        "SELECT image_url,title FROM post_link_previews WHERE url='https://example.com/story'",
      ).get()).toEqual({ image_url: 'remote-image', title: 'remote' })
    }
    finally {
      Bun.env.APP_URL = previous
    }
  })
})
