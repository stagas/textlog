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
