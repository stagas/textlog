import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { rebuildHotPosts } from './hot'
import { registerSyndicationRoutes } from './routes/syndication'

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
    INSERT INTO users VALUES(1,'Alice',NULL),(2,'Bob',NULL),(3,'Gone','2026-08-03 00:00:00');
    INSERT INTO handle_history VALUES('oldalice',1);
    INSERT INTO posts VALUES
      (1,1,NULL,'hello & <friends> #textlog','2026-08-03 10:00:00',NULL),
      (2,2,1,'a reply','2026-08-03 11:00:00',NULL),
      (3,1,NULL,'deleted','2026-08-03 12:00:00','2026-08-03 13:00:00'),
      (4,3,NULL,'gone author','2026-08-03 14:00:00',NULL);
    INSERT INTO post_hashtags VALUES(1,'textlog');
    INSERT INTO post_hot SELECT id,0,created_at,created_at FROM posts;
  `)
  rebuildHotPosts(database)
  const app = new Hono()
  registerSyndicationRoutes(app, database, null)
  app.get('/u/:handle', c => c.text(`profile ${c.req.param('handle')}`))
  app.get('/tag/:tag', c => c.text(`tag ${c.req.param('tag')}`))
  return app
}

describe('RSS and Atom feeds', () => {
  test('serves latest RSS as escaped, public XML', async () => {
    const response = await fixture().request('https://textlog.cc/latest.rss')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toContain('max-age=60')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain('<atom:link href="https://textlog.cc/latest.rss" rel="self"')
    expect(body).toContain('hello &amp; &lt;friends&gt; #textlog')
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

  test('filters user and hashtag feeds and redirects historical handles', async () => {
    const app = fixture()
    const user = await (await app.request('https://textlog.cc/u/Alice.atom')).text()
    const tag = await (await app.request('https://textlog.cc/tag/TEXTLOG.rss')).text()
    const alias = await app.request('https://textlog.cc/u/oldalice.rss')

    expect(user).toContain('hello &amp; &lt;friends&gt; #textlog')
    expect(user).not.toContain('a reply')
    expect(tag).toContain('hello &amp; &lt;friends&gt; #textlog')
    expect(tag).not.toContain('a reply')
    expect(alias.status).toBe(301)
    expect(alias.headers.get('location')).toBe('/u/Alice.rss')
  })

  test('exposes the same feed formats on API collection URLs', async () => {
    const app = fixture()
    const latest = await app.request('https://textlog.cc/api/v1/feeds/latest.atom')
    const user = await app.request('https://textlog.cc/api/v1/users/Alice/posts.rss')
    const tag = await app.request('https://textlog.cc/api/v1/tags/textlog/posts.atom')

    expect(latest.status).toBe(200)
    expect(latest.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
    expect(await latest.text()).toContain('<id>https://textlog.cc/api/v1/feeds/latest.atom</id>')
    expect(await user.text()).toContain('https://textlog.cc/api/v1/users/Alice/posts.rss')
    expect(await tag.text()).toContain('https://textlog.cc/api/v1/tags/textlog/posts.atom')
  })

  test('passes ordinary user and hashtag pages through to their HTML routes', async () => {
    const app = fixture()
    expect(await (await app.request('https://textlog.cc/u/Alice')).text()).toBe('profile Alice')
    expect(await (await app.request('https://textlog.cc/tag/textlog')).text()).toBe('tag textlog')
  })
})
