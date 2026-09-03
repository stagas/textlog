import { expect, test } from 'bun:test'
import { activeAppearance, activeThemeBackgrounds, appearance, appearanceCookie, cornerChoice, cornerCookie, fontChoice,
  fontCookie, fontSizeChoice, fontSizeCookie, primaryFontChoice, primaryFontCookie, sansSerifFontChoice,
  sansSerifFontCookie, themeLogoSvg,
  themeStyles, versionedAppearance, withAppearance } from './theme'

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

test('corner preference is validated and stored in a secure cookie', () => {
  expect(cornerChoice(new Request('http://localhost', { headers: { cookie: 'corners=round' } }))).toBe('round')
  expect(cornerChoice(new Request('http://localhost', { headers: { cookie: 'corners=invalid' } }))).toBe('sharp')
  expect(cornerCookie('round', 'https://textlog.cc')).toContain('corners=round')
  expect(cornerCookie('round', 'https://textlog.cc')).toContain('Secure')
})

test('theme backgrounds follow the active appearance', () => {
  expect(activeThemeBackgrounds()).toEqual({ light: '#f4f3ee', dark: '#171a17' })
  const request = new Request('http://localhost', { headers: { cookie: 'appearance=sepia.amber' } })
  expect(withAppearance(request, activeThemeBackgrounds)).toEqual({ default: '#f4ecd8' })
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
  expect(sepia).toContain('--button-muted-bg:#6e3729')
  expect(sepia).toContain('--button-muted-hover-bg:#78382b')
  expect(sepia).toContain('--button-muted-active-bg:#653628')
  expect(sepia).toContain('--error-bg:#eee2de')
  expect(sepia).toContain('--success-bg:#e3eadf')
  expect(sepia).toContain('--danger-button-bg:#7a3f39')
  expect(sepia).not.toContain('prefers-color-scheme')

  const system = themeStyles(new Request('http://localhost'))
  expect(system).toContain('--bg:#f4f3ee')
  expect(system).toContain('@media(prefers-color-scheme:dark)')
  expect(system).toContain('--bg:#171a17')
  expect(system).toContain('--button-bg:#3b503d')
  expect(system).toContain('--button-ink:#e5e8e1')
  expect(system).toContain('--button-hover-bg:#4b664d')
  expect(system).toContain('--button-active-bg:#314434')
  expect(system).toContain('--button-muted-bg:#455341')
  expect(system).toContain('--button-muted-hover-bg:#52634d')
  expect(system).toContain('--button-muted-active-bg:#384335')
  expect(system).toContain('--error-bg:#442b28')
  expect(system).toContain('--success-bg:#293b28')
})

test('generated system themes emit the complete static light and dark token contract', async () => {
  const declarations = (css: string) =>
    Object.fromEntries(
      [...css.matchAll(/(--[\w-]+):\s*([^;}]+)(?:;|$)/g)].map(([, name, value]) => [name, value.trim()]),
    )
  const staticCss = await Bun.file(new URL('./styles.css', import.meta.url)).text()
  const staticRoots = [...staticCss.matchAll(/:root\s*\{([^}]+)\}/g)].map(match => declarations(match[1]!))
    .filter(root => Object.hasOwn(root, '--bg'))
  const generatedRoots = [...themeStyles(new Request('http://localhost')).matchAll(/:root\{([^}]+)\}/g)]
    .map(match => declarations(match[1]!))

  const invariantToken = /^(--tap-highlight|--focus-ring-|--hairline|--gutter|--space-|--font-size-|--form-action-font-size)/
  for (const [index, staticRoot] of staticRoots.entries()) {
    for (const token of Object.keys(staticRoot).filter(token => !invariantToken.test(token))) {
      expect(generatedRoots[index]).toHaveProperty(token)
    }
  }
})

test('font preference is validated and emitted by the theme stylesheet', () => {
  const request = new Request('https://textlog.cc', { headers: { cookie: 'font=dejavu-sans-mono' } })
  expect(fontChoice(request)).toBe('dejavu-sans-mono')
  expect(themeStyles(request)).toContain('--font-monospace:"DejaVu Sans Mono", monospace')
  expect(themeStyles(request)).toContain(
    '--font-primary:var(--font-monospace);font-family:var(--font-primary);font-size:16px',
  )
  expect(fontCookie('menlo', 'https://textlog.cc')).toContain('font=menlo')
  expect(fontCookie('menlo', 'https://textlog.cc')).toContain('Secure')

  const invalid = new Request('http://localhost', { headers: { cookie: 'font=bad%7Dbody%7Bdisplay:none' } })
  expect(fontChoice(invalid)).toBe('system')
  expect(themeStyles(invalid)).toContain('--font-monospace:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
  expect(themeStyles(invalid)).not.toContain('display:none')
})

test('mobile user agents use DejaVu Sans Mono for the system font', () => {
  const mobile = new Request('https://textlog.cc', {
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36' },
  })
  expect(themeStyles(mobile)).toContain('--font-monospace:"DejaVu Sans Mono", monospace')

  const custom = new Request('https://textlog.cc', {
    headers: {
      cookie: 'font=menlo',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
    },
  })
  expect(themeStyles(custom)).toContain('--font-monospace:Menlo, monospace')
})

test('sans serif and primary font preferences are validated independently', () => {
  const request = new Request('https://textlog.cc', {
    headers: { cookie: 'font=menlo; sans-serif-font=inter; primary-font=sans-serif' },
  })
  expect(sansSerifFontChoice(request)).toBe('inter')
  expect(primaryFontChoice(request)).toBe('sans-serif')
  expect(themeStyles(request)).toContain('--font-monospace:Menlo, monospace')
  expect(themeStyles(request)).toContain('--font-sans-serif:Inter, sans-serif')
  expect(themeStyles(request)).toContain('--font-primary:var(--font-sans-serif)')
  expect(sansSerifFontCookie('inter', 'https://textlog.cc')).toContain('sans-serif-font=inter')
  expect(primaryFontCookie('sans-serif', 'https://textlog.cc')).toContain('primary-font=sans-serif')

  const invalid = new Request('http://localhost', {
    headers: { cookie: 'sans-serif-font=invalid; primary-font=invalid' },
  })
  expect(sansSerifFontChoice(invalid)).toBe('system-sans')
  expect(primaryFontChoice(invalid)).toBe('monospace')
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

  const mobile = new Request('http://localhost', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' },
  })
  expect(fontSizeChoice(mobile)).toBe('small')
  expect(themeStyles(mobile)).toContain('font-size:14px')
  expect(fontSizeChoice(new Request('http://localhost'))).toBe('regular')
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
