import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { databaseVersion, latestMigrationVersion, migrations, runMigrations } from './migrations'
import { sessionHash } from './sessions'

describe('database migrations', () => {
  test('builds the current schema from an empty database and is idempotent', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    const applied: number[] = []

    expect(runMigrations(database, migration => applied.push(migration.version))).toBe(latestMigrationVersion)
    expect(applied).toEqual(migrations.map(migration => migration.version))
    expect((database.query('PRAGMA table_info(sessions)').all() as { name: string }[]).map(column => column.name))
      .toContain('token_hash')
    expect(database.query("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='handle_history'").get())
      .toEqual({ count: 1 })

    const reapplied: number[] = []
    expect(runMigrations(database, migration => reapplied.push(migration.version))).toBe(latestMigrationVersion)
    expect(reapplied).toEqual([])
  })

  test('upgrades legacy data and backfills mentions without creating new follow activity', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    migrations[0].up(database)
    database.run(`PRAGMA user_version=1;
      INSERT INTO users(id,handle,email,password) VALUES
        (1,'author','author@example.com','x'),(2,'reader','reader@example.com','x');
      INSERT INTO posts(id,user_id,body) VALUES(1,1,'hello @reader');
      INSERT INTO follows(follower_id,following_id) VALUES(1,2);
      INSERT INTO sessions(token,user_id,expires_at) VALUES('legacy-cookie',1,9999999999999);`)

    runMigrations(database)

    expect(databaseVersion(database)).toBe(latestMigrationVersion)
    expect(database.query('SELECT user_id FROM post_mentions WHERE post_id=1').get()).toEqual({ user_id: 2 })
    expect(database.query('SELECT created_at FROM follows WHERE follower_id=1').get()).toEqual({ created_at: null })
    expect(database.query('SELECT token_hash FROM sessions').get())
      .toEqual({ token_hash: sessionHash('legacy-cookie') })
    expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('refuses a database created by a newer application version', () => {
    const database = new Database(':memory:')
    database.run(`PRAGMA user_version=${latestMigrationVersion + 1}`)
    expect(() => runMigrations(database)).toThrow('newer than supported')
  })
})
