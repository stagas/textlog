import { backgroundDatabaseCall, databaseService } from './database-service'

type MaterializedFeedKind = 'latest' | 'hot' | 'for-you' | 'to-me' | 'about'

type MaterializedResponse = {
  body: string
  headers: [string, string][]
  status: number
}

const materializations = new Map<string, Promise<MaterializedResponse>>()
const MATERIALIZED_HTML_VERSION = 22

function appearanceVariant(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const names = ['appearance', 'font', 'sans-serif-font', 'primary-font', 'font-size', 'notification_device',
    'donation_banner_dismissed']
  return names.map(name => cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || '').join('|')
}

export async function rpcMaterializedFeedPage(request: Request, kind: MaterializedFeedKind, viewerId: number,
  render: () => Response | Promise<Response>, rerenderForCache = false, cacheVersion = 0, background = false,
  renderForCache?: () => Response | Promise<Response>, onCacheHit?: () => void | Promise<void>)
{
  if (Bun.env.DEV_RELOAD === 'true') return await render()
  const variant = `${MATERIALIZED_HTML_VERSION}|${cacheVersion ? `${cacheVersion}|` : ''}${appearanceVariant(request)}`
  const call = background ? backgroundDatabaseCall : databaseService().call.bind(databaseService())
  const key = `${background ? 'background' : 'foreground'}\0${kind}\0${viewerId}\0${variant}`
  let materialization = materializations.get(key)
  if (!materialization) {
    materialization = (async () => {
      const cached = await call('cache.materializedFeedGet', { kind, viewerId, variant })
      if (cached.html) {
        await onCacheHit?.()
        return { body: cached.html, status: 200,
          headers: [['content-type', 'text/html;charset=utf-8'], ['cache-control', 'private, no-store']] }
      }
      const response = await render()
      const html = await response.text()
      if (response.status === 200) {
        const cachedHtml = renderForCache
          ? await (await renderForCache()).text()
          : rerenderForCache
          ? await (await render()).text()
          : html
        await call('cache.materializedFeedPut', {
          kind,
          viewerId,
          variant,
          generation: cached.generation,
          html: cachedHtml,
        })
      }
      return { body: html, status: response.status, headers: [...response.headers.entries()] }
    })()
    materializations.set(key, materialization)
    void materialization.finally(() => {
      if (materializations.get(key) === materialization) materializations.delete(key)
    }).catch(() => {})
  }
  const result = await materialization
  return new Response(result.body, { status: result.status, headers: result.headers })
}
