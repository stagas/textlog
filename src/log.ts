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
  return Boolean(process.stdout.isTTY) && !('NO_COLOR' in Bun.env) && Bun.env.LOG_COLOR !== 'false'
}

function paint(value: string, color: Color) {
  return colorsEnabled() ? `${ansi[color]}${value}${ansi.reset}` : value
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
]

export function semanticAction(method: string, path: string) {
  if (method !== 'POST') return undefined
  const pathname = path.split('?', 1)[0]
  return actionRoutes.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'http.mutate'
}

export function shouldLogHttp(path: string, status: number) {
  return path !== '/__dev/restart' || status >= 400
}

export function clientIp(request: Request, socketIp?: string) {
  if (Bun.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
    return forwarded || request.headers.get('cf-connecting-ip')?.trim()
      || request.headers.get('x-real-ip')?.trim() || socketIp || '-'
  }
  return socketIp || '-'
}

export function logHttp(method: string, path: string, status: number, durationMs: number, ip = '-') {
  const action = semanticAction(method, path)
  const timing = durationMs < 1000 ? `${durationMs.toFixed(0)}ms` : `${(durationMs / 1000).toFixed(2)}s`
  const parts = [
    paint('http', 'dim'),
    paint(method.padEnd(6), 'blue'),
    paint(String(status), statusColor(status)),
    paint(timing.padStart(7), durationMs >= 1000 ? 'yellow' : 'dim'),
    paint(logIpPseudonym(ip), 'dim'),
    path,
  ]
  if (action) parts.push(paint(action, status >= 400 ? 'yellow' : 'magenta'))
  console.log(parts.join('  '))
}

export function logError(message: string, error: unknown) {
  const detail = error instanceof Error ? error.stack || error.message : String(error)
  console.error(`${paint('error', 'red')}  ${message}\n${paint(detail, 'dim')}`)
}

export function logReady(url: string, environment: string) {
  console.log(
    `${paint('ready', 'green')} ${paint('◆', 'magenta')} textlog listening on ${paint(url, 'cyan')} ${
      paint(`(${environment})`, 'dim')
    }`,
  )
}
import { logIpPseudonym } from './ip-privacy'
