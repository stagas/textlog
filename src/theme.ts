export const THEME_CHOICES = ['system', 'light', 'dark', 'sepia', 'dracula'] as const
export const ACCENT_CHOICES = ['theme', 'sage', 'purple', 'cyan', 'pink', 'amber', 'blue', 'rust'] as const
export const FONT_CHOICES = [
  { value: 'system', label: 'System', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { value: 'sf-mono', label: 'SF Mono', family: '"SF Mono", SFMono-Regular, monospace' },
  { value: 'menlo', label: 'Menlo', family: 'Menlo, monospace' },
  { value: 'monaco', label: 'Monaco', family: 'Monaco, monospace' },
  { value: 'consolas', label: 'Consolas', family: 'Consolas, monospace' },
  { value: 'cascadia-mono', label: 'Cascadia Mono', family: '"Cascadia Mono", monospace' },
  { value: 'courier-new', label: 'Courier New', family: '"Courier New", monospace' },
  { value: 'lucida-console', label: 'Lucida Console', family: '"Lucida Console", monospace' },
  { value: 'dejavu-sans-mono', label: 'DejaVu Sans Mono', family: '"DejaVu Sans Mono", monospace' },
  { value: 'liberation-mono', label: 'Liberation Mono', family: '"Liberation Mono", monospace' },
  { value: 'ubuntu-mono', label: 'Ubuntu Mono', family: '"Ubuntu Mono", monospace' },
  { value: 'noto-sans-mono', label: 'Noto Sans Mono', family: '"Noto Sans Mono", monospace' },
  { value: 'droid-sans-mono', label: 'Droid Sans Mono', family: '"Droid Sans Mono", monospace' },
  { value: 'source-code-pro', label: 'Source Code Pro', family: '"Source Code Pro", monospace' },
  { value: 'roboto-mono', label: 'Roboto Mono', family: '"Roboto Mono", monospace' },
  { value: 'fira-mono', label: 'Fira Mono', family: '"Fira Mono", monospace' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace' },
  { value: 'hack', label: 'Hack', family: 'Hack, monospace' },
] as const
export const SANS_SERIF_FONT_CHOICES = [
  { value: 'system-sans', label: 'System', family: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
  { value: 'arial', label: 'Arial', family: 'Arial, sans-serif' },
  { value: 'helvetica', label: 'Helvetica', family: 'Helvetica, Arial, sans-serif' },
  { value: 'verdana', label: 'Verdana', family: 'Verdana, sans-serif' },
  { value: 'tahoma', label: 'Tahoma', family: 'Tahoma, sans-serif' },
  { value: 'trebuchet-ms', label: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
  { value: 'segoe-ui', label: 'Segoe UI', family: '"Segoe UI", sans-serif' },
  { value: 'calibri', label: 'Calibri', family: 'Calibri, sans-serif' },
  { value: 'avenir', label: 'Avenir', family: 'Avenir, "Avenir Next", sans-serif' },
  { value: 'futura', label: 'Futura', family: 'Futura, sans-serif' },
  { value: 'gill-sans', label: 'Gill Sans', family: '"Gill Sans", sans-serif' },
  { value: 'frutiger', label: 'Frutiger', family: 'Frutiger, sans-serif' },
  { value: 'noto-sans', label: 'Noto Sans', family: '"Noto Sans", sans-serif' },
  { value: 'open-sans', label: 'Open Sans', family: '"Open Sans", sans-serif' },
  { value: 'roboto', label: 'Roboto', family: 'Roboto, sans-serif' },
  { value: 'inter', label: 'Inter', family: 'Inter, sans-serif' },
  { value: 'montserrat', label: 'Montserrat', family: 'Montserrat, sans-serif' },
  { value: 'source-sans-pro', label: 'Source Sans Pro', family: '"Source Sans Pro", "Source Sans 3", sans-serif' },
  { value: 'ubuntu', label: 'Ubuntu', family: 'Ubuntu, sans-serif' },
  { value: 'dejavu-sans', label: 'DejaVu Sans', family: '"DejaVu Sans", sans-serif' },
  { value: 'liberation-sans', label: 'Liberation Sans', family: '"Liberation Sans", sans-serif' },
] as const
export const PRIMARY_FONT_CHOICES = ['monospace', 'sans-serif'] as const
export const CORNER_CHOICES = ['sharp', 'round'] as const
export const FONT_SIZE_CHOICES = [
  { value: 'small', label: 'small', size: '14px' },
  { value: 'regular', label: 'regular', size: '16px' },
  { value: 'large', label: 'large', size: '18px' },
  { value: 'larger', label: 'larger', size: '20px' },
] as const

export type ThemeChoice = typeof THEME_CHOICES[number]
export type AccentChoice = typeof ACCENT_CHOICES[number]
export type Appearance = { theme: ThemeChoice; accent: AccentChoice }
export type FontChoice = typeof FONT_CHOICES[number]['value']
export type SansSerifFontChoice = typeof SANS_SERIF_FONT_CHOICES[number]['value']
export type PrimaryFontChoice = typeof PRIMARY_FONT_CHOICES[number]
export type FontSizeChoice = typeof FONT_SIZE_CHOICES[number]['value']
export type CornerChoice = typeof CORNER_CHOICES[number]
export const EMBED_FONT_CHOICES = {
  system: 'system',
  sf: 'sf-mono',
  menlo: 'menlo',
  monaco: 'monaco',
  consolas: 'consolas',
  cascadia: 'cascadia-mono',
  courier: 'courier-new',
  lucida: 'lucida-console',
  dejavu: 'dejavu-sans-mono',
  liberation: 'liberation-mono',
  ubuntu: 'ubuntu-mono',
  noto: 'noto-sans-mono',
  droid: 'droid-sans-mono',
  source: 'source-code-pro',
  roboto: 'roboto-mono',
  fira: 'fira-mono',
  jetbrains: 'jetbrains-mono',
  hack: 'hack',
} as const satisfies Record<string, FontChoice>
export type EmbedFontChoice = keyof typeof EMBED_FONT_CHOICES

const appearanceContext = new AsyncLocalStorage<{ appearance: Appearance; request: Request }>()

const palettes = {
  light: { bg: '#f4f3ee', ink: '#20231f', muted: '#8a9085', soft: '#d9dbd4', accent: '#749668', accentDark: '#55734a',
    panel: '#ffffff', tagBg: '#e6e9df', quoteInk: '#6f766c', quoteBg: 'rgb(116 150 104 / 6%)',
    quoteSurface: 'color-mix(in srgb, rgb(116 150 104) 6%, var(--bg))', errorInk: '#7a3f39',
    linkBorder: '#afb4a9', buttonBg: '#273126', buttonInk: '#ffffff', buttonHoverBg: '#55734a',
    buttonActiveBg: '#405c38' },
  dark: { bg: '#171a17', ink: '#e5e8e1', muted: '#747c72', soft: '#343a33', accent: '#9abd8e', accentDark: '#b2d1a8',
    panel: '#20241f', tagBg: '#292f28', quoteInk: '#a8afa4', quoteBg: 'rgb(154 189 142 / 8%)',
    quoteSurface: 'color-mix(in srgb, rgb(154 189 142) 8%, var(--bg))', errorInk: '#efb3aa',
    linkBorder: '#50594d', buttonBg: '#3b503d', buttonInk: '#e5e8e1', buttonHoverBg: '#4b664d',
    buttonActiveBg: '#314434' },
  sepia: { bg: '#f4ecd8', ink: '#433422', muted: '#8c7a5e', soft: '#e0d4b8', accent: '#8a6d3b', accentDark: '#6b5228',
    panel: '#fbf6e9', tagBg: '#eae0c6', quoteInk: '#6b5a42', quoteBg: 'rgb(138 109 59 / 7%)',
    quoteSurface: 'color-mix(in srgb, rgb(138 109 59) 7%, var(--bg))', errorInk: '#8a3f39',
    linkBorder: '#c4b593', buttonBg: '#59482d', buttonInk: '#fbf6e9', buttonHoverBg: '#6b5228',
    buttonActiveBg: '#4b3a21' },
  dracula: { bg: '#282a36', ink: '#f8f8f2', muted: '#6272a4', soft: '#44475a', accent: '#bd93f9', accentDark: '#d6b3ff',
    panel: '#21222c', tagBg: '#343746', quoteInk: '#b9bcd0', quoteBg: 'rgb(189 147 249 / 10%)',
    quoteSurface: 'color-mix(in srgb, rgb(189 147 249) 10%, var(--bg))', errorInk: '#ff5555',
    linkBorder: '#4b4f6b', buttonBg: '#554276', buttonInk: '#f8f8f2', buttonHoverBg: '#684f91',
    buttonActiveBg: '#463660' },
} as const

const accents = {
  sage: ['#749668', '#9abd8e'],
  purple: ['#7c5cbf', '#bd93f9'],
  cyan: ['#2f7f8f', '#8be9fd'],
  pink: ['#b5487f', '#ff79c6'],
  amber: ['#9a6614', '#ffb86c'],
  blue: ['#3a6ea5', '#7aa2f7'],
  rust: ['#a33b32', '#ff7b72'],
} as const

export function appearance(request: Request): Appearance {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)appearance=([^;]+)/)?.[1] || ''
  const [themeValue, accentValue] = value.split('.')
  return {
    theme: THEME_CHOICES.includes(themeValue as ThemeChoice) ? themeValue as ThemeChoice : 'system',
    accent: ACCENT_CHOICES.includes(accentValue as AccentChoice) ? accentValue as AccentChoice : 'theme',
  }
}

export function withAppearance<T>(request: Request, callback: () => T) {
  return appearanceContext.run({ appearance: appearance(request), request }, callback)
}

export function activeRequest() {
  return appearanceContext.getStore()?.request || new Request('http://localhost')
}

export function activeAppearance() {
  return appearanceContext.getStore()?.appearance || { theme: 'system', accent: 'theme' } as Appearance
}

export function activeThemeStyles() {
  const request = appearanceContext.getStore()?.request || new Request('http://localhost')
  return themeStyles(request)
}

export function activeThemeLogoSvg() {
  const request = appearanceContext.getStore()?.request || new Request('http://localhost')
  return themeLogoSvg(request)
}

export function activeThemeBackgrounds() {
  const selected = activeAppearance()
  if (selected.theme === 'system') return { light: palettes.light.bg, dark: palettes.dark.bg }
  return { default: palettes[selected.theme].bg }
}

export function versionedAppearance(value: string | null | undefined): Appearance | null {
  if (!value) return null
  const [theme, accent, extra] = value.split('.')
  if (extra !== undefined || !THEME_CHOICES.includes(theme as ThemeChoice)
    || !ACCENT_CHOICES.includes(accent as AccentChoice)) return null
  return { theme: theme as ThemeChoice, accent: accent as AccentChoice }
}

export function appearanceCookie(value: Appearance, appUrl: string | undefined = Bun.env.APP_URL) {
  let secure = ''
  try {
    secure = appUrl && new URL(appUrl).protocol === 'https:' ? '; Secure' : ''
  }
  catch {}
  return `appearance=${value.theme}.${value.accent}; Max-Age=${
    365 * 24 * 60 * 60
  }; HttpOnly; Path=/; SameSite=Lax${secure}`
}

export function fontChoice(request: Request): FontChoice {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)font=([^;]+)/)?.[1] || ''
  return FONT_CHOICES.some(font => font.value === value) ? value as FontChoice : 'system'
}

