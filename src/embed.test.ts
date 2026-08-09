import { expect, test } from 'bun:test'
import { themeStyles } from './theme'

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
