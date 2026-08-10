import { expect, test } from 'bun:test'
import { activeAppearance, appearance, appearanceCookie, fontChoice, fontCookie, fontSizeChoice, fontSizeCookie, themeLogoSvg, themeStyles, versionedAppearance, withAppearance } from './theme'

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

test('font preference is validated and emitted by the theme stylesheet', () => {
  const request = new Request('https://textlog.cc', { headers: { cookie: 'font=dejavu-sans-mono' } })
  expect(fontChoice(request)).toBe('dejavu-sans-mono')
  expect(themeStyles(request)).toContain(':root{font-family:"DejaVu Sans Mono", monospace;font-size:16px}')
  expect(fontCookie('menlo', 'https://textlog.cc')).toContain('font=menlo')
  expect(fontCookie('menlo', 'https://textlog.cc')).toContain('Secure')

  const invalid = new Request('http://localhost', { headers: { cookie: 'font=bad%7Dbody%7Bdisplay:none' } })
  expect(fontChoice(invalid)).toBe('system')
  expect(themeStyles(invalid)).toContain('font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
  expect(themeStyles(invalid)).not.toContain('display:none')
})

test('font size preference is validated and emitted by the theme stylesheet', () => {
  const request = new Request('https://textlog.cc', { headers: { cookie: 'font-size=larger' } })
  expect(fontSizeChoice(request)).toBe('larger')
  expect(themeStyles(request)).toContain('font-size:20px')
  expect(themeStyles(request)).not.toContain('zoom:')
  expect(fontSizeCookie('small', 'https://textlog.cc')).toContain('font-size=small')
  expect(fontSizeChoice(new Request('http://localhost', {
    headers: { cookie: 'font-size=enormous' },
  }))).toBe('regular')
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

test('versioned favicon appearances are validated independently of cookies', () => {
  expect(versionedAppearance('sepia.rust')).toEqual({ theme: 'sepia', accent: 'rust' })
  expect(versionedAppearance('system.blue')).toEqual({ theme: 'system', accent: 'blue' })
  expect(versionedAppearance('broken.blue')).toBeNull()
  expect(versionedAppearance('dark.nope')).toBeNull()
  expect(versionedAppearance('dark.blue.extra')).toBeNull()
  expect(versionedAppearance(undefined)).toBeNull()

  const request = new Request('http://localhost', { headers: { cookie: 'appearance=light.sage' } })
  const versioned = themeLogoSvg(request, versionedAppearance('dracula.pink')!)
  expect(versioned).toContain('fill="#ff79c6"')
})
