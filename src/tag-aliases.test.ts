import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'
import { createPost, updatePost } from './posts'

test('tag aliases resolve, aggregate posts, and can be managed by admins', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()
  database.query('INSERT INTO posts(user_id,body) VALUES(1,\'one #textlog\'),(1,\'two #meta\'),(1,\'three #features\')')
    .run()
  database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(1,\'textlog\'),(2,\'meta\'),(3,\'features\')').run()

  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'textlog' })).toBe('meta')
  expect(await executeDatabaseDomain(database, 'tags.count', { tag: 'tlog' })).toBe(2)
  expect(database.query('SELECT tag FROM post_hashtags ORDER BY post_id').all()).toEqual([
    { tag: 'meta' },
    { tag: 'meta' },
    { tag: 'features' },
  ])
  expect(await executeDatabaseDomain(database, 'admin.tagAliases', {})).toEqual([
    { primaryTag: 'meta', aliases: ['textlog', 'tlog'] },
  ])

  expect(await executeDatabaseDomain(database, 'admin.addTagAliases', {
    primaryTag: 'feature',
    aliases: ['enhancement'],
  })).toEqual({ status: 'ready' })
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'enhancement' })).toBe('feature')
  expect(await executeDatabaseDomain(database, 'admin.removeTagAlias', { alias: 'enhancement' })).toBe(true)
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'enhancement' })).toBe('enhancement')

  expect(await executeDatabaseDomain(database, 'admin.tagDisplayNames', {})).toEqual([
    { tag: 'asciiart', displayName: 'ascii_art' },
  ])
  await executeDatabaseDomain(database, 'admin.setTagDisplayName', {
    tag: 'meta',
    displayName: 'Me_Ta',
  })
  await executeDatabaseDomain(database, 'admin.setTagDisplayName', {
    tag: 'textlog',
    displayName: 'Text_Log',
  })
  const tagPage = await executeDatabaseDomain(database, 'tags.page', {
    tag: 'meta',
    viewerId: -1,
    page: 1,
    pageSize: 100,
    tab: 'notes',
  })
  expect(tagPage.displayName).toBe('Me_Ta')
  expect(tagPage.aliases).toEqual([
    { tag: 'textlog', displayName: 'Text_Log' },
    { tag: 'tlog', displayName: null },
  ])
  expect((await executeDatabaseDomain(database, 'explore.page', {
    viewerId: -1,
    tagsPage: 1,
    peoplePage: 1,
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  await executeDatabaseDomain(database, 'interactions.toggleTagFollow', { userId: 1, tag: 'meta' })
  expect((await executeDatabaseDomain(database, 'profiles.connectionsPage', {
    profileId: 1,
    viewerId: 1,
    page: 1,
    tagsPage: 1,
    kind: 'following',
    sort: 'abc',
  })).tags.find(tag => tag.tag === 'meta')?.displayName).toBe('Me_Ta')
  expect(await executeDatabaseDomain(database, 'admin.removeTagDisplayName', { tag: 'meta' })).toBe(true)
})

test('tag pages load matching notes as collapsible conversation threads', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const root = createPost(database, 1, 'Conversation root', null, false)
  if (!('id' in root)) throw new Error('Expected root post')
  let parentId = root.id
  const replyIds: number[] = []
  for (let index = 0; index < 7; index++) {
    database.query('INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(1,?,?,?)')
      .run(parentId, index === 0 ? 'Tagged reply #topic' : `Reply ${index}`, `2026-09-01 0${index + 1}:00:00`)
    const replyId = (database.query('SELECT last_insert_rowid() id').get() as { id: number }).id
    if (index === 0) database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(?,\'topic\')').run(replyId)
    replyIds.push(replyId)
    parentId = replyId
  }

  const tagPage = await executeDatabaseDomain(database, 'tags.page', {
    tag: 'topic',
    viewerId: -1,
    page: 1,
    pageSize: 20,
    tab: 'notes',
  })

  expect(tagPage.total).toBe(1)
  expect(tagPage.posts.some(post => post.id === root.id)).toBeTrue()
  expect(tagPage.posts.some(post => post.id === replyIds[0])).toBeTrue()
  expect(tagPage.posts.some(post => post.feed_collapsed_preview)).toBeTrue()
  expect(tagPage.posts.map(post => post.id).sort((left, right) => left - right))
    .toEqual([root.id, ...replyIds])
})

test('first use of a PascalCase tag creates its display name without an underscore alias', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const post = createPost(database, 1, 'A note about #ThisFormCapitalized', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').all(post.id)).toEqual([
    { tag: 'thisformcapitalized' },
  ])
  expect(database.query('SELECT alias FROM tag_aliases WHERE instr(alias,\'_\')>0').get()).toBeNull()
  expect(database.query('SELECT display_name displayName FROM tag_display_names WHERE tag=\'thisformcapitalized\'')
    .get()).toEqual({ displayName: 'ThisFormCapitalized' })
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'this_form_capitalized' }))
    .toBe('thisformcapitalized')

  updatePost(database, post.id, 'Changed spelling: #DifferentDisplay')
  updatePost(database, post.id, 'Changed spelling again: #differentdisplay')
  expect(database.query('SELECT display_name displayName FROM tag_display_names WHERE tag=\'differentdisplay\'')
    .get()).toEqual({ displayName: 'DifferentDisplay' })
})

