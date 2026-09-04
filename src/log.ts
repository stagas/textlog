import { logIpPseudonym } from './ip-privacy'
import { hasLogSubscribers } from './log-stream'

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

type Color = keyof typeof ansi

function colorsEnabled() {
  return (Boolean(process.stdout.isTTY) || hasLogSubscribers())
    && !('NO_COLOR' in Bun.env) && Bun.env.LOG_COLOR !== 'false'
}

function paint(value: string, color: Color) {
  return colorsEnabled() ? `${ansi[color]}${value}${ansi.reset}` : value
}

const ipColors = [
  33, 39, 44, 45, 48, 49, 69, 75, 81, 84, 87, 111,
  117, 141, 147, 171, 177, 207, 213, 214, 219, 220,
]

export function ipColor(pseudonym: string) {
  if (pseudonym === '-') return null
  let hash = 0
  for (const character of pseudonym) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return ipColors[hash % ipColors.length]
}

function paintIp(pseudonym: string) {
  const color = ipColor(pseudonym)
  return colorsEnabled() && color !== null ? `\x1b[38;5;${color}m${pseudonym}${ansi.reset}` : pseudonym
}

function statusColor(status: number): Color {
  if (status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  if (status >= 300) return 'cyan'
  return 'green'
}

const actionRoutes: Array<[RegExp, string]> = [
  [/^\/enter$/, 'auth.magic_link.request'],
  [/^\/choose-handle$/, 'auth.handle.choose'],
  [/^\/logout$/, 'auth.logout'],
  [/^\/account\/email\/change$/, 'account.email.change'],
  [/^\/account\/sessions\/revoke$/, 'account.session.revoke'],
  [/^\/account\/sessions\/revoke-others$/, 'account.sessions.revoke_others'],
  [/^\/account\/delete$/, 'account.delete'],
  [/^\/post$/, 'post.create'],
  [/^\/post\/\d+\/reply$/, 'post.reply'],
  [/^\/post\/\d+\/edit$/, 'post.edit'],
  [/^\/post\/\d+\/delete$/, 'post.delete'],
  [/^\/post\/\d+\/report$/, 'post.report'],
  [/^\/follow\/[^/]+$/, 'user.follow.toggle'],
  [/^\/block\/[^/]+$/, 'user.block.toggle'],
  [/^\/tag-follow\/[^/]+$/, 'tag.follow.toggle'],
  [/^\/tag-block\/[^/]+$/, 'tag.block.toggle'],
  [/^\/u\/[^/]+\/profile$/, 'profile.update'],
  [/^\/admin\/reports\/\d+\/resolve$/, 'admin.report.resolve'],
  [/^\/admin\/reports\/\d+\/dismiss$/, 'admin.report.dismiss'],
  [/^\/admin\/posts\/\d+\/delete$/, 'admin.post.delete'],
  [/^\/admin\/users\/\d+\/suspend$/, 'admin.user.suspend'],
  [/^\/admin\/users\/\d+\/restore$/, 'admin.user.restore'],
  [/^\/admin\/users\/\d+\/delete$/, 'admin.user.delete'],
  [/^\/admin\/ip-blocks$/, 'admin.ip.block'],
  [/^\/admin\/push$/, 'admin.push.send'],
]

export function semanticAction(method: string, path: string) {
  if (method !== 'POST') return undefined
  const pathname = path.split('?', 1)[0]
  return actionRoutes.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'http.mutate'
}

export function shouldLogHttp(path: string, status: number, isCrawler = false, authenticated = false, campaign = false,
  browserAllowlisted = false)
{
  return (browserAllowlisted
    || !isCrawler && (path === '/styles.css' || authenticated || Bun.env.LOG_ANONYMOUS !== 'false'
        || campaign && Bun.env.LOG_CAMPAIGN === 'true'))
    && (!['/__dev/restart', '/navigation-check'].includes(path) || status >= 400)
}

export function redactHttpPath(value: string) {
  return value.replace(/^\/feeds\/(?:my-feed|for-you)\/[^?]+/, match => {
    const format = match.endsWith('.atom') ? '.atom' : match.endsWith('.rss') ? '.rss' : ''
    const prefix = match.startsWith('/feeds/for-you/') ? '/feeds/for-you' : '/feeds/my-feed'
    return `${prefix}/[redacted]${format}`
  })
}

export function clientIp(request: Request, socketIp?: string) {
  if (Bun.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
    return forwarded || request.headers.get('cf-connecting-ip')?.trim()
      || request.headers.get('x-real-ip')?.trim() || socketIp || '-'
  }
  return socketIp || '-'
}

export function logHttp(method: string, path: string, status: number, durationMs: number, ip = '-', username?: string,
  userAgent = '-', feedCache?: string | null)
{
  const action = semanticAction(method, path)
  const pseudonym = logIpPseudonym(ip)
  const timing = durationMs < 1000 ? `${durationMs.toFixed(0)}ms` : `${(durationMs / 1000).toFixed(2)}s`
  const parts = [
    paint('http', 'dim'),
    paint(method.padEnd(6), 'blue'),
    paint(String(status), statusColor(status)),
    paint(timing.padStart(7), durationMs >= 1000 ? 'yellow' : 'dim'),
    paintIp(pseudonym),
    paint(username ? `@${username}` : '-', 'dim'),
    path,
  ]
  if (action) parts.push(paint(action, status >= 400 ? 'yellow' : 'magenta'))
  if (feedCache) parts.push(paint(`feed_cache=${feedCache}`, 'dim'))
  if (Bun.env.LOG_USER_AGENT !== 'false') {
    const safeUserAgent = userAgent.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) || '-'
    parts.push(paint(`ua=${JSON.stringify(safeUserAgent)}`, 'dim'))
  }
  console.log(parts.join('  '))
}

export function logError(message: string, error: unknown) {
  const detail = error instanceof Error ? error.stack || error.message : String(error)
  console.error(`${paint('error', 'red')}  ${message}\n${paint(detail, 'dim')}`)
}

export function logInfo(message: string) {
  console.log(`${paint('info', 'cyan')}   ${message}`)
}

export function logReady(url: string, environment: string) {
  console.log(
    `${paint('ready', 'green')} ${paint('◆', 'magenta')} textlog listening on ${paint(url, 'cyan')} ${
      paint(`(${environment})`, 'dim')
    }`,
  )
}
