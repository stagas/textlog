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
    expect(pushColumns).toContain('notify_following_bots')
    expect(pushColumns).toContain('notify_following_only_to_me')
    expect(pushColumns).toContain('notify_bots')
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
      WHERE type='table' AND name='recap_unsubscribe_tokens'`).get()).toEqual({ count: 1 })
    expect(database.query(`SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='recap_email_deliveries'`).get()).toEqual({ count: 1 })
    const deviceSettingColumns = (database.query('PRAGMA table_info(device_settings)').all() as { name: string }[])
      .map(column => column.name)
    expect(deviceSettingColumns).toContain('page_size')
    expect(deviceSettingColumns).toContain('density')
    const migratedUserColumns = (database.query('PRAGMA table_info(users)').all() as { name: string }[])
      .map(column => column.name)
    expect(migratedUserColumns).toContain('show_link_previews')
    expect(migratedUserColumns).toContain('recap_emails')
    const hashtagFollowColumns = (database.query('PRAGMA table_info(hashtag_follows)').all() as { name: string }[])
      .map(column => column.name)
    expect(hashtagFollowColumns).toContain('created_at')

    const reapplied: number[] = []
    expect(runMigrations(database, migration => reapplied.push(migration.version))).toBe(latestMigrationVersion)
    expect(reapplied).toEqual([])
  })

  test('upgrades legacy data and backfills person-follow but not tag-follow activity timestamps', () => {
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
    expect(database.query('SELECT created_at FROM hashtag_follows WHERE tag=\'legacy\'').get())
      .toEqual({ created_at: null })
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
      .toEqual([{ tag: 'stale', created_at: '2022-03-04 05:06:07' }])
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
      { tag: 'actual', created_at: '2026-08-02 03:04:05' },
      { tag: 'plain', created_at: '2026-08-01 02:03:04' },
    ])
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

  test('adds an opt-in bot account flag defaulting to false', () => {
    const database = new Database(':memory:')
    runMigrations(database)
    database.query("INSERT INTO users(handle,email,password) VALUES('person','person@example.com','x')").run()

    expect(database.query('SELECT is_bot FROM users WHERE handle=?').get('person')).toEqual({ is_bot: 0 })
    expect(() => database.query('UPDATE users SET is_bot=2 WHERE handle=?').run('person')).toThrow()
    expect(database.query('SELECT bot_managed FROM users WHERE handle=?').get('person')).toEqual({ bot_managed: 0 })
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
      .toEqual({ latest_activity_at: '2026-08-05 11:00:00' })
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
      .toEqual({ score: 0, latest_activity_at: '2026-08-05 10:00:00' })
  })
})