export function fontCookie(value: FontChoice, appUrl: string | undefined = Bun.env.APP_URL) {
  let secure = ''
  try {
    secure = appUrl && new URL(appUrl).protocol === 'https:' ? '; Secure' : ''
  }
  catch {}
  return `font=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secure}`
}

export function sansSerifFontChoice(request: Request): SansSerifFontChoice {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)sans-serif-font=([^;]+)/)?.[1] || ''
  return SANS_SERIF_FONT_CHOICES.some(font => font.value === value) ? value as SansSerifFontChoice : 'system-sans'
}

export function sansSerifFontCookie(value: SansSerifFontChoice, appUrl: string | undefined = Bun.env.APP_URL) {
  return preferenceCookie('sans-serif-font', value, appUrl)
}

export function primaryFontChoice(request: Request): PrimaryFontChoice {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)primary-font=([^;]+)/)?.[1] || ''
  return PRIMARY_FONT_CHOICES.includes(value as PrimaryFontChoice) ? value as PrimaryFontChoice : 'monospace'
}

export function primaryFontCookie(value: PrimaryFontChoice, appUrl: string | undefined = Bun.env.APP_URL) {
  return preferenceCookie('primary-font', value, appUrl)
}

function preferenceCookie(name: string, value: string, appUrl: string | undefined) {
  let secure = ''
  try {
    secure = appUrl && new URL(appUrl).protocol === 'https:' ? '; Secure' : ''
  }
  catch {}
  return `${name}=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secure}`
}

