import type { Hono } from 'hono'

const VOCAROO_ID = /^[a-z0-9]+$/i
const UPSTREAM_TIMEOUT_MS = 15_000
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function registerMediaRoutes(app: Hono, fetcher: Fetcher = fetch) {
  app.on(['GET', 'HEAD'], '/media/vocaroo/:id', async c => {
    const id = c.req.param('id')
    if (!VOCAROO_ID.test(id)) return c.text('Not found', 404)

    const headers = new Headers({
      accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1',
      referer: 'https://vocaroo.com/',
      'user-agent': 'Mozilla/5.0 (compatible; textlog-vocaroo-proxy/1.0)',
    })
    const range = c.req.header('range')
    if (range) headers.set('range', range)

    try {
      const upstream = await fetcher(`https://media1.vocaroo.com/mp3/${id}`, {
        method: c.req.method,
        headers,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      const responseHeaders = new Headers()
      for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name)
        if (value) responseHeaders.set(name, value)
      }
      responseHeaders.set('cache-control', 'public, max-age=86400')
      return new Response(c.req.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      })
    }
    catch {
      return c.text('Audio unavailable', 502)
    }
  })
}