test('plural tags transparently normalize to their singular tag', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const post = createPost(database, 1, '#developers build tools', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').all(post.id))
    .toEqual([{ tag: 'developer' }])
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'developers' })).toBe('developer')
  expect(database.query('SELECT alias FROM tag_aliases WHERE alias=\'developers\'').get()).toBeNull()
  await executeDatabaseDomain(database, 'interactions.toggleTagFollow', { userId: 1, tag: 'developers' })
  expect(database.query('SELECT tag FROM hashtag_follows WHERE user_id=1').all()).toEqual([{ tag: 'developer' }])

  const classPost = createPost(database, 1, '#class', null, false)
  expect('id' in classPost).toBeTrue()
  if (!('id' in classPost)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').all(classPost.id))
    .toEqual([{ tag: 'class' }])
  expect(database.query('SELECT alias FROM tag_aliases WHERE alias=\'classs\'').get()).toBeNull()
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'classes' })).toBe('class')
  expect(database.query('SELECT alias FROM tag_aliases WHERE alias=\'classes\'').get()).toBeNull()

  const singularPost = createPost(database, 1, '#designer', null, false)
  expect('id' in singularPost).toBeTrue()
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'designers' })).toBe('designer')
})

test('WordNet forms share a cached noun topic across posts and tag routes', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const created = await executeDatabaseDomain(database, 'api.createPost', {
    userId: 1,
    body: '#philosophically and #philosophical',
    parentId: null,
    origin: 'https://example.com',
  })
  expect(created.status).toBe('ready')
  expect(database.query('SELECT tag FROM post_hashtags').all()).toEqual([{ tag: 'philosophy' }])
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'philosophically' })).toBe('philosophy')
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'philosophical' })).toBe('philosophy')
  expect(await executeDatabaseDomain(database, 'admin.tagAliases', {})).not.toContainEqual({
    primaryTag: 'philosophy',
    aliases: expect.anything(),
  })
  expect(database.query(`SELECT word,normalized_word normalizedWord FROM wordnet_normalizations
    WHERE word LIKE 'philosoph%' ORDER BY word`).all()).toEqual([
    { word: 'philosophical', normalizedWord: 'philosophy' },
    { word: 'philosophically', normalizedWord: 'philosophy' },
  ])
})

test('WordNet preserves singular nouns ending in s', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const created = await executeDatabaseDomain(database, 'api.createPost', {
    userId: 1,
    body: '#focus #diagnosis #emacs',
    parentId: null,
    origin: 'https://example.com',
  })
  expect(created.status).toBe('ready')
  expect(database.query('SELECT tag FROM post_hashtags ORDER BY tag').all()).toEqual([
    { tag: 'diagnosis' },
    { tag: 'emacs' },
    { tag: 'focus' },
  ])
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'focus' })).toBe('focus')
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'diagnosis' })).toBe('diagnosis')
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'emacs' })).toBe('emacs')
  expect(database.query(`SELECT normalized_word normalizedWord FROM wordnet_normalizations
    WHERE word='focus'`).get()).toEqual({ normalizedWord: 'focus' })
})

test('admin invariants preserve tags that must not be singularized', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  await executeDatabaseDomain(database, 'admin.addTagInvariant', { tag: 'status' })
  expect(await executeDatabaseDomain(database, 'admin.tagInvariants', {})).toContain('status')
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'status' })).toBe('status')
  const post = createPost(database, 1, '#status update', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(post.id)).toEqual({ tag: 'status' })

  expect(await executeDatabaseDomain(database, 'admin.removeTagInvariant', { tag: 'status' })).toBeTrue()
  // Once the exception is removed, WordNet still recognizes "status" as a noun.
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'status' })).toBe('status')
})

test('adding an invariant restores existing tags from their authored spelling', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const post = createPost(database, 1, '#atlas', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(post.id)).toEqual({ tag: 'atla' })

  await executeDatabaseDomain(database, 'admin.addTagInvariant', { tag: 'atlas' })

  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(post.id)).toEqual({ tag: 'atlas' })
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'atlas' })).toBe('atlas')
})

