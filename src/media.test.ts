import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { registerMediaRoutes } from './routes/media'

test('proxies Vocaroo audio and forwards byte ranges', async () => {
  let upstreamUrl = ''
  let upstreamInit: RequestInit | undefined
  const app = new Hono()
  registerMediaRoutes(app, async (url: string | URL | Request, init?: RequestInit) => {
    upstreamUrl = String(url)
    upstreamInit = init
    return new Response('audio bytes', {
      status: 206,
      headers: {
        'content-type': 'audio/mpeg',
        'content-range': 'bytes 10-20/100',
        'accept-ranges': 'bytes',
      },
    })
  })

  const response = await app.request('/media/vocaroo/140JOkFnkmRv', { headers: { range: 'bytes=10-20' } })
  expect(upstreamUrl).toBe('https://media1.vocaroo.com/mp3/140JOkFnkmRv')
  expect(new Headers(upstreamInit?.headers).get('range')).toBe('bytes=10-20')
  expect(response.status).toBe(206)
  expect(response.headers.get('content-type')).toBe('audio/mpeg')
  expect(response.headers.get('content-range')).toBe('bytes 10-20/100')
  expect(await response.text()).toBe('audio bytes')
})

test('rejects invalid Vocaroo recording IDs without fetching', async () => {
  let fetched = false
  const app = new Hono()
  registerMediaRoutes(app, async () => {
    fetched = true
    return new Response()
  })

  expect((await app.request('/media/vocaroo/not.valid')).status).toBe(404)
  expect(fetched).toBe(false)
})
