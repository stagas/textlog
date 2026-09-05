import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { executeDatabaseDomain } from './database-domain'
import type { DatabaseService } from './database-service'
import { issueFeedKey } from './feed-keys'
import { rebuildHotPosts } from './hot'
import { registerSyndicationRoutes } from './routes/syndication'
import { syndicationResponse } from './syndication'

function fixture(firstPostBody?: string) {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',bio TEXT NOT NULL DEFAULT '',
      deleted_at TEXT,suspended_at TEXT,email_verified_at TEXT,handle_chosen_at TEXT,
      timezone TEXT,show_link_previews INTEGER);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,reply_count INTEGER NOT NULL DEFAULT 0,
      activity_count INTEGER NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
    CREATE TABLE feed_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,last_used_at INTEGER);
    CREATE TABLE follows (follower_id INTEGER,following_id INTEGER,created_at TEXT);
    CREATE TABLE hashtag_follows (user_id INTEGER,tag TEXT,created_at TEXT);
    CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
    CREATE TABLE blocked_hashtags (user_id INTEGER,tag TEXT);
    CREATE TABLE post_mentions (post_id INTEGER,user_id INTEGER);
    CREATE TABLE for_you_reads (user_id INTEGER,event_key TEXT);
    INSERT INTO users(id,handle,email,bio,deleted_at) VALUES
      (1,'Alice','alice@example.com','',NULL),(2,'Bob','bob@example.com','',NULL),
      (3,'Gone','gone@example.com','','2026-08-03 00:00:00'),(4,'Reader','reader@example.com','',NULL);
    INSERT INTO follows VALUES(4,1,'2026-08-01 00:00:00');
    INSERT INTO follows VALUES(1,2,'2026-08-03 09:00:00');
    INSERT INTO hashtag_follows VALUES(4,'note','2026-08-01 00:00:00');
    INSERT INTO handle_history VALUES('oldalice',1);
    INSERT INTO posts VALUES
      (1,1,NULL,'hello & <friends> #notes','2026-08-03 10:00:00',NULL),
      (2,2,1,'a reply','2026-08-03 11:00:00',NULL),
      (3,1,NULL,'deleted','2026-08-03 12:00:00','2026-08-03 13:00:00'),
      (4,3,NULL,'gone author','2026-08-03 14:00:00',NULL);
    INSERT INTO post_hashtags VALUES(1,'note');
    INSERT INTO post_hot SELECT id,0,0,0,created_at,created_at FROM posts;
  `)
  if (firstPostBody !== undefined) database.query('UPDATE posts SET body=? WHERE id=1').run(firstPostBody)
  rebuildHotPosts(database)
  database.query(`UPDATE post_hot SET score_updated_at=CURRENT_TIMESTAMP,
    latest_activity_at=CURRENT_TIMESTAMP WHERE post_id=1`).run()
  const app = new Hono()
  const service: DatabaseService = { call: (operation, input) => executeDatabaseDomain(database, operation, input) }
  registerSyndicationRoutes(app, service, null)
  app.get('/u/:handle', c => c.text(`profile ${c.req.param('handle')}`))
  app.get('/tag/:tag', c => c.text(`tag ${c.req.param('tag')}`))
  ;(app as any).database = database
  return app
}

describe('RSS and Atom feeds', () => {
  test('renders follow and signup activity as stable syndication entries', async () => {
    const response = syndicationResponse('atom', {
      title: 'For You',
      description: 'Personalized activity',
      pageUrl: 'https://textlog.cc/for-you',
      feedUrl: 'https://textlog.cc/feeds/for-you/key.atom',
      posts: [],
      activities: [{
        id: 'https://textlog.cc/activities/follow-1',
        title: '@alice followed @bob',
        url: 'https://textlog.cc/u/bob',
        created_at: '2026-08-03T09:00:00.000Z',
        author: { handle: 'alice', url: 'https://textlog.cc/u/alice' },
      }, {
        id: 'https://textlog.cc/activities/signup-2',
        title: '@carol signed up',
        url: 'https://textlog.cc/u/carol',
        created_at: '2026-08-03T10:00:00.000Z',
        author: { handle: 'carol', url: 'https://textlog.cc/u/carol' },
      }],
    })
    const body = await response.text()
    expect(body).toContain('<title>@alice followed @bob</title>')
    expect(body).toContain('<title>@carol signed up</title>')
    expect(body).toContain('<updated>2026-08-03T10:00:00.000Z</updated>')
  })

  test('serves latest RSS as escaped, public XML', async () => {
    const response = await fixture().request('https://textlog.cc/latest.rss')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toContain('max-age=60')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain('<atom:link href="https://textlog.cc/latest.rss" rel="self"')
    expect(body).toContain('hello &amp; &lt;friends&gt; #notes')
    expect(body).toContain('https://textlog.cc/post/2')
    expect(body).not.toContain('deleted')
    expect(body).not.toContain('gone author')
  })

  test('serves hot Atom with stable entry IDs and author URLs', async () => {
    const response = await fixture().request('https://textlog.cc/hot.atom')
    const body = await response.text()

    expect(response.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
    expect(body).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(body).toContain('<id>https://textlog.cc/hot.atom</id>')
    expect(body).toContain('<id>https://textlog.cc/post/1</id>')
    expect(body).toContain('<uri>https://textlog.cc/u/alice</uri>')
  })

  test('renders Markdown as sanitized HTML in RSS and Atom entries', async () => {
    const app = fixture('**bold** [safe](https://example.com) [host](news.ycombinator.com) [local](/post/1) '
      + '[unsafe](javascript:alert(1)) <script>alert(2)</script>')
    const rss = await (await app.request('https://textlog.cc/latest.rss')).text()
    const atom = await (await app.request('https://textlog.cc/latest.atom')).text()

    expect(rss).toContain('&lt;strong&gt;bold&lt;/strong&gt;')
    expect(rss).toContain('&lt;a href=&quot;https://example.com&quot;&gt;safe&lt;/a&gt;')
    expect(rss).toContain('&lt;a href=&quot;https://news.ycombinator.com&quot;&gt;host&lt;/a&gt;')
    expect(atom).toContain('&lt;a href=&quot;https://news.ycombinator.com&quot;&gt;host&lt;/a&gt;')
    expect(rss).toContain('&lt;a href=&quot;https://textlog.cc/post/1&quot;&gt;local&lt;/a&gt;')
    expect(atom).toContain('&lt;a href=&quot;https://textlog.cc/post/1&quot;&gt;local&lt;/a&gt;')
    expect(rss).toContain('<title>@alice: bold safe host local unsafe</title>')
    expect(atom).toContain('<title>@alice: bold safe host local unsafe</title>')
    expect(atom).toContain('<content type="html">&lt;p&gt;&lt;strong&gt;bold&lt;/strong&gt;')
    expect(rss).not.toContain('href=&quot;javascript:')
    expect(atom).not.toContain('<script')
  })

  test('keeps Markdown image links visible in RSS and Atom entries', async () => {
    const imageLink = '![https://ibb.co/WpfV1DbH](https://ibb.co/WpfV1DbH)'
    const app = fixture(imageLink)
    const rss = await (await app.request('https://textlog.cc/latest.rss')).text()
    const atom = await (await app.request('https://textlog.cc/latest.atom')).text()
    const link = '&lt;a href=&quot;https://ibb.co/WpfV1DbH&quot;&gt;https://ibb.co/WpfV1DbH&lt;/a&gt;'

    expect(rss).toContain(link)
    expect(atom).toContain(link)
  })

  test('does not resolve quote-tainted feed links relative to profile URLs', async () => {
    const imageUrl = 'https://cf-og.textlog.cc/images/b02499ef-7697-44de-b66a-63b9e6dc2c4f.png'
    const app = fixture(`![image](${imageUrl}\\" ) [query](https://example.com/image?a=1&b=2)`)
    const atom = await (await app.request('https://textlog.cc/u/Alice.atom')).text()

    expect(atom).not.toContain(`${imageUrl}&amp;quot;`)
    expect(atom).not.toContain(`/u/${imageUrl}`)
    expect(atom).toContain('&lt;a &gt;image&lt;/a&gt;')
    expect(atom).toContain('href=&quot;https://example.com/image?a=1&amp;amp;b=2&quot;')
  })

  test('filters user and hashtag feeds and redirects historical handles', async () => {
    const app = fixture()
    const user = await (await app.request('https://textlog.cc/u/Alice.atom')).text()
    const tag = await (await app.request('https://textlog.cc/tag/NOTES.rss')).text()
    const alias = await app.request('https://textlog.cc/u/oldalice.rss')

    expect(user).toContain('hello &amp; &lt;friends&gt; #notes')
    expect(user).toContain('<title>hello &amp; &lt;friends&gt; #notes</title>')
    expect(user).not.toContain('<title>@alice:')
    expect(user).not.toContain('a reply')
    expect(tag).toContain('hello &amp; &lt;friends&gt; #notes')
    expect(tag).not.toContain('a reply')
    const bot = await (await app.request('https://textlog.cc/u/Bob.atom')).text()
    expect(bot).not.toContain('a reply')
    expect(alias.status).toBe(301)
    expect(alias.headers.get('location')).toBe('/u/Alice.rss')
  })

  test('exposes the same feed formats on API collection URLs', async () => {
    const app = fixture()
    const latest = await app.request('https://textlog.cc/api/v1/feeds/latest.atom')
    const newest = await app.request('https://textlog.cc/api/v1/feeds/new.rss')
    const user = await app.request('https://textlog.cc/api/v1/users/Alice/posts.rss')
    const tag = await app.request('https://textlog.cc/api/v1/tags/textlog/posts.atom')

    expect(latest.status).toBe(200)
    expect(latest.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
    expect(await latest.text()).toContain('<id>https://textlog.cc/api/v1/feeds/latest.atom</id>')
    expect(await newest.text()).toContain('https://textlog.cc/api/v1/feeds/new.rss')
    expect(await user.text()).toContain('https://textlog.cc/api/v1/users/Alice/posts.rss')
    expect(await tag.text()).toContain('https://textlog.cc/api/v1/tags/textlog/posts.atom')
  })

  test('loads the same latest and hot posts for JSON, RSS, and Atom', async () => {
    const app = fixture()
    const database = (app as any).database as Database
    for (const kind of ['latest', 'new', 'hot'] as const) {
      const syndication = await executeDatabaseDomain(database, 'syndication.load', {
        kind,
        origin: 'https://textlog.cc',
      })
      const api = kind === 'latest' || kind === 'new'
        ? await executeDatabaseDomain(database, 'api.publicRead', {
          kind: 'collection',
          origin: 'https://textlog.cc',
          limit: 20,
          before: null,
          ...(kind === 'latest' ? { excludeWhispers: true } : { topLevelOnly: true }),
        })
        : await executeDatabaseDomain(database, 'api.publicRead', {
          kind: 'hot',
          origin: 'https://textlog.cc',
          limit: 20,
          cursor: null,
        })

      expect(syndication.status).toBe('ready')
      expect(api.status).toBe('ready')
      if (syndication.status === 'ready' && api.status === 'ready') {
        const apiPosts = (api.value as { data: Array<{ id: number }> }).data
        expect(syndication.posts.map(post => post.id)).toEqual(apiPosts.map(post => post.id))
      }
    }
  })

  test('keeps user syndication aligned with the top-level API post collection', async () => {
    const app = fixture()
    const database = (app as any).database as Database
    const syndication = await executeDatabaseDomain(database, 'syndication.load', {
      kind: 'user',
      origin: 'https://textlog.cc',
      identifier: 'Bob',
    })
    const api = await executeDatabaseDomain(database, 'api.publicRead', {
      kind: 'collection',
      origin: 'https://textlog.cc',
      limit: 20,
      before: null,
      handle: 'Bob',
      topLevelOnly: true,
    })
    const feed = await (await app.request('https://textlog.cc/api/v1/users/Bob/posts.atom')).text()

    expect(syndication.status).toBe('ready')
    expect(api.status).toBe('ready')
    if (syndication.status === 'ready' && api.status === 'ready') {
      const apiPosts = (api.value as { data: Array<{ id: number }> }).data
      expect(syndication.posts.map(post => post.id)).toEqual(apiPosts.map(post => post.id))
    }
    expect(feed).not.toContain('a reply')
    expect(feed).not.toContain('https://textlog.cc/post/2')
  })

  test('passes ordinary user and hashtag pages through to their HTML routes', async () => {
    const app = fixture()
    expect(await (await app.request('https://textlog.cc/u/Alice')).text()).toBe('profile Alice')
    expect(await (await app.request('https://textlog.cc/tag/textlog')).text()).toBe('tag textlog')
  })

  test('serves retained personalized keys privately and invalidates only revoked keys', async () => {
    const app = fixture()
    const database = (app as any).database as Database
    const first = issueFeedKey(database, 4, 'first', null)
    const rss = await app.request(`https://textlog.cc/feeds/my-feed/${first.value}.rss`)
    expect(rss.status).toBe(200)
    expect(rss.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(rss.headers.get('pragma')).toBe('no-cache')
    expect(rss.headers.get('access-control-allow-origin')).toBe('*')
    expect(await rss.text()).toContain('<title>My Feed on textlog</title>')

    const second = issueFeedKey(database, 4, 'second', null)
    expect((await app.request(`https://textlog.cc/feeds/for-you/${first.value}.rss`)).status).toBe(200)
    database.query('DELETE FROM feed_keys WHERE id=?').run(first.id)
    expect((await app.request(`https://textlog.cc/feeds/for-you/${first.value}.rss`)).status).toBe(404)
    const atom = await app.request(`https://textlog.cc/feeds/for-you/${second.value}.atom`)
    expect(atom.status).toBe(200)
    expect(atom.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
  })
})
