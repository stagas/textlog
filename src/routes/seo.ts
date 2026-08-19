import type { Hono } from 'hono'
import { databaseService } from '../database-service'
import { robots, securityTxt } from '../seo'

function response(value: { status: number; headers: [string, string][]; body: string }) {
  return new Response(value.body, { status: value.status, headers: value.headers })
}

export function registerSeoRoutes(app: Hono) {
  app.get('/robots.txt', c => robots(c.req.url))
  app.get('/security.txt', c => securityTxt(c.req.url))
  app.get('/.well-known/security.txt', c => securityTxt(c.req.url))
  app.get('/sitemap.xml', async c =>
    response(
      await databaseService().call('seo.sitemapIndex', { requestUrl: c.req.url, appUrl: Bun.env.APP_URL }),
    ))
  app.get('/sitemaps/:file', async c => {
    const value = await databaseService().call('seo.sitemapSection', {
      requestUrl: c.req.url,
      file: c.req.param('file'),
      appUrl: Bun.env.APP_URL,
    })
    return value ? response(value) : c.text('Not found', 404)
  })
}
