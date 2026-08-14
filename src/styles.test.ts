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

  test('highlights a post or activity entry opened through its stable anchor', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post:target,\n.activity-follow:target {')
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

  test('styles conversation top links like reply actions', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.posttop .post-reply-link,\n.posttop .post-top-link {\n  color: var(--accent);')
    expect(css).toContain(
      '.posttop .post-reply-link:hover,\n.posttop .post-top-link:hover {\n  color: var(--accent-dark);',
    )
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

  test('lets the account switcher use the full page width', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.account-switcher-page {\n  max-width: none;')
  })

  test('defines compact and relaxed global density scales', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('body.density-compact {')
    expect(css).toContain('--space-7: 36px;')
    expect(css).toContain('body.density-relaxed {')
    expect(css).toContain('--space-7: 60px;')
    expect(css).toContain('body.density-compact :where(p, li, textarea):not(.ascii-art)')
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

  test('ellipsizes activity reference links instead of overlapping metadata', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.activity-follow-main a {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}')
    expect(css).toContain('.posttop > .reference-menu > .reference-menu-trigger,\n'
      + '.parent-quote-top > .reference-menu > .reference-menu-trigger,\n'
      + '.activity-follow-main > .reference-menu > .reference-menu-trigger,\n'
      + '.feed-relationship-main > .reference-menu > .reference-menu-trigger {\n  display: block;')
    expect(css).toContain('text-overflow: ellipsis;\n  white-space: nowrap;')
  })

  test('ellipsizes post context and timestamp metadata when space is limited', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.postdate {\n  min-width: 0;\n  overflow: hidden;')
    expect(css).toContain('color: var(--accent);\n  text-overflow: ellipsis;\n  white-space: nowrap;')
    expect(css).toContain('.post-context {\n  min-width: 0;')
    expect(css).toContain('overflow: hidden;\n  color: var(--muted);\n  font-size: 0.75rem;\n  text-overflow: ellipsis;')
  })

  test('opens reference popovers on hover and keyboard focus', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.reference-menu:hover .reference-menu-popover {')
    expect(css).toContain('animation: reference-popover-reveal 0s 500ms both;')
    expect(css).toContain(
      '.reference-menu:focus-within .reference-menu-popover {\n  display: grid;\n  animation: none;',
    )
    expect(css).toContain('@keyframes reference-popover-reveal {')
    expect(css).toContain('@media (hover: none), (pointer: coarse) {\n  .account-menu .account-menu-popover,\n'
      + '  .account-menu::after,\n  .reference-menu .reference-menu-popover,\n'
      + '  .reference-menu::after {\n    display: none !important;')
    expect(css).toContain('font-family: inherit;\n  font-size: 0.6875rem;')
    expect(css).toContain('max-width: min(760px, calc(100vw - 2 * var(--gutter)));')
    expect(css).toContain('.reference-menu-popover-tag {\n  min-width: 0;')
    expect(css).toContain('.reference-menu-popover-tag > a {\n  justify-self: start;')
    expect(css).toContain('.reference-menu .reference-menu-popover.reference-menu-popover-tag .button {\n'
      + '  margin-top: var(--space-2);')
    expect(css).toContain('.reference-popover-bio {\n  display: block;\n  width: 100%;')
    expect(css).toContain('margin-top: var(--space-2);\n  color: var(--quote-ink);')
    expect(css).toContain('.reference-menu .reference-menu-popover .button {')
  })

  test('keeps unsupported posting-help popovers hidden', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.posting-help-popover[popover] {\n  display: none;')
    expect(css).toContain('.posting-help-popover[popover]:popover-open {\n  display: block;')
    expect(css).toContain('.posting-help-search .posting-help-popover[popover]:popover-open {\n  display: flex;')
  })
})
