import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'

test('tag aliases resolve, aggregate posts, and can be managed by admins', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query("INSERT INTO users(handle,email,password) VALUES('writer','writer@example.com','x')").run()
  database.query("INSERT INTO posts(user_id,body) VALUES(1,'one #textlog'),(1,'two #meta'),(1,'three #features')")
    .run()
  database.query("INSERT INTO post_hashtags(post_id,tag) VALUES(1,'textlog'),(2,'meta'),(3,'features')").run()

  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'textlog' })).toBe('meta')
  expect(await executeDatabaseDomain(database, 'tags.count', { tag: 'tlog' })).toBe(2)
  expect(database.query('SELECT tag FROM post_hashtags ORDER BY post_id').all()).toEqual([
    { tag: 'meta' }, { tag: 'meta' }, { tag: 'feature' },
  ])
  expect(await executeDatabaseDomain(database, 'admin.tagAliases', {})).toEqual([
    { primaryTag: 'feature', aliases: ['features'] },
    { primaryTag: 'meta', aliases: ['textlog', 'tlog'] },
  ])

  expect(await executeDatabaseDomain(database, 'admin.addTagAliases', {
    primaryTag: 'feature', aliases: ['enhancement'],
  })).toEqual({ status: 'ready' })
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'enhancement' })).toBe('feature')
  expect(await executeDatabaseDomain(database, 'admin.removeTagAlias', { alias: 'enhancement' })).toBe(true)
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'enhancement' })).toBe('enhancement')
})
