import { createHash, randomUUID } from 'node:crypto'
import svgCaptcha from 'svg-captcha'

export const NESTED_FROM_MAX_DEPTH = 4
export const NAVIGATION_CAPTCHA_LIFETIME_MS = 5 * 60 * 1000

type Challenge = { address: string; answerHash: string; expiresAt: number }

const answerHash = (token: string, answer: string) =>
  createHash('sha256')
    .update(`textlog navigation captcha\0${token}\0${answer.trim().toLowerCase()}`)
    .digest('hex')

/** Counts local navigation links nested through `from`, including a `/enter` `next` destination. */
export function nestedFromDepth(requestUrl: string, maximum = NESTED_FROM_MAX_DEPTH) {
  let url: URL
  try {
    url = new URL(requestUrl)
  }
  catch {
    return 0
  }

  let depth = 0
  let from = url.searchParams.get('from')
  if (from === null && url.pathname === '/enter') from = url.searchParams.get('next')
  while (from !== null && depth < maximum) {
    depth++
    try {
      from = new URL(from, url.origin).searchParams.get('from')
    }
    catch {
      break
    }
  }
  return depth
}

export class NavigationCaptchaChallenges {
  private readonly challenges = new Map<string, Challenge>()

  constructor(
    private readonly generate: () => { text: string; data: string } = () =>
      svgCaptcha.create({ size: 6, noise: 3, color: true, background: '#f4f1ea' }),
  ) {}

  issue(address: string, now = Date.now()) {
    this.removeExpired(now)
    const generated = this.generate()
    const token = randomUUID()
    this.challenges.set(token, {
      address,
      answerHash: answerHash(token, generated.text),
      expiresAt: now + NAVIGATION_CAPTCHA_LIFETIME_MS,
    })
    return { token, image: `data:image/svg+xml;base64,${Buffer.from(generated.data).toString('base64')}` }
  }

  consume(address: string, token: string, answer: string, now = Date.now()) {
    if (!token || !answer) return false
    const challenge = this.challenges.get(token)
    this.challenges.delete(token)
    return Boolean(challenge && challenge.address === address && challenge.expiresAt > now
      && challenge.answerHash === answerHash(token, answer))
  }

  private removeExpired(now: number) {
    for (const [token, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(token)
    }
  }
}

/** Keeps an address behind the challenge after it triggers suspicious navigation. */
export class NavigationCaptchaGate {
  private readonly required = new Map<string, string>()

  require(address: string, at = new Date()) {
    if (address && address !== '-') this.required.set(address, at.toISOString().slice(0, 10))
  }

  check(address: string, at = new Date()) {
    if (!address || address === '-') return false
    const day = at.toISOString().slice(0, 10)
    const requiredDay = this.required.get(address)
    if (requiredDay && requiredDay !== day) this.required.delete(address)
    return requiredDay === day
  }

  allow(address: string) {
    this.required.delete(address)
  }
}
