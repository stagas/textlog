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
    expect(css).toContain('.tappable-post .parent-hit-area {\n  position: absolute;')
    expect(css).toContain('.tappable-post .collapsed-post-expander {\n  position: absolute;\n  z-index: 20;')
    expect(css).toContain('.feed-thread>.thread-fold-input:not(:checked)~.thread-root .collapsed-post-expander,\n'
      + '.feed-thread>.thread-fold-input:not(:checked)~.feed-thread-collapsed-branch'
      + ' .collapsed-post-expander {\n  display: none;')
    expect(css).toContain(
      '.tappable-post input,\n.tappable-post .post-spoiler-summary,\n.tappable-post .redacted {\n'
        + '  position: relative;\n  z-index: 21;',
    )
    expect(css).toContain('.tappable-post:has(> .post-hit-area:hover),')
    expect(css).toContain('.tappable-post:has(> .collapsed-post-expander:hover),')
    expect(css).toContain('background: color-mix(in srgb, var(--accent) 5%, transparent);')
    expect(css).toContain('background: color-mix(in srgb, var(--quote-bg), white 2%);')
  })

  test('uses quoted-post text color for polls inside quoted parents', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.parent-quote .poll { font-size: 0.75rem; }')
    expect(css).toContain(
      '.parent-quote .poll-option button,\n.parent-quote .poll-result,\n'
        + '.parent-quote .poll-preview-option { color: var(--quote-ink); }',
    )
    expect(css).not.toContain('.parent-quote .poll-option-count,')
    expect(css).not.toContain('.parent-quote .poll-meta { color: var(--quote-ink); }')
  })

  test('lets taps pass through poll results to the post hit area', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.poll-results { pointer-events: none; }')
  })

  test('keeps poll percentages on one line', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.poll-option-count { white-space: nowrap; }')
  })

  test('renders poll options at the surrounding post text size', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.thread-root>.post>.poll { font-size: .9375rem;')
    expect(css).toContain('.feed-thread .thread-root>.post>.poll { font-size: .8125rem;')
  })

  test('styles execution output consistently in internal post hover cards', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post.internal-post-card .code-fence.execution-output {')
    expect(css).toContain('color: color-mix(in srgb, var(--quote-ink), var(--muted));')
    expect(css).toContain('font-family: var(--font-monospace);')
    expect(css).toContain('font-size: 0.75rem;')
  })

  test('uses ASCII-art line height for execution output', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post .code-fence.execution-output.ascii-art {\n  line-height: 1.15;\n}')
  })

  test('preserves ASCII art formatting in internal post hover cards', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post.internal-post-card > .post-body.ascii-art {')
    expect(css).toContain('font-family: var(--font-monospace);\n  line-height: 1.15;')
    expect(css).toContain('letter-spacing: normal;\n  white-space: pre;')
  })

  test('lets taps pass through todos that the viewer cannot edit', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain(
      '.todo { position: relative; z-index: 2; display: grid; gap: 0; margin-top: 0; font-size: .8125rem; line-height: 1.35; pointer-events: none; }',
    )
    expect(css).toContain('.thread-root>.post>.todo { font-size: .9375rem;')
    expect(css).toContain('.feed-thread .thread-root>.post>.todo { font-size: .8125rem;')
    expect(css).toContain('font: inherit; line-height: inherit; text-align: left;')
    expect(css).toContain('.todo-check-checked { color: var(--accent-dark); }')
    expect(css).toContain(
      '.todo-item > button:hover .todo-check,\n.todo-item > button:hover + .todo-label { color: var(--accent); }',
    )
    expect(css).toContain('margin-right: 1ch; color: var(--muted); font: inherit;')
    expect(css).toContain(
      '.todo-item { position: relative; display: flex; align-items: center; width: fit-content; max-width: 100%; margin: 0; }',
    )
    expect(css).toContain('.todo-editable .todo-item > button { position: absolute; inset: 0; width: 100%; }')
    expect(css).toContain('.todo-editable .todo-label { margin-left: 4ch; pointer-events: none; }')
    expect(css).toContain('.todo :is(.reference-menu, .remote-link-menu) {')
    expect(css).toContain('.todo :is(.reference-menu, .remote-link-menu):is(:hover, :focus-within) { z-index: 24; }')
    expect(css).toContain('z-index: 23;\n  pointer-events: auto;')
    expect(css).toContain('.todo :is(.reference-menu-popover, .remote-link-popover) { pointer-events: auto; }')
    expect(css).toContain('.todo-editable .todo-label :is(a, button) {')
    expect(css).toContain('.todo a { pointer-events: auto; }')
    expect(css).toContain('.todo .post-spoiler-summary { line-height: 1.65; pointer-events: auto; }')
    expect(css).toContain(
      '.todo .post-spoiler:has(.post-spoiler-input:checked) .post-spoiler-content-inner { margin-top: 0; }',
    )
    expect(css).toContain('.parent-quote .todo { font-size: .75rem; letter-spacing: normal; }')
  })

  test('highlights a post or activity entry opened through its stable anchor', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post:target,\n.activity-follow:target {')
    expect(css).toContain('animation: post-target-fade 3s ease-in forwards;')
    expect(css).toContain('@keyframes post-target-fade {')
    expect(css).toContain('from { box-shadow: inset 0 0 0 9999px rgb(128 128 128 / 25%); }')
    expect(css).toContain('to { box-shadow: inset 0 0 0 9999px transparent; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {')
    expect(css).toContain('background: rgb(128 128 128 / 25%);\n    animation: none;')
  })

  test('centers the read-all action on the unread activity highlight', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.feed-read-action {\n  display: flex;\n  justify-content: center;')
    expect(css).toContain(
      'padding: var(--space-2) var(--gutter);\n  background: color-mix(in srgb, var(--accent) 6%, transparent);',
    )
  })

  test('keeps feed anchors below the sticky tabs on desktop and mobile', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post {\n  scroll-margin-top: calc(var(--space-6) + var(--space-1));\n}')
    expect(css).toContain(
      '@media (max-width: 600px) {\n  .post,\n  .activity-follow {\n    scroll-margin-top: calc(var(--space-7) + var(--space-1));\n  }\n}',
    )
  })

  test('removes the top border from a grouped first activity', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain(
      '#feed-tabs {\n  position: sticky;\n  z-index: 40;\n  top: calc(-1 * var(--space-4));\n  background: var(--bg);\n}',
    )
    expect(css).toContain('@media (max-width: 600px) {\n  #feed-tabs {\n    top: 0;\n  }')
    expect(css).toContain('.feed-tabs {\n    padding-top: 0;\n  }')
    expect(css).toContain('.feed-tabs-scroll > a {\n    padding-top: calc(var(--space-2) + var(--space-4));\n  }')
    expect(css).toContain(
      '.profile-page-tabs {\n  position: sticky;\n  z-index: 40;\n  top: 0;\n  background: var(--bg);\n}',
    )
    expect(css).toContain('.feed-tabs+.activity-group > .activity-follow:first-child,')
    expect(css).toContain('.feed-read-action+.activity-group > .activity-follow:first-child {\n  border-top: 0;')
  })

  test('animates thread folding with a collapsible grid track', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.reply-branch {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n' +
      '  grid-template-rows: 1fr;\n  min-width: 0;')
    expect(css).toContain(
      '.thread-branch-content {\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n' +
      '  animation: disclosure-overflow 0s 200ms forwards;',
    )
    expect(css).toContain(
      '.thread-fold-input:checked~.reply-branch .thread-branch-content {\n  overflow: hidden;\n  animation: none;',
    )
    expect(css).toContain('.thread-fold-input:checked~.reply-branch {\n  grid-template-rows: 0fr;')
    expect(css).toContain('.reply-branch:not(.feed-thread-collapsed-branch)>.thread-branch-content {\n'
      + '  opacity: 1;\n  transition: opacity 120ms ease;')
    expect(css).toContain('.thread-fold-input:checked~.reply-branch:not(.feed-thread-collapsed-branch)'
      + '>.thread-branch-content {\n  opacity: 0;')
    expect(css).toContain('transition: grid-template-rows 200ms ease, visibility 0s 200ms;')
  })

  test('folded feed threads retain only their deep reply preview', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('a.post-continuation-link {\n  color: var(--accent);')
    expect(css).toContain('.thread-ancestor-gap.post-continuation-link {\n'
      + '  display: block;\n  color: var(--muted);\n  border-bottom: 0;')
    expect(css).toContain('.collapsed-preview-gap.thread-fold-expander {\n'
      + '  color: var(--muted);\n  cursor: pointer;')
    expect(css).not.toContain('.collapsed-preview-gap.thread-fold-expander::after')
    expect(css).not.toContain('.feed-thread>.thread-fold-input:checked+.thread-root .thread-fold {')
    expect(css).toContain('.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch {\n'
      + '  grid-template-rows: 1fr;')
    expect(css).toContain('.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch'
      + ' .thread-branch-content {\n  overflow: visible;')
    expect(css).toContain('.post-page-thread.feed-thread:has(> .thread-fold-input:checked)'
      + ':has(> .feed-thread-collapsed-branch) {\n  margin-bottom: var(--space-5);')
    expect(css).toContain('.feed-thread-collapsed-branch {\n  interpolate-size: allow-keywords;')
    expect(css).toContain('.feed-thread-collapsed-branch .collapsed-preview-gap {\n'
      + '  display: none;\n  height: 0;\n  padding-top: 0;')
    expect(css).toContain('.feed-thread:not(:has(.post-continuation-link))'
      + ':not(:has(> .thread-fold-input:checked)) .thread-ancestor-gap {\n'
      + '  display: none;')
    expect(css).toContain('.omitted-parent-reply {\n'
      + '  margin-left: clamp(18px, 3vw, 28px);\n  border-left: 1px solid var(--soft);')
    expect(css).toContain('.feed-thread .omitted-parent-reply {\n'
      + '  margin-left: 0;\n  border-left: 0;')
    expect(css).toContain('.feed-thread>.thread-fold-input:not(:checked)~.feed-thread-collapsed-branch'
      + ' .projected-reply-deeper {\n'
      + '  margin-left: clamp(18px, 3vw, 28px);\n  border-left: 1px solid var(--soft);')
    expect(css).toContain('.reply-node:not(.collapsed-preview-path) {\n  height: 0;')
    expect(css).toContain('.thread-ancestor-gap:not(.collapsed-preview-gap) {\n'
      + '  height: 0;\n  opacity: 0;\n  padding-top: 0;')
    expect(css).toContain('.collapsed-preview-path:not(.collapsed-preview-post)>.reply-branch {\n'
      + '  margin-left: 0;')
    expect(css).not.toContain('.collapsed-preview-path-branch {\n  margin-left: 0;')
    expect(css).toContain('transition: height 200ms ease, padding 200ms ease, opacity 120ms ease;')
    expect(css).toContain('.reply-node:not(.collapsed-preview-path) {\n  height: 0;\n  opacity: 0;')
    expect(css).toContain('.collapsed-preview-path>.post {\n  height: 0;\n  opacity: 0;')
    expect(css).toContain('.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch'
      + ' .reply-node:not(.collapsed-preview-path),\n'
      + '.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch\n'
      + '  .collapsed-preview-path:not(.collapsed-preview-post)>.post,\n'
      + '.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch .thread-ancestor-gap {\n'
      + '  overflow: hidden;')
    expect(css).toContain('.collapsed-preview-post>.post,\n'
      + '.feed-thread>.thread-fold-input:checked~.feed-thread-collapsed-branch .collapsed-preview-gap {\n'
      + '  display: block;\n  height: auto;\n  opacity: 1;')
    expect(css).toContain('.collapsed-preview-deeper {\n'
      + '  margin-left: clamp(18px, 3vw, 28px);\n  border-left: 1px solid var(--soft);')
  })

  test('animates grouped activity disclosures with a collapsible grid track', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.activity-more-content {\n  display: grid;\n  grid-template-rows: 0fr;')
    expect(css).toContain('.activity-more-content-inner {\n  min-height: 0;\n  overflow: hidden;')
    expect(css).toContain('.activity-more-input:checked ~ .activity-more-content {\n  grid-template-rows: 1fr;')
    expect(css).toContain(
      '.activity-more-input:checked ~ .activity-more-content .activity-more-content-inner {\n'
        + '  animation: disclosure-overflow 0s 200ms forwards;',
    )
    expect(css).toContain('@keyframes disclosure-overflow {\n  to { overflow: visible; }\n}')
    expect(css).toContain(
      '.post-spoiler:has(.post-spoiler-input:checked) .post-spoiler-content-inner {\n'
        + '  margin-top: var(--space-1);\n  animation: disclosure-overflow 0s 200ms forwards;',
    )
    expect(css).toContain('.activity-more-summary::before {\n  content: "";')
    expect(css).toContain(
      '.activity-more-input:checked + .activity-more-summary::before {\n  transform: rotate(90deg);',
    )
  })

  test('uses the active accent for the mobile tap highlight', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('--tap-highlight: color-mix(in srgb, var(--accent) 24%, transparent);')
    expect(css).toContain('-webkit-tap-highlight-color: var(--tap-highlight);')
  })

  test('makes header navigation actions full-height hit targets', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.brand {\n  color: var(--ink);\n  display: inline-flex;\n  align-self: stretch;')
    expect(css).toContain('header>nav {\n  max-width: 100%;\n  margin-left: auto;\n  align-self: stretch;')
    expect(css).toContain('header>nav>a:not(.button),\n.account-nav-row>a:not(.button),\n.account-menu-handle {')
    expect(css).toContain('.account-nav-row {\n  display: flex;\n  align-self: stretch;')
    expect(css).toContain(
      '.account-menu {\n  position: relative;\n  z-index: 50;\n  display: inline-flex;\n  align-self: stretch;',
    )
    expect(css).toContain('top: calc(50% + .75em + var(--space-2));')
    expect(css).toContain('top: calc(50% + .75em);')
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
    expect(css).toContain('.compose-post-preview .postauthor:not(.post-context-author) {')
    expect(css).toContain(
      '.preview-post-meta > :not(.reference-menu):not(.post-context):not(.preview-context-target) {',
    )
    expect(css).toContain(
      '.compose-post-preview .preview-post-meta > .post-context {\n  color: var(--muted);\n  cursor: default;\n  border-bottom: 0;',
    )
    expect(css).toContain('.preview-post-meta > .post-context-author {\n  margin-left: 0;')
    expect(css).toContain(
      '.preview-post-meta > .preview-context-target {\n  margin-left: calc(-1 * var(--space-4) + 1ch);',
    )
  })

  test('styles conversation top links like reply actions', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.postfoot .post-reply-link,\n.posttop .post-top-link,')
    expect(css).toContain(
      '.postfoot .post-reply-link:hover,\n.posttop .post-top-link:hover,',
    )
    expect(css).toContain('.posttop > .post-top-link {\n  margin-left: auto;\n}')
  })

  test('keeps the edit cancel action muted', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.secondary-action.cancel-action {\n  color: var(--muted);')
    expect(css).toContain('.secondary-action.cancel-action:hover {\n  color: var(--tab-hover);')
  })

  test('lets notification settings use the full page width', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.notifications-page {\n  max-width: none;\n}')
  })

  test('lets the account switcher use the full page width', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.account-switcher-page {\n  max-width: none;')
  })

  test('spaces account security headings, copy, and actions consistently', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.security-section {\n  display: grid;\n  gap: var(--space-4);')
    expect(css).toContain('.security-section > :is(h2, p, form) {\n  margin: 0;')
    expect(css).toContain('.security-section > .button {\n  justify-self: start;')
  })

  test('defines compact and relaxed global density scales', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('body.density-compact {')
    expect(css).toContain('--space-7: 36px;')
    expect(css).toContain('body.density-relaxed {')
    expect(css).toContain('--space-7: 60px;')
    expect(css).toContain('body.density-compact :where(p, li, textarea):not(.ascii-art)')
  })

  test('tightens ASCII art line spacing for mobile user agents only', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('body.mobile-agent .ascii-art {\n  line-height: 1 !important;\n}')
  })

  test('preserves ASCII art whitespace, shows it vertically, and scrolls it horizontally without a scrollbar', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain(
      '.post-body.ascii-art {\n  z-index: 2;\n  display: block;\n  max-width: 100%;\n  padding-block: 0.15em;\n  overflow-x: auto;\n  overflow-y: visible;\n  overscroll-behavior-inline: contain;',
    )
    expect(css).toContain('overflow-wrap: normal;\n  scrollbar-width: none;\n  white-space: pre;')
    expect(css).toContain('.post-body.ascii-art::-webkit-scrollbar {\n  display: none;\n}')
  })

  test('compensates fenced code spacing for its preserved trailing newline', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.post .code-fence {\n  display: block;\n  max-width: 100%;\n  margin: 0.5lh 0 -0.5lh;')
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
    expect(css).toContain('.panel-surface {')
    expect(css).toContain('background: var(--panel);')
    expect(css).toContain('.panel-surface .form-control {\n  background-color: var(--bg);')
    expect(css).toContain('.illegal-activity-page {\n  max-width: none;')
    expect(css).toContain('.button-danger {')
    expect(css).toContain('.button-wide {')
    expect(css).toContain('gap: var(--space-2);')
    expect(css).toContain('.button.button-muted {')
    expect(css).toContain('.form-select {')
    expect(css).toContain('.form-checkbox {')
    expect(css).toContain('.form-control:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: -2px;')
    expect(css).toContain('.form-checkbox:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 2px;')
    expect(css).toContain('appearance: none;')
    expect(css).toContain('.form-checkbox:checked {')
    expect(css).toContain(
      '.report-panel .good-faith {\n  display: flex;\n  align-items: flex-start;\n  gap: var(--space-2);',
    )
    expect(css).toContain('.illegal-activity-page .report-panel .form-hint {\n  width: 100%;\n  max-width: none;')
    expect(css).toContain(
      '.illegal-activity-page .report-panel .identity-exception-hint {\n  color: var(--muted);\n  font-size: 0.6875rem;',
    )
    expect(css).toContain('font-size: 0.8125rem;\n  font-weight: 400;\n  line-height: 1.75;')
    expect(css).toContain(
      '.illegal-activity-page .report-panel .good-faith span {\n  min-width: 0;\n  flex: 1;\n  font: inherit;',
    )
    expect(css).not.toContain('.unfollow-button')
    expect(css).not.toContain('.auth-panel .button {\n  min-height: 48px;\n  justify-content: space-between;')
    expect(css).toContain('flex-wrap: wrap;')
    expect(css).toContain('.activity-item-directed-unread {')
    expect(css).toContain('.to-me-count {')
    expect(css).not.toContain('.activity-item-unread {')
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
    expect(css).toContain(
      'overflow: hidden;\n  color: var(--muted);\n  font-size: 0.75rem;\n  text-overflow: ellipsis;',
    )
  })

  test('ellipsizes follow-event date and note metadata as one segment', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.activity-follow-main .activity-follow-stats {\n  display: block;\n  min-width: 0;')
    expect(css).toContain(
      'overflow: hidden;\n  color: var(--accent);\n  font-size: 0.75rem;\n  text-overflow: ellipsis;',
    )
    expect(css).toContain('.activity-follow-main .activity-follow-stats > * + * {\n  margin-left: var(--space-2);')
  })

  test('ellipsizes follow-event context labels when space is limited', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.activity-follow-main .activity-context {\n  min-width: 0;\n  overflow: hidden;\n'
      + '  text-overflow: ellipsis;\n  white-space: nowrap;')
  })

  test('opens reference popovers on hover and keyboard focus', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    const accountBridgeRule = css.slice(css.indexOf('.account-menu-handle::after {'),
      css.indexOf('.account-menu-popover a,'))
    expect(accountBridgeRule).toContain('height: var(--space-2);')
    expect(accountBridgeRule).not.toContain('pointer-events: none;')
    const popoverRule = css.slice(css.indexOf('.reference-menu-popover {'), css.indexOf('.reference-menu-popover-tag'))
    expect(popoverRule).toContain('z-index: 22;')
    expect(css).toContain('.reference-menu:hover > .reference-menu-popover {')
    expect(css).toContain('animation: reference-popover-reveal 0s 500ms both;')
    expect(css).toContain(
      '.reference-menu:focus-within > .reference-menu-popover {\n  display: grid;\n  animation: none;',
    )
    expect(css).toContain('@keyframes reference-popover-reveal {')
    expect(css).toContain('.account-menu[open] > .account-menu-popover {\n  display: grid;')
    expect(css).toContain('.account-menu summary.account-menu-handle::-webkit-details-marker {\n  display: none;')
    expect(css).toContain('  .reference-menu .reference-menu-popover,\n'
      + '  .reference-menu::after {\n    display: none !important;')
    expect(css).toContain('font-family: inherit;\n  font-size: 0.6875rem;')
    expect(css).toContain('max-width: min(760px, calc(100vw - 2 * var(--gutter)));')
    expect(css).toContain('.reference-menu-popover-tag {\n  min-width: 0;')
    expect(css).toContain('.reference-menu-popover-tag > a {\n  justify-self: start;')
    expect(css).toContain('.reference-menu .reference-menu-popover.reference-menu-popover-tag .button {\n'
      + '  margin-top: var(--space-2);')
    expect(css).toContain('.reference-popover-bio {\n  display: block;\n  width: 100%;')
    expect(css).toContain('.reference-menu-popover > .reference-popover-actions:first-child:not(:has(.follows-you)),')
    expect(css).toContain('.reference-menu-popover:not(:has(.reference-popover-bio)) {\n  min-width: 0;')
    expect(css).toContain(
      '.reference-menu-popover:not(:has(.reference-popover-bio)) > .reference-popover-actions:has(.follows-you) {',
    )
    expect(css).toContain(
      '.reference-menu-popover:has(> .reference-popover-actions .follows-you) > .reference-popover-bio {\n'
      + '  margin-top: calc(var(--space-2) + 2px);',
    )
    expect(css).toContain('margin-top: var(--space-2);\n  margin-bottom: var(--space-2);\n'
      + '  padding-bottom: var(--space-2);\n  border-bottom: 1px solid var(--soft);\n  color: var(--quote-ink);')
    expect(css).toContain(
      '.reference-menu-popover:has(> .reference-popover-actions):has(> .reference-popover-bio) {\n'
      + '  grid-template-columns: max-content minmax(12rem, 1fr);',
    )
    expect(css).toContain(
      '.reference-menu-popover:has(> .reference-popover-actions) > .reference-popover-bio {\n'
      + '  margin: 0;\n  padding: 0;',
    )
    const bioColumnRule = css.slice(
      css.indexOf('.reference-menu-popover:has(> .reference-popover-actions) > .reference-popover-bio {'),
      css.indexOf('.reference-popover-bio-own {'),
    )
    expect(bioColumnRule).not.toContain('border-left:')
    expect(css).toContain(
      '.reference-popover-bio-own {\n  margin-bottom: 0;\n  padding-bottom: 0;\n  border-bottom: 0;',
    )
    expect(css).toContain('.reference-menu .reference-menu-popover .button {')
  })

  test('loads remote link preview backgrounds from the hover rule', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.remote-link-menu:hover .remote-link-popover {')
    expect(css).toContain('.remote-link-menu:hover .remote-link-image,')
    expect(css).toContain('background-image: var(--preview-image);')
    const cardRule = css.slice(css.indexOf('.remote-link-popover {'), css.indexOf('.post-body a.remote-link-popover'))
    expect(cardRule).toContain('width: min(var(--preview-width, 382px), calc(100vw - 2 * var(--gutter)));')
    expect(css).toContain('.remote-link-menu {\n  position: relative;\n  display: inline-block;\n  max-width: 100%;')
    expect(css).toContain('header,\nmain,\n.site-footer {\n  max-width: 760px;\n  width: 100%;')
    expect(css).toContain('.remote-link-menu:hover::after,\n.remote-link-menu:focus-within::after {')
    expect(css).toContain('max-height: 200px;')
    expect(css).toContain('aspect-ratio: var(--preview-ratio, 1.91);')
    expect(css).toContain('.remote-link-image-sized {\n  background-size: contain;')
    expect(css).toContain('.post:has(.remote-link-menu:hover),')
    expect(css).toContain('.tappable-post .tappable-parent:has(.remote-link-menu:hover),\n'
      + '.tappable-post .tappable-parent:has(.remote-link-menu:focus-within) {\n  z-index: 30;')
    expect(css).toContain('animation: reference-popover-reveal 0s 500ms both;')
    expect(cardRule).toContain('z-index: 22;')
    expect(cardRule).not.toContain('background-image')
    expect(css).toContain(
      '.tappable-post a:not(.post-hit-area):not(.parent-hit-area):not(.remote-link-popover),',
    )
    expect(css).toContain(
      '.tappable-post input,\n.tappable-post .post-spoiler-summary,\n.tappable-post .redacted {\n'
        + '  position: relative;\n  z-index: 21;',
    )
    expect(cardRule).toContain('cursor: pointer;')
  })

  test('can suppress remote link previews for a signed-in user', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.link-previews-disabled .remote-link-menu:hover .remote-link-popover,')
    expect(css).toContain(
      '.link-previews-disabled .remote-link-menu:focus-within .remote-link-popover {\n  display: none;',
    )
    expect(css).toContain('.link-preview-setting {\n  display: flex;')
    expect(css).toContain('font-size: 0.75rem;')
    expect(css).toContain('.link-preview-setting .form-checkbox {\n  width: 16px;\n  height: 16px;')
  })

  test('keeps posting help inline and lets expanded content span the action row', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('.posting-help-details {\n  display: block;\n  grid-column: 1;')
    expect(css).toContain('.posting-help-details[open] + .posting-help-content {\n  display: grid;')
    expect(css).toContain('width: 100%;\n  margin-top: var(--space-5);')
    expect(css).toContain('.posting-help-summary-link {\n  display: inline-block;')
    expect(css).toContain('width: fit-content;\n  line-height: 1.5;')
    expect(css).not.toContain('.posting-help-popover')
  })

  test('gives the mobile edit composer the same posting-help layout as write', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain(
      '@media (max-width: 520px) {\n  .panel:is(.write-compose, .replybox) {\n'
        + '    width: 100%;\n    margin-inline: 0;\n    border-inline: 0;',
    )
    expect(css).not.toContain('padding-left: 0;\n    padding-right: var(--gutter);')
    expect(css).toContain('.bio-form > label > input:not([type="checkbox"]),')
    expect(css).not.toContain('\n.bio-form input:not([type="checkbox"]),')
    expect(css).toContain('.bio-form + .account-danger-zone {\n  margin-top: var(--space-4);')
    expect(css).toContain('.bio-field .posting-help-details summary,')
    expect(css).toContain('min-height: 0;')
    expect(css).toContain('.composefoot .posting-help {\n  display: contents;')
    expect(css).toContain('display: flex;\n  grid-column: 1;\n  grid-row: 1;')
    expect(css).toContain(
      ':is(.write-compose, .edit-post-compose, .replybox, .bio-form) .composefoot {',
    )
    expect(css).toContain(
      ':is(.write-compose, .edit-post-compose, .replybox) .composefoot {\n    grid-template-columns: minmax(0, 1fr) auto;\n    gap: var(--space-2);',
    )
    expect(css).toContain(
      '.composefoot .posting-help-details {\n    grid-column: 1;\n    grid-row: 1;\n    font-size: 0.5625rem;',
    )
    expect(css).toContain(
      '.posting-help-tabs {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    )
    expect(css).toContain(
      '.posting-help-tab-panel > div {\n    grid-template-columns: minmax(0, 1fr);',
    )
  })

  test('strongly blurs warned content and removes the warning after reveal', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('filter: blur(.35rem);')
    expect(css).toContain('opacity: .8;')
    expect(css).not.toContain('max-height: 8rem;')
    expect(css).toContain('.content-warning-overlay > span {')
    expect(css).toContain('box-shadow: 0 0 var(--space-2) var(--space-1) var(--bg);')
    expect(css).toContain('.parent-quote .content-warning-overlay > span {\n  background: var(--quote-surface);')
    expect(css).toContain('.content-warning-action {\n  color: var(--accent);\n  padding-inline: 0;\n  padding-bottom: 1px;\n  border-bottom: var(--hairline) solid var(--link-border);')
    expect(css).toContain('grid-area: 1 / 1;')
    expect(css).toContain('font-size: var(--post-body-font-size, 0.8125rem);')
    expect(css).toContain('box-shadow: 0 0 var(--space-2) var(--space-1) var(--quote-surface);')
    expect(css).toContain('.content-warning-toggle:checked + .content-warning-overlay {\n  display: none;')
    expect(css).not.toContain('Content revealed.')
  })

  test('round corners use global surface tokens while preserving intentional circles', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text()
    expect(css).toContain('body.corners-round {')
    expect(css).toContain('--corner-radius: 8px;')
    expect(css).toContain('body.corners-round * {\n  border-radius: var(--corner-radius);')
    expect(css).toContain('body.corners-round :is(a, .quiet, .reference-menu, .danger, .content-warning-action,')
    expect(css).toContain('body.corners-round :is(button, .button) {\n  border-radius: var(--corner-radius);')
    expect(css).not.toContain('body.corners-round button.quiet')
    expect(css).toContain('body.corners-round .account-menu-popover :is(a, button) {\n  border-radius: var(--corner-radius-small);')
    expect(css).toContain('body.corners-round .pagination :is(a, span, input) {\n  border-radius: var(--corner-radius);')
    expect(css).toContain('body.corners-round .notification-toggle {\n  border-radius: 0;')
    expect(css).toContain('.pagination, .guest-join-row, .post, .activity-follow, .security-section, .api-key-lifetime,')
    expect(css).toContain('.tags, .people article, .feed-thread, .reference-popover-bio')
    expect(css).toContain('body.corners-round :is(.posttop, .parent-quote-top, .postfoot) > :is(a, .reference-menu),')
    expect(css).toContain('.thread-root.profile-pinned-surround) {\n  border-radius: 0;')
    expect(css).toContain('body.corners-round :is(.post, .reply-preview, .internal-post-card,')
    expect(css).toContain('body.corners-round .parent-quote {\n  border-radius: var(--corner-radius);')
    expect(css).toContain('body.corners-round button,\nbody.corners-round a.button {\n  border-radius: var(--corner-radius) !important;')
    expect(css).toContain('body.corners-round :is(.feed-tabs, .appearance-tabs, .posting-help-tabs,')
    expect(css).toContain('border-radius: var(--corner-radius) 0 0 var(--corner-radius) !important;')
    expect(css).toContain('border-radius: 0 var(--corner-radius) var(--corner-radius) 0;')
    expect(css).toContain('body.corners-round .explore-tag-card {\n  border-radius: var(--corner-radius);\n  overflow: hidden;')
    expect(css).toContain('.accent-swatch { display: block; width: 30px; height: 30px; padding: 4px; border: 1px solid var(--soft); border-radius: 50%;')
  })
})
