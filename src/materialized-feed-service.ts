import { backgroundDatabaseCall, databaseService } from './database-service'

type MaterializedFeedKind = 'latest' | 'hot' | 'for-you' | 'to-me' | 'about'

type MaterializedResponse = {
  body: string
  headers: [string, string][]
  status: number
}

const materializations = new Map<string, Promise<MaterializedResponse>>()
const revalidations = new Map<string, Promise<void>>()
type MemoryMaterialization = MaterializedResponse & {
  expiresAt: number
  hitActionDone: boolean
}
const memoryMaterializations = new Map<string, MemoryMaterialization>()
const MAX_MEMORY_MATERIALIZATIONS = 256
const ANONYMOUS_MEMORY_TTL_MS = 30_000
const PERSONALIZED_MEMORY_TTL_MS = 500
const MATERIALIZED_HTML_VERSION = 23

function memoryCacheEnabled() {
  // Integration tests mutate their SQLite fixture directly, bypassing the runtime service and its normal cache
  // invalidation path. Keep those assertions strongly consistent while allowing the disposable route benchmark to
  // opt into the production cache explicitly.
  return Bun.env.NODE_ENV !== 'test' || Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE === 'true'
}

function rememberMaterialization(key: string, result: MaterializedResponse, viewerId: number) {
  const entry: MemoryMaterialization = { ...result,
    expiresAt: Date.now() + (viewerId < 0 ? ANONYMOUS_MEMORY_TTL_MS : PERSONALIZED_MEMORY_TTL_MS),
    hitActionDone: false }
  memoryMaterializations.delete(key)
  memoryMaterializations.set(key, entry)
  while (memoryMaterializations.size > MAX_MEMORY_MATERIALIZATIONS) {
    memoryMaterializations.delete(memoryMaterializations.keys().next().value!)
  }
  return entry
}

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
  const memory = memoryCacheEnabled() ? memoryMaterializations.get(key) : undefined
  if (memory && memory.expiresAt > Date.now()) {
    memoryMaterializations.delete(key)
    memoryMaterializations.set(key, memory)
    if (!memory.hitActionDone && onCacheHit) {
      memory.hitActionDone = true
      await onCacheHit()
    }
    const headers = new Headers(memory.headers)
    headers.set('x-feed-cache', 'memory')
    return new Response(memory.body, { status: memory.status, headers })
  }
  if (memory) memoryMaterializations.delete(key)
  let materialization = materializations.get(key)
  if (!materialization) {
    materialization = (async () => {
      const cached = await call('cache.materializedFeedGet', { kind, viewerId, variant })
      if (cached.html) {
        await onCacheHit?.()
        if (cached.stale && !revalidations.has(key)) {
          const revalidation = (async () => {
            const response = await render()
            if (response.status !== 200) return
            const html = await response.text()
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
          })()
          revalidations.set(key, revalidation)
          void revalidation.finally(() => {
            if (revalidations.get(key) === revalidation) revalidations.delete(key)
          }).catch(error => console.error(`Could not refresh stale ${kind} feed`, error))
        }
        return { body: cached.html, status: 200,
          headers: [['content-type', 'text/html;charset=utf-8'], ['cache-control', 'private, no-store'],
            ['x-feed-cache', cached.stale ? 'stale' : 'durable']] }
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
      return { body: html, status: response.status, headers: [...response.headers.entries(), ['x-feed-cache', 'miss']] }
    })()
    materializations.set(key, materialization)
    void materialization.finally(() => {
      if (materializations.get(key) === materialization) materializations.delete(key)
    }).catch(() => {})
  }
  const result = await materialization
  if (!memoryCacheEnabled()) return new Response(result.body, { status: result.status, headers: result.headers })
  const remembered = rememberMaterialization(key, result, viewerId)
  return new Response(remembered.body, { status: remembered.status, headers: remembered.headers })
}
