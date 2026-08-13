import type { Hono } from 'hono'
import { db } from '../db'
import { robots, securityTxt, sitemapIndex, sitemapSection } from '../seo'

export function registerSeoRoutes(app: Hono) {
  app.get('/robots.txt', c => robots(c.req.url))
  app.get('/security.txt', c => securityTxt(c.req.url))
  app.get('/.well-known/security.txt', c => securityTxt(c.req.url))
  app.get('/sitemap.xml', c => sitemapIndex(db, c.req.url))
  app.get('/sitemaps/:file', c => sitemapSection(db, c.req.url, c.req.param('file')) || c.text('Not found', 404))
}
