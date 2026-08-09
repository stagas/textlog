import { expect, test } from 'bun:test'
import { activeAppearance, appearance, appearanceCookie, themeLogoSvg, themeStyles, withAppearance } from './theme'

test('appearance reads valid choices and falls back safely', () => {
  expect(appearance(new Request('http://localhost', { headers: { cookie: 'appearance=sepia.amber' } })))
    .toEqual({ theme: 'sepia', accent: 'amber' })
  expect(appearance(new Request('http://localhost', { headers: { cookie: 'appearance=nope.neon' } })))
    .toEqual({ theme: 'system', accent: 'theme' })
})

test('appearance is available while rendering a request', () => {
  const request = new Request('http://localhost', { headers: { cookie: 'appearance=dracula.cyan' } })
  expect(withAppearance(request, activeAppearance)).toEqual({ theme: 'dracula', accent: 'cyan' })
})

test('appearance cookie is long-lived, server-only, and secure on HTTPS', () => {
  const cookie = appearanceCookie({ theme: 'dracula', accent: 'purple' }, 'https://textlog.cc')
  expect(cookie).toContain('appearance=dracula.purple')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).toContain('Secure')
})

test('theme stylesheet uses mobile palettes and follows the OS for system', () => {
  const sepia = themeStyles(new Request('http://localhost', { headers: { cookie: 'appearance=sepia.rust' } }))
  expect(sepia).toContain('--bg:#f4ecd8')
  expect(sepia).toContain('--accent:#a33b32')
  expect(sepia).toContain('--button-bg:#7d382c')
  expect(sepia).toContain('--button-hover-bg:#86392d')
  expect(sepia).toContain('--button-active-bg:#73382a')
  expect(sepia).toContain('--unfollow-button-bg:#6e3729')
  expect(sepia).toContain('--unfollow-button-hover-bg:#78382b')
  expect(sepia).toContain('--unfollow-button-active-bg:#653628')
  expect(sepia).not.toContain('prefers-color-scheme')

  const system = themeStyles(new Request('http://localhost'))
  expect(system).toContain('--bg:#f4f3ee')
  expect(system).toContain('@media(prefers-color-scheme:dark)')
  expect(system).toContain('--bg:#171a17')
  expect(system).toContain('--button-bg:#3b503d')
  expect(system).toContain('--button-ink:#e5e8e1')
  expect(system).toContain('--button-hover-bg:#4b664d')
  expect(system).toContain('--button-active-bg:#314434')
  expect(system).toContain('--unfollow-button-bg:#455341')
  expect(system).toContain('--unfollow-button-hover-bg:#52634d')
  expect(system).toContain('--unfollow-button-active-bg:#384335')
})

test('logo SVG follows the selected accent and system brightness', () => {
  const fixed = themeLogoSvg(new Request('http://localhost', {
    headers: { cookie: 'appearance=dracula.pink' },
  }))
  expect(fixed).toContain('fill="#ff79c6"')
  expect(fixed).not.toContain('prefers-color-scheme')

  const system = themeLogoSvg(new Request('http://localhost', {
    headers: { cookie: 'appearance=system.blue' },
  }))
  expect(system).toContain('path{fill:#3a6ea5}')
  expect(system).toContain('@media(prefers-color-scheme:dark){path{fill:#7aa2f7}}')
})
