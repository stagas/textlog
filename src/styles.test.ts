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

  test('highlights a post opened through its stable anchor', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post:target {')
    expect(css).toContain('background: rgb(128 128 128 / 25%);')
    expect(css).toContain('animation: post-target-fade 3s ease-in forwards;')
    expect(css).toContain('@keyframes post-target-fade {')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {')
    expect(css).not.toContain('box-shadow: inset 3px 0 var(--accent);')
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

  test('keeps secondary danger actions destructive', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.secondary-action.danger {')
    expect(css).toContain('.secondary-action.danger:hover {')
  })

  test('styles span-only preview metadata like links', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.reply-preview .preview-reply {\n  color: var(--accent);\n  cursor: pointer;')
    expect(css).toContain('.reply-preview .preview-reply:hover {\n  color: var(--accent-dark);')
  })

  test('keeps the edit cancel action muted', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.secondary-action.edit-post-cancel {\n  color: var(--muted);')
    expect(css).toContain('.secondary-action.edit-post-cancel:hover {\n  color: var(--tab-hover);')
  })

  test('lets notification settings use the full page width', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.notifications-page {\n  max-width: none;\n}')
  })

  test('uses shared component utilities for repeated visual patterns', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.pagination-top {\n  border-top: 0;\n}')
    expect(css).toContain('.status-message {')
    expect(css).toContain('.status-error {')
    expect(css).toContain('.status-success {')
    expect(css).toContain('.unread-dot {')
    expect(css).toContain('.for-you-item .posttop .unread-dot {\n  margin-right: calc(1ch - var(--space-4));')
    expect(css).toContain('.activity-follow-main .unread-dot {\n  margin-right: calc(1ch - var(--space-2));')
    expect(css).toContain('.secondary-action {')
    expect(css).toContain('.secondary-action {\n  padding: 0;\n  color: var(--accent);')
    expect(css).toContain('.form-control {')
    expect(css).toContain('.form-label {')
    expect(css).toContain('.form-panel {')
    expect(css).toContain('.form-panel .form-control {\n  background: var(--bg);')
    expect(css).toContain('.illegal-activity-page {\n  max-width: none;')
    expect(css).toContain('.button-danger {')
    expect(css).toContain('.button-wide {')
    expect(css).toContain('gap: var(--space-2);')
    expect(css).toContain('.button.button-muted {')
    expect(css).toContain('.form-select {')
    expect(css).toContain('.form-checkbox {')
    expect(css).not.toContain('.unfollow-button')
    expect(css).not.toContain('.auth-panel .button {\n  min-height: 48px;\n  justify-content: space-between;')
    expect(css).toContain('flex-wrap: wrap;')
    expect(css).not.toContain('.activity-item-unread-dot')
    expect(css).not.toContain('.sr-only')
  })
})