export function fontSizeChoice(request: Request): FontSizeChoice {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)font-size=([^;]+)/)?.[1] || ''
  return FONT_SIZE_CHOICES.some(choice => choice.value === value) ? value as FontSizeChoice : 'regular'
}

export function fontSizeCookie(value: FontSizeChoice, appUrl: string | undefined = Bun.env.APP_URL) {
  let secure = ''
  try {
    secure = appUrl && new URL(appUrl).protocol === 'https:' ? '; Secure' : ''
  }
  catch {}
  return `font-size=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secure}`
}

export function cornerChoice(request: Request): CornerChoice {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)corners=([^;]+)/)?.[1] || ''
  return CORNER_CHOICES.includes(value as CornerChoice) ? value as CornerChoice : 'sharp'
}

export function cornerCookie(value: CornerChoice, appUrl: string | undefined = Bun.env.APP_URL) {
  return preferenceCookie('corners', value, appUrl)
}

function rules(name: keyof typeof palettes, accentChoice: AccentChoice) {
  const p = palettes[name]
  const dark = name === 'dark' || name === 'dracula'
  const semantic = dark
    ? {
      tabHover: '#b4bab0',
      disabledBg: '#292f29',
      disabledInk: '#747c72',
      dangerBg: '#663b37',
      dangerHover: '#7a4741',
      dangerActive: '#56312e',
      dangerLinkHover: '#ffc8bf',
      reportInk: '#e5a85f',
      reportHover: '#ffc37d',
      errorBg: '#442b28',
      successInk: '#b9d5b2',
      successBg: '#293b28',
      apiPostInk: '#a8d5ed',
      apiPostBg: '#263b46',
      apiPatchInk: '#f0c878',
      apiPatchBg: '#443921',
      apiDeleteInk: '#f0aaa1',
      apiDeleteBg: '#472c29',
    }
    : {
      tabHover: '#a2a79e',
      disabledBg: '#d9dbd4',
      disabledInk: '#777d73',
      dangerBg: '#7a3f39',
      dangerHover: '#65332e',
      dangerActive: '#542a26',
      dangerLinkHover: '#542a26',
      reportInk: '#a05f19',
      reportHover: '#77440f',
      errorBg: '#eee2de',
      successInk: '#466342',
      successBg: '#e3eadf',
      apiPostInk: '#315f7a',
      apiPostBg: '#e1edf3',
      apiPatchInk: '#805b16',
      apiPatchBg: '#f3ead5',
      apiDeleteInk: '#8a3f37',
      apiDeleteBg: '#f1dfdc',
    }
  const accent = accentChoice === 'theme' ? p.accent : accents[accentChoice][dark ? 1 : 0]
  const button = accentChoice === 'theme'
    ? {
      bg: p.buttonBg,
      hover: p.buttonHoverBg,
      active: p.buttonActiveBg,
    }
    : dark
    ? {
      bg: mix(accent, p.bg, .45),
      hover: mix(accent, p.bg, .55),
      active: mix(accent, p.bg, .35),
    }
    : {
      bg: mix(accent, p.ink, .60),
      hover: mix(accent, p.ink, .70),
      active: mix(accent, p.ink, .50),
    }
  const mutedButton = dark
    ? {
      bg: mix(accent, p.bg, .35),
      hover: mix(accent, p.bg, .45),
      active: mix(accent, p.bg, .25),
    }
    : {
      bg: mix(accent, p.ink, .45),
      hover: mix(accent, p.ink, .55),
      active: mix(accent, p.ink, .35),
    }
  return `:root{color-scheme:${
    dark ? 'dark' : 'light'
  };--font-emoji:"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", emoji;--font-monospace:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace, var(--font-emoji);--font-sans-serif:ui-sans-serif, system-ui, -apple-system, sans-serif, var(--font-emoji);--font-primary:var(--font-monospace);--bg:${p.bg};--ink:${p.ink};--muted:${p.muted};--tab-hover:${semantic.tabHover};--soft:${p.soft};--accent:${accent};--accent-dark:${
    accentChoice === 'theme' ? p.accentDark : accent
  };--selection-bg:${accent};--selection-ink:${p.bg};--panel:${p.panel};--pagination-hover-bg:${p.tagBg};--link-border:${p.linkBorder};--button-bg:${button.bg};--button-ink:${p.buttonInk};--button-hover-bg:${button.hover};--button-active-bg:${button.active};--button-muted-bg:${mutedButton.bg};--button-muted-hover-bg:${mutedButton.hover};--button-muted-active-bg:${mutedButton.active};--button-disabled-bg:${semantic.disabledBg};--button-disabled-ink:${semantic.disabledInk};--danger-button-bg:${semantic.dangerBg};--danger-button-hover-bg:${semantic.dangerHover};--danger-button-active-bg:${semantic.dangerActive};--danger-link-hover:${semantic.dangerLinkHover};--report-ink:${semantic.reportInk};--report-hover:${semantic.reportHover};--quote-ink:${p.quoteInk};--quote-bg:${p.quoteBg};--quote-surface:${p.quoteSurface};--error-ink:${p.errorInk};--error-bg:${semantic.errorBg};--success-ink:${semantic.successInk};--success-bg:${semantic.successBg};--tag-bg:${p.tagBg};--api-post-ink:${semantic.apiPostInk};--api-post-bg:${semantic.apiPostBg};--api-patch-ink:${semantic.apiPatchInk};--api-patch-bg:${semantic.apiPatchBg};--api-delete-ink:${semantic.apiDeleteInk};--api-delete-bg:${semantic.apiDeleteBg}}`
}

