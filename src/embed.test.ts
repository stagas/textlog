import { expect, test } from 'bun:test'
import { themeStyles } from './theme'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { Embed } from './components/embed'

test('embed appearance query parameters select known themes and accents', () => {
  const css = themeStyles(new Request('https://textlog.cc/theme.css?theme=dracula&accent=cyan'))
  expect(css).toContain('--bg:#282a36')
  expect(css).toContain('--accent:#8be9fd')
})

test('invalid embed appearance values use safe defaults', () => {
  const css = themeStyles(new Request('https://textlog.cc/theme.css?theme=broken&accent=nope'))
  expect(css).toContain('@media(prefers-color-scheme:dark)')
  expect(css).toContain('--accent:#749668')
})

test('embed document title renders as one text child', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [], title: 'post 1093', href: '/post/1093', theme: 'system', accent: 'theme',
  }))
  expect(html).toContain('<title>post 1093 · textlog</title>')
})

test('feed embeds render a quoted parent with its metadata and links', () => {
  const html = renderToStaticMarkup(React.createElement(Embed, {
    posts: [{
      id: 2, user_id: 1, parent_id: 1, body: 'reply', created_at: '2026-08-10 12:00:00',
      deleted_at: null, handle: 'alice', reply_count: 0,
      parent: {
        id: 1, body: 'quoted #note', created_at: '2026-08-10 11:00:00', deleted_at: null,
        handle: 'bob', reply_count: 2,
      },
    }],
    title: '@alice', href: '/u/alice', theme: 'system', accent: 'theme',
  }))

  expect(html).toContain('class="embed-parent"')
  expect(html).toContain('href="/u/bob"')
  expect(html).toContain('href="/post/1"')
  expect(html).toContain('quoted <a target="_blank" rel="noopener noreferrer" href="/tag/note">#note</a>')
  expect(html).toContain('2 replies')
})
