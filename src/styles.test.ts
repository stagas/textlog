import { describe, expect, test } from 'bun:test'
import { loadStylesAsset, preferredStylesEncoding, stylesResponse } from './styles'

describe('in-memory stylesheet', () => {
  test('negotiates the best supported encoding', () => {
    expect(preferredStylesEncoding('gzip, br')).toBe('br')
    expect(preferredStylesEncoding('br;q=0, gzip;q=0.8')).toBe('gzip')
    expect(preferredStylesEncoding(null)).toBe('identity')
  })

  test('minifies and precompresses the stylesheet', async () => {
    const asset = await loadStylesAsset(new URL('./styles.css', import.meta.url).pathname)
    expect(asset.bodies.identity.byteLength).toBeGreaterThan(0)
    expect(asset.bodies.br.byteLength).toBeLessThan(asset.bodies.identity.byteLength)

    const response = stylesResponse(asset, new Request('http://localhost/styles.css', {
      headers: { 'accept-encoding': 'br' },
    }))
    expect(response.headers.get('content-encoding')).toBe('br')
    expect(response.headers.get('vary')).toBe('Accept-Encoding')
  })

  test('uses the in-memory etag for revalidation', async () => {
    const asset = await loadStylesAsset(new URL('./styles.css', import.meta.url).pathname)
    const response = stylesResponse(asset, new Request('http://localhost/styles.css', {
      headers: { 'if-none-match': asset.etag },
    }))
    expect(response.status).toBe(304)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('disables caching and revalidation in development', async () => {
    const asset = await loadStylesAsset(new URL('./styles.css', import.meta.url).pathname)
    const response = stylesResponse(asset, new Request('http://localhost/styles.css', {
      headers: { 'if-none-match': asset.etag },
    }), false)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBeNull()
  })

  test('keeps the quoted-post hit area out of the generic inner-link positioning rule', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.tappable-post a:not(.post-hit-area):not(.parent-hit-area)')
    expect(css).toContain('.tappable-post .parent-hit-area {\n    position: absolute;')
  })

  test('uses the active accent for the mobile tap highlight', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('--tap-highlight: color-mix(in srgb, var(--accent) 24%, transparent);')
    expect(css).toContain('-webkit-tap-highlight-color: var(--tap-highlight);')
  })

  test('keeps inactive notification actions hidden despite button display styles', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.notification-actions [hidden] { display: none; }')
  })
})