function mix(foreground: string, background: string, amount: number) {
  const channel = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map(offset =>
    Math.round(
      channel(foreground, offset) * amount + channel(background, offset) * (1 - amount),
    ).toString(16).padStart(2, '0')
  )
  return `#${mixed.join('')}`
}

export function themeStyles(request: Request) {
  const url = new URL(request.url)
  const requestedTheme = url.searchParams.get('theme')
  const requestedAccent = url.searchParams.get('accent')
  const selected = requestedTheme || requestedAccent
    ? {
      theme: THEME_CHOICES.includes(requestedTheme as ThemeChoice) ? requestedTheme as ThemeChoice : 'system',
      accent: ACCENT_CHOICES.includes(requestedAccent as AccentChoice) ? requestedAccent as AccentChoice : 'theme',
    }
    : appearance(request)
  const requestedFont = url.searchParams.get('font')
  const selectedFont = requestedFont
    ? EMBED_FONT_CHOICES[requestedFont as EmbedFontChoice] || 'system'
    : fontChoice(request)
  const font = selectedFont === 'system' && isMobileRequest(request)
    ? { ...FONT_CHOICES[0], family: '"DejaVu Sans Mono", monospace' }
    : FONT_CHOICES.find(choice => choice.value === selectedFont) || FONT_CHOICES[0]
  const sansSerifFont = SANS_SERIF_FONT_CHOICES.find(choice => choice.value === sansSerifFontChoice(request))
    || SANS_SERIF_FONT_CHOICES[0]
  const primaryFont = requestedFont ? 'monospace' : primaryFontChoice(request)
  const fontSize = FONT_SIZE_CHOICES.find(choice => choice.value === fontSizeChoice(request)) || FONT_SIZE_CHOICES[1]
  const fontRule =
    `:root{--font-monospace:${font.family}, var(--font-emoji);--font-sans-serif:${sansSerifFont.family}, var(--font-emoji);--font-primary:var(--font-${primaryFont});font-family:var(--font-primary);font-size:${fontSize.size}}html,body{font-family:var(--font-primary)}.emoji{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI Symbol","Noto Sans Symbols 2",sans-serif}`
  if (selected.theme === 'system') {
    return `${rules('light', selected.accent)}@media(prefers-color-scheme:dark){${
      rules('dark', selected.accent)
    }}${fontRule}`
  }
  return rules(selected.theme, selected.accent) + fontRule
}

function accentFor(name: keyof typeof palettes, choice: AccentChoice) {
  if (choice === 'theme') return palettes[name].accent
  return accents[choice][name === 'dark' || name === 'dracula' ? 1 : 0]
}

export function themeLogoSvg(request: Request, selected: Appearance = appearance(request)) {
  const drawing =
    'M13,19V16H21V19H13M8.5,13L2.47,7H6.71L11.67,11.95C12.25,12.54 12.25,13.5 11.67,14.07L6.74,19H2.5L8.5,13Z'
  if (selected.theme === 'system') {
    const light = accentFor('light', selected.accent)
    const dark = accentFor('dark', selected.accent)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>path{fill:${light}}@media(prefers-color-scheme:dark){path{fill:${dark}}}</style><path d="${drawing}"/></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${
    accentFor(selected.theme, selected.accent)
  }" d="${drawing}"/></svg>`
}
import { AsyncLocalStorage } from 'node:async_hooks'
import { isMobileRequest } from './user-agent'