test('adding an invariant only reindexes posts that authored that tag', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const affected = createPost(database, 1, '#atlas', null, false)
  const unrelated = createPost(database, 1, '#books', null, false)
  expect('id' in affected && 'id' in unrelated).toBeTrue()
  if (!('id' in affected) || !('id' in unrelated)) throw new Error('Expected test posts to be created')
  database.run('CREATE TABLE hashtag_delete_audit(post_id INTEGER NOT NULL)')
  database.run(`CREATE TRIGGER audit_hashtag_delete AFTER DELETE ON post_hashtags
    BEGIN INSERT INTO hashtag_delete_audit(post_id) VALUES(OLD.post_id); END`)

  await executeDatabaseDomain(database, 'admin.addTagInvariant', { tag: 'atlas' })

  expect(database.query('SELECT DISTINCT post_id FROM hashtag_delete_audit').all()).toEqual([
    { post_id: affected.id },
  ])
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(unrelated.id)).toEqual({ tag: 'book' })
})

test('admin invariants bypass WordNet normalization', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  await executeDatabaseDomain(database, 'admin.addTagInvariant', { tag: 'running' })
  const created = await executeDatabaseDomain(database, 'api.createPost', {
    userId: 1,
    body: '#running',
    parentId: null,
    origin: 'https://example.com',
  })
  expect(created.status).toBe('ready')
  expect(database.query('SELECT tag FROM post_hashtags').all()).toEqual([{ tag: 'running' }])
  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'running' })).toBe('running')
  expect(database.query(`SELECT normalized_word normalizedWord FROM wordnet_normalizations
    WHERE word='running'`).get()).toEqual({ normalizedWord: 'running' })
})

test('adding an invariant restores relationships from a cached WordNet normalization', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()
  database.query("INSERT INTO wordnet_normalizations(word,normalized_word) VALUES('react','antiphonary')").run()
  database.query("INSERT INTO hashtag_follows(user_id,tag) VALUES(1,'antiphonary')").run()

  await executeDatabaseDomain(database, 'admin.addTagInvariant', { tag: 'react' })

  expect(database.query('SELECT tag FROM hashtag_follows').all()).toEqual([{ tag: 'react' }])
})

test('an explicit alias takes precedence over automatic singularization', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const existing = createPost(database, 1, '#JS', null, false)
  expect('id' in existing).toBeTrue()
  if (!('id' in existing)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(existing.id)).toEqual({ tag: 'j' })
  expect(await executeDatabaseDomain(database, 'admin.addTagAliases', {
    primaryTag: 'javascript',
    aliases: ['JS'],
  })).toEqual({ status: 'ready' })

  expect(await executeDatabaseDomain(database, 'tags.resolve', { tag: 'js' })).toBe('javascript')
  expect(database.query('SELECT alias,primary_tag FROM tag_aliases WHERE alias=\'js\'').get()).toEqual({
    alias: 'js',
    primary_tag: 'javascript',
  })
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(existing.id))
    .toEqual({ tag: 'javascript' })
  const createdAfterAlias = createPost(database, 1, '#JS', null, false)
  expect('id' in createdAfterAlias).toBeTrue()
  if (!('id' in createdAfterAlias)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(createdAfterAlias.id))
    .toEqual({ tag: 'javascript' })
})

test('removing an alias only reindexes posts that authored that alias', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()
  await executeDatabaseDomain(database, 'admin.addTagAliases', { primaryTag: 'javascript', aliases: ['JS'] })
  const affected = createPost(database, 1, '#JS', null, false)
  const unrelated = createPost(database, 1, '#books', null, false)
  expect('id' in affected && 'id' in unrelated).toBeTrue()
  if (!('id' in affected) || !('id' in unrelated)) throw new Error('Expected test posts to be created')
  database.run('CREATE TABLE hashtag_delete_audit(post_id INTEGER NOT NULL)')
  database.run(`CREATE TRIGGER audit_hashtag_delete AFTER DELETE ON post_hashtags
    BEGIN INSERT INTO hashtag_delete_audit(post_id) VALUES(OLD.post_id); END`)

  expect(await executeDatabaseDomain(database, 'admin.removeTagAlias', { alias: 'js' })).toBeTrue()

  expect(database.query('SELECT DISTINCT post_id FROM hashtag_delete_audit').all()).toEqual([
    { post_id: affected.id },
  ])
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(affected.id)).toEqual({ tag: 'j' })
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(unrelated.id)).toEqual({ tag: 'book' })
})

test('TreatWarningsAsErrors keeps the complete compound phrase', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.query('INSERT INTO users(handle,email,password) VALUES(\'writer\',\'writer@example.com\',\'x\')').run()

  const post = createPost(database, 1, '#TreatWarningsAsErrors', null, false)
  expect('id' in post).toBeTrue()
  if (!('id' in post)) throw new Error('Expected the test post to be created')
  expect(database.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(post.id))
    .toEqual({ tag: 'treatwarningsaserrors' })
  expect(database.query('SELECT display_name displayName FROM tag_display_names WHERE tag=\'treatwarningsaserrors\'')
    .get()).toEqual({ displayName: 'TreatWarningsAsErrors' })
})
