import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { robots, securityTxt, sitemapIndex, sitemapSection } from './seo'

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    INSERT INTO users VALUES(1,'Alice',NULL),(2,'Gone','2026-08-03 00:00:00');
    INSERT INTO posts VALUES(10,1,NULL),(11,1,'2026-08-03 00:00:00'),(12,2,NULL);
    INSERT INTO post_hashtags VALUES(10,'textlog'),(11,'deleted'),(12,'gone');
  `)
  return database
}

describe('crawler metadata', () => {
  test('publishes a robots policy and absolute sitemap location', async () => {
    Bun.env.APP_URL = 'https://textlog.cc'
    const response = robots('http://internal:3000/robots.txt')
    const body = await response.text()
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(body).toContain('User-agent: *\nAllow: /')
    expect(body).toContain('Disallow: /account/')
    expect(body).toContain('Sitemap: https://textlog.cc/sitemap.xml')
  })

  test('publishes security contacts at the canonical well-known location', async () => {
    Bun.env.APP_URL = 'https://textlog.cc'
    const response = securityTxt(
      'http://internal:3000/security.txt',
      new Date('2026-08-13T00:00:00.000Z'),
    )
    const body = await response.text()
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(body).toContain('Contact: mailto:hello@textlog.cc')
    expect(body).toContain('Contact: https://textlog.cc/contact')
    expect(body).toContain('Expires: 2027-02-09T00:00:00.000Z')
    expect(body).toContain('Canonical: https://textlog.cc/.well-known/security.txt')
    expect(body).toContain('Preferred-Languages: en')
  })

  test('indexes static and populated segmented sitemaps', async () => {
    const response = sitemapIndex(fixture(), 'https://textlog.cc/sitemap.xml', null)
    const body = await response.text()
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(body).toContain('<loc>https://textlog.cc/sitemaps/static.xml</loc>')
    expect(body).toContain('<loc>https://textlog.cc/sitemaps/users-1.xml</loc>')
    expect(body).toContain('<loc>https://textlog.cc/sitemaps/posts-1.xml</loc>')
    expect(body).toContain('<loc>https://textlog.cc/sitemaps/tags-1.xml</loc>')
  })

  test('only exposes active public profiles, posts, and tags', async () => {
    const database = fixture()
    const users = await sitemapSection(database, 'https://textlog.cc/sitemaps/users-1.xml', 'users-1.xml', null)!.text()
    const posts = await sitemapSection(database, 'https://textlog.cc/sitemaps/posts-1.xml', 'posts-1.xml', null)!.text()
    const tags = await sitemapSection(database, 'https://textlog.cc/sitemaps/tags-1.xml', 'tags-1.xml', null)!.text()
    expect(users).toContain('<loc>https://textlog.cc/u/alice</loc>')
    expect(users).not.toContain('gone')
    expect(posts).toContain('<loc>https://textlog.cc/post/10</loc>')
    expect(posts).not.toContain('/post/11')
    expect(posts).not.toContain('/post/12')
    expect(tags).toContain('<loc>https://textlog.cc/tag/textlog</loc>')
    expect(tags).not.toContain('deleted')
    expect(tags).not.toContain('gone')
    expect(sitemapSection(database, 'https://textlog.cc/sitemaps/users-2.xml', 'users-2.xml', null)).toBeNull()
  })
})
