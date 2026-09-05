import { randomUUID } from 'node:crypto'
import { sessionCookieName } from './brand'
import { campaignIpPseudonym } from './ip-privacy'
import { ACCENT_CHOICES, CORNER_CHOICES, FONT_CHOICES, PRIMARY_FONT_CHOICES, SANS_SERIF_FONT_CHOICES,
  THEME_CHOICES } from './theme'

export type AppearanceExperimentChoice = {
  theme: typeof THEME_CHOICES[number]
  accent: typeof ACCENT_CHOICES[number]
  primaryFont: typeof PRIMARY_FONT_CHOICES[number]
  font: typeof FONT_CHOICES[number]['value']
  sansSerifFont: typeof SANS_SERIF_FONT_CHOICES[number]['value']
  corners: typeof CORNER_CHOICES[number]
}

const randomChoice = <T,>(choices: readonly T[]) => choices[Math.floor(Math.random() * choices.length)]!

export function randomAppearanceExperimentChoice(): AppearanceExperimentChoice {
  return {
    theme: randomChoice(THEME_CHOICES),
    accent: randomChoice(ACCENT_CHOICES),
    primaryFont: randomChoice(PRIMARY_FONT_CHOICES),
    font: randomChoice(FONT_CHOICES).value,
    sansSerifFont: randomChoice(SANS_SERIF_FONT_CHOICES).value,
    corners: randomChoice(CORNER_CHOICES),
  }
}

export function appearanceExperimentCandidate(request: Request) {
  const cookies = request.headers.get('cookie') || ''
  return !new RegExp(`(?:^|;\\s*)${sessionCookieName()}=`).test(cookies)
    && !/(?:^|;\s*)appearance=/.test(cookies)
    && !/(?:^|;\s*)appearance_experiment=/.test(cookies)
}

export function appearanceExperimentToken(request: Request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)appearance_experiment=([^;]+)/)?.[1] || null
}

export function appearanceExperimentCookie(value: string, requestUrl: string, maxAge = 31_536_000) {
  let secure = ''
  try {
    if (new URL(Bun.env.APP_URL || requestUrl).protocol === 'https:') secure = '; Secure'
  }
  catch {}
  return `appearance_experiment=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secure}`
}

export function newAppearanceExperimentToken() {
  return randomUUID()
}

export function appearanceExperimentVisitorHash(address: string) {
  return campaignIpPseudonym(address, 'appearance-experiment')
}

export type AppearanceExperimentRanking = {
  category: 'theme' | 'accent' | 'font' | 'corners'
  value: string
  label: string
  pageVisits: number
  medianPageVisits: number
  averagePageVisits: number
  users: number
}
