import type { Database } from 'bun:sqlite'
import { instance } from '../instance.config'

export const SITEMAP_PAGE_SIZE = 10_000

const staticPaths = ['/', '/hot', '/all', '/any', '/explore', '/about', '/contact', '/legal', '/dmca', '/api']

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function publicOrigin(requestUrl: string, appUrl: string | null | undefined = Bun.env.APP_URL) {
  return appUrl ? new URL(appUrl).origin : new URL(requestUrl).origin
}

function xmlResponse(body: string) {
  return new Response(body, { headers: {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
  } })
}

function urlSet(origin: string, paths: string[]) {
  const urls = paths.map(path => `  <url><loc>${xml(origin + path)}</loc></url>`).join('\n')
  return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}${urls ? '\n' : ''}</urlset>
`)
}

function count(database: Database, sql: string) {
  return (database.query(sql).get() as { count: number }).count
}

export function sitemapIndex(database: Database, requestUrl: string, appUrl?: string | null) {
  const origin = publicOrigin(requestUrl, appUrl)
  const sections = [
    ['users', count(database, 'SELECT count(*) count FROM users WHERE deleted_at IS NULL')],
    ['posts', count(database, `SELECT count(*) count FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL`)],
    ['tags', count(database, `SELECT count(DISTINCT ph.tag) count FROM post_hashtags ph
      JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL`)],
  ] as const
  const locations = [`${origin}/sitemaps/static.xml`]
  for (const [kind, total] of sections) {
    for (let page = 1; page <= Math.ceil(total / SITEMAP_PAGE_SIZE); page++) {
      locations.push(`${origin}/sitemaps/${kind}-${page}.xml`)
    }
  }
  const sitemaps = locations.map(location => `  <sitemap><loc>${xml(location)}</loc></sitemap>`).join('\n')
  return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>
`)
}

export function sitemapSection(database: Database, requestUrl: string, file: string, appUrl?: string | null) {
  const origin = publicOrigin(requestUrl, appUrl)
  if (file === 'static.xml') return urlSet(origin, staticPaths)
  const match = file.match(/^(users|posts|tags)-([1-9]\d*)\.xml$/)
  if (!match) return null
  const kind = match[1] as 'users' | 'posts' | 'tags'
  const page = Number(match[2])
  const offset = (page - 1) * SITEMAP_PAGE_SIZE
  let paths: string[]
  if (kind === 'users') {
    const rows = database.query(`SELECT handle FROM users WHERE deleted_at IS NULL
      ORDER BY id LIMIT ? OFFSET ?`).all(SITEMAP_PAGE_SIZE, offset) as { handle: string }[]
    paths = rows.map(row => `/u/${encodeURIComponent(row.handle.toLowerCase())}`)
  }
  else if (kind === 'posts') {
    const rows = database.query(`SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY p.id LIMIT ? OFFSET ?`)
      .all(SITEMAP_PAGE_SIZE, offset) as { id: number }[]
    paths = rows.map(row => `/post/${row.id}`)
  }
  else {
    const rows = database.query(`SELECT ph.tag FROM post_hashtags ph
      JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL GROUP BY ph.tag ORDER BY ph.tag LIMIT ? OFFSET ?`)
      .all(SITEMAP_PAGE_SIZE, offset) as { tag: string }[]
    paths = rows.map(row => `/tag/${encodeURIComponent(row.tag)}`)
  }
  return paths.length ? urlSet(origin, paths) : null
}

export function robots(requestUrl: string) {
  const origin = publicOrigin(requestUrl)
  return new Response(`User-agent: *
Allow: /
Disallow: /account/
Disallow: /activity
Disallow: /admin
Disallow: /api/
Disallow: /compose
Disallow: /enter
Disallow: /choose-handle
Disallow: /verify-email
Disallow: /write

Sitemap: ${origin}/sitemap.xml
`, { headers: {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  } })
}

export function securityTxt(requestUrl: string, now = new Date()) {
  const origin = publicOrigin(requestUrl)
  const expires = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString()
  const contacts = [
    instance.operator.email ? `Contact: mailto:${instance.operator.email}` : null,
    `Contact: ${origin}/contact`,
  ].filter(Boolean)
  return new Response(`${contacts.join('\n')}
Expires: ${expires}
Canonical: ${origin}/.well-known/security.txt
Preferred-Languages: en
`, { headers: {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=86400',
  } })
}
