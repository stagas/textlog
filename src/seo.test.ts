import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { robots, sitemapIndex, sitemapSection } from './seo'

const previousAppUrl = Bun.env.APP_URL
afterEach(() => {
  if (previousAppUrl === undefined) delete Bun.env.APP_URL
  else Bun.env.APP_URL = previousAppUrl
})

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,deleted_at TEXT);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    INSERT INTO users VALUES(1,'Alice',NULL),(2,'Gone','2026-08-03 00:00:00');
    INSERT INTO posts VALUES(10,1,NULL),(11,1,'2026-08-03 00:00:00'),(12,2,NULL);
    INSERT INTO post_hashtags VALUES(10,'root'),(11,'deleted'),(12,'gone');
  `)
  return database
}

describe('crawler metadata', () => {
  test('publishes a robots policy and absolute sitemap location', async () => {
    Bun.env.APP_URL = 'https://root.mx'
    const response = robots('http://internal:3000/robots.txt')
    const body = await response.text()
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(body).toContain('User-agent: *\nAllow: /')
    expect(body).toContain('Disallow: /account/')
    expect(body).toContain('Sitemap: https://root.mx/sitemap.xml')
  })

  test('indexes static and populated segmented sitemaps', async () => {
    const response = sitemapIndex(fixture(), 'https://root.mx/sitemap.xml')
    const body = await response.text()
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(body).toContain('<loc>https://root.mx/sitemaps/static.xml</loc>')
    expect(body).toContain('<loc>https://root.mx/sitemaps/users-1.xml</loc>')
    expect(body).toContain('<loc>https://root.mx/sitemaps/posts-1.xml</loc>')
    expect(body).toContain('<loc>https://root.mx/sitemaps/tags-1.xml</loc>')
  })

  test('only exposes active public profiles, posts, and tags', async () => {
    const database = fixture()
    const users = await sitemapSection(database, 'https://root.mx/sitemaps/users-1.xml', 'users-1.xml')!.text()
    const posts = await sitemapSection(database, 'https://root.mx/sitemaps/posts-1.xml', 'posts-1.xml')!.text()
    const tags = await sitemapSection(database, 'https://root.mx/sitemaps/tags-1.xml', 'tags-1.xml')!.text()
    expect(users).toContain('<loc>https://root.mx/u/alice</loc>')
    expect(users).not.toContain('gone')
    expect(posts).toContain('<loc>https://root.mx/post/10</loc>')
    expect(posts).not.toContain('/post/11')
    expect(posts).not.toContain('/post/12')
    expect(tags).toContain('<loc>https://root.mx/tag/root</loc>')
    expect(tags).not.toContain('deleted')
    expect(tags).not.toContain('gone')
    expect(sitemapSection(database, 'https://root.mx/sitemaps/users-2.xml', 'users-2.xml')).toBeNull()
  })
})
