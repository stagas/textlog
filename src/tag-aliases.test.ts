import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'
import { createPost, updatePost } from './posts'

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
  await executeDatabaseDomain(database, 'admin.setTagDisplayName', {
    tag: 'textlog', displayName: 'Text_Log',
  })
  const tagPage = await executeDatabaseDomain(database, 'tags.page', {
    tag: 'meta', viewerId: -1, page: 1, pageSize: 100, tab: 'notes',
  })
  expect(tagPage.displayName).toBe('Me_Ta')
  expect(tagPage.aliases).toEqual([
    { tag: 'textlog', displayName: 'Text_Log' },
    { tag: 'tlog', displayName: null },
  ])
  expect((await executeDatabaseDomain(database, 'explore.page', {
    viewerId: -1, tagsPage: 1, peoplePage: 1,
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  await executeDatabaseDomain(database, 'interactions.toggleTagFollow', { userId: 1, tag: 'meta' })
  expect((await executeDatabaseDomain(database, 'profiles.connectionsPage', {
    profileId: 1, viewerId: 1, page: 1, tagsPage: 1, kind: 'following', sort: 'abc',
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  expect(await executeDatabaseDomain(database, 'admin.removeTagDisplayName', { tag: 'meta' })).toBe(true)
})

test('first use of a PascalCase tag creates its display name without an underscore alias', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query("INSERT INTO users(handle,email,password) VALUES('writer','writer@example.com','x')").run()

  const post = createPost(database, 1, 'A note about #ThisFormCapitalized', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').all(post.id)).toEqual([
    { tag: 'thisformcapitalized' },
  ])
  expect(database.query("SELECT alias FROM tag_aliases WHERE instr(alias,'_')>0").get()).toBeNull()
  expect(database.query("SELECT display_name displayName FROM tag_display_names WHERE tag='thisformcapitalized'")
    .get()).toEqual({ displayName: 'ThisFormCapitalized' })
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'this_form_capitalized' }))
    .toBe('thisformcapitalized')

  updatePost(database, post.id, 'Changed spelling: #DifferentDisplay')
  updatePost(database, post.id, 'Changed spelling again: #differentdisplay')
  expect(database.query("SELECT display_name displayName FROM tag_display_names WHERE tag='differentdisplay'")
    .get()).toEqual({ displayName: 'DifferentDisplay' })
})
