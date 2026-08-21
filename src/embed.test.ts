import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Embed } from './components/embed'
import { themeStyles } from './theme'

test('embed appearance query parameters select known themes and accents', () => {
  const css = themeStyles(new Request('https://textlog.cc/theme.css?theme=dracula&accent=cyan&font=dejavu'))
  expect(css).toContain('--bg:#282a36')
  expect(css).toContain('--accent:#8be9fd')
  expect(css).toContain('--font-monospace:"DejaVu Sans Mono", monospace')
})

test('embed font short names are optional and invalid values fall back safely', () => {
  const invalid = themeStyles(new Request('https://textlog.cc/theme.css?theme=light&font=not-a-font'))
  expect(invalid).toContain('--font-monospace:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')

  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [],
    title: 'latest',
    href: '/latest',
    theme: 'light',
    accent: 'sage',
    font: 'jetbrains',
  }))
  expect(html).toContain('/theme.css?theme=light&amp;accent=sage&amp;font=jetbrains')
})

test('embed system font uses the full system name', () => {
  const css = themeStyles(new Request('https://textlog.cc/theme.css?font=system'))
  expect(css).toContain('--font-monospace:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
})

test('embed theme can be omitted from the generated stylesheet URL', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [],
    title: 'hot',
    href: '/hot',
    accent: 'purple',
    font: 'consolas',
  }))
  expect(html).toContain('/theme.css?accent=purple&amp;font=consolas')
  expect(html).not.toContain('theme=')
})

test('invalid embed appearance values use safe defaults', () => {
  const css = themeStyles(new Request('https://textlog.cc/theme.css?theme=broken&accent=nope'))
  expect(css).toContain('@media(prefers-color-scheme:dark)')
  expect(css).toContain('--accent:#749668')
})

test('embed document title renders as one text child', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [],
    title: 'post 1093',
    href: '/post/1093',
    theme: 'system',
    accent: 'theme',
  }))
  expect(html).toContain('<title>post 1093 · textlog</title>')
})

test('feed embeds render a quoted parent with its metadata and links', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [{
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'reply',
      created_at: '2026-08-10 12:00:00',
      deleted_at: null,
      handle: 'alice',
      reply_count: 0,
      parent: {
        id: 1,
        body: 'quoted #note',
        created_at: '2026-08-10 11:00:00',
        deleted_at: null,
        handle: 'bob',
        reply_count: 2,
      },
    }],
    title: '@alice',
    href: '/u/alice',
    theme: 'system',
    accent: 'theme',
  }))

  expect(html).toContain('class="embed-parent"')
  expect(html).toContain('href="/u/bob"')
  expect(html).toContain('href="/post/1"')
  expect(html).toContain('quoted <a target="_blank" rel="noopener noreferrer" href="/tag/note">#note</a>')
  expect(html).not.toContain('· replies</span>')
  expect(html).not.toContain('2 replies')
})

test('feed embeds mark an ASCII-art quoted parent on its container', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [{
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'reply',
      created_at: '2026-08-10 12:00:00',
      deleted_at: null,
      handle: 'alice',
      parent: {
        id: 1,
        body: ' /\\_/\\\n( o.o )\n#ascii_art',
        created_at: '2026-08-10 11:00:00',
        deleted_at: null,
        handle: 'bob',
        reply_count: 1,
      },
    }],
    title: '@alice',
    href: '/u/alice',
    accent: 'theme',
  }))

  expect(html).toContain('class="embed-parent ascii-art"')
})
