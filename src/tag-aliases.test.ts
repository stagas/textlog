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

  expect(await executeDatabaseDomain(database, 'admin.tagDisplayNames', {})).toEqual([
    { tag: 'asciiart', displayName: 'ascii_art' },
  ])
  await executeDatabaseDomain(database, 'admin.setTagDisplayName', {
    tag: 'meta', displayName: 'Me_Ta',
  })
  expect((await executeDatabaseDomain(database, 'tags.page', {
    tag: 'meta', viewerId: -1, page: 1, pageSize: 100, tab: 'notes',
  })).displayName).toBe('Me_Ta')
  expect((await executeDatabaseDomain(database, 'explore.page', {
    viewerId: -1, tagsPage: 1, peoplePage: 1,
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  await executeDatabaseDomain(database, 'interactions.toggleTagFollow', { userId: 1, tag: 'meta' })
  expect((await executeDatabaseDomain(database, 'profiles.connectionsPage', {
    profileId: 1, viewerId: 1, page: 1, tagsPage: 1, kind: 'following', sort: 'abc',
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  expect(await executeDatabaseDomain(database, 'admin.removeTagDisplayName', { tag: 'meta' })).toBe(true)
})
