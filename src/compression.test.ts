import { describe, expect, test } from 'bun:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { compressResponse } from './compression'

const text = 'normal response content '.repeat(100)

describe('response compression', () => {
  test('prefers Brotli and preserves the response', async () => {
    const response = await compressResponse(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip, br' } }),
      new Response(text, { headers: { 'content-type': 'text/html', etag: '"page"', 'set-cookie': 'textlog=token' } }),
    )
    expect(response.headers.get('content-encoding')).toBe('br')
    expect(response.headers.get('vary')).toContain('Accept-Encoding')
    expect(response.headers.get('etag')).toBe('W/"page"')
    expect(response.headers.get('set-cookie')).toBe('textlog=token')
    expect(brotliDecompressSync(await response.arrayBuffer()).toString()).toBe(text)
  })

  test('falls back to gzip', async () => {
    const response = await compressResponse(
      new Request('http://localhost', { headers: { 'accept-encoding': 'gzip' } }),
      new Response(text, { headers: { 'content-type': 'application/json' } }),
    )
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(gunzipSync(await response.arrayBuffer()).toString()).toBe(text)
  })

  test('skips small and already encoded responses', async () => {
    const request = new Request('http://localhost', { headers: { 'accept-encoding': 'br' } })
    const small = await compressResponse(request, new Response('small', { headers: { 'content-type': 'text/plain' } }))
    expect(small.headers.has('content-encoding')).toBe(false)

    const encoded = await compressResponse(request, new Response(text, {
      headers: { 'content-type': 'text/css', 'content-encoding': 'gzip' },
    }))
    expect(encoded.headers.get('content-encoding')).toBe('gzip')
  })
})
