import { backgroundDatabaseCall, databaseService } from './database-service'

type MaterializedFeedKind = 'latest' | 'hot' | 'for-you' | 'to-me'

function refreshMaterializedTimestamps(html: string, now = Date.now()) {
  return html.replace(/<time\b([^>]*)>([^<]*)<\/time>/g, (time, attributes) => {
    const dateTime = attributes.match(/\bdateTime=(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean)
    if (!dateTime) return time
    const seconds = Math.max(0, Math.floor((now - new Date(dateTime.replace(' ', 'T') + 'Z').getTime()) / 1000))
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const value = seconds < 60 ? `${Math.max(1, seconds)}s` : minutes < 60 ? `${minutes}m`
      : hours < 24 ? `${hours}h` : days < 30 ? `${days}d` : months < 12 ? `${months}mo`
      : `${Math.floor(days / 365)}y`
    return `<time${attributes}>${value}</time>`
  })
}

function appearanceVariant(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const names = ['appearance', 'font', 'sans-serif-font', 'primary-font', 'font-size', 'notification_device']
  return names.map(name => cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || '').join('|')
}

export async function rpcMaterializedFeedPage(request: Request, kind: MaterializedFeedKind, viewerId: number,
  render: () => Response | Promise<Response>, rerenderForCache = false, cacheVersion = 0, background = false,
  renderForCache?: () => Response | Promise<Response>)
{
  if (Bun.env.DEV_RELOAD === 'true') return await render()
  const variant = `${cacheVersion ? `${cacheVersion}|` : ''}${appearanceVariant(request)}`
  const call = background ? backgroundDatabaseCall : databaseService().call.bind(databaseService())
  const cached = await call('cache.materializedFeedGet', { kind, viewerId, variant })
  if (cached.html) return new Response(refreshMaterializedTimestamps(cached.html), {
    headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'private, no-store' },
  })
  const response = await render()
  if (response.status !== 200) return response
  const html = await response.text()
  const cachedHtml = renderForCache ? await (await renderForCache()).text()
    : rerenderForCache ? await (await render()).text() : html
  await call('cache.materializedFeedPut', {
    kind, viewerId, variant, generation: cached.generation, html: cachedHtml,
  })
  return new Response(html, { status: response.status, headers: response.headers })
}
