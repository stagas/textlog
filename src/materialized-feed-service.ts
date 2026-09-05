import { backgroundDatabaseCall, databaseService, subscribeToFeedMutations } from './database-service'
import { locationMapProvider } from './locations'
import { isMobileRequest } from './user-agent'

type MaterializedFeedKind = 'latest' | 'new' | 'hot' | 'for-you' | 'to-me' | 'about'

type MaterializedResponse = {
  body: string
  memoryBody?: string
  headers: [string, string][]
  status: number
}

const materializations = new Map<string, Promise<MaterializedResponse>>()
const revalidations = new Map<string, Promise<void>>()
type MemoryMaterialization = MaterializedResponse & {
  hitActionDone: boolean
}
const memoryMaterializations = new Map<string, MemoryMaterialization>()
const MAX_MEMORY_MATERIALIZATIONS = 256
const MATERIALIZED_HTML_VERSION = 48
let memoryGeneration = 0

export function invalidateMaterializedFeedMemory() {
  memoryGeneration++
  memoryMaterializations.clear()
  materializations.clear()
}

subscribeToFeedMutations(invalidateMaterializedFeedMemory)

function memoryCacheEnabled() {
  // Integration tests mutate their SQLite fixture directly, bypassing the runtime service and its normal cache
  // invalidation path. Keep those assertions strongly consistent while allowing the disposable route benchmark to
  // opt into the production cache explicitly.
  return Bun.env.NODE_ENV !== 'test' || Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE === 'true'
}

function rememberMaterialization(key: string, result: MaterializedResponse, viewerId: number) {
  const body = result.memoryBody ?? result.body
  const entry: MemoryMaterialization = { ...result, body: materializedBody(body, viewerId), hitActionDone: false }
  memoryMaterializations.delete(key)
  memoryMaterializations.set(key, entry)
  while (memoryMaterializations.size > MAX_MEMORY_MATERIALIZATIONS) {
    memoryMaterializations.delete(memoryMaterializations.keys().next().value!)
  }
  return entry
}

export function materializedBody(html: string, viewerId: number) {
  if (viewerId < 0) return html
  const token = (source: string, path: string, label: string, name: string) =>
    source.replace(
      new RegExp(`(<a[^>]*href="${path}"[^>]*>${label})(?:<span class="to-me-count">\\d+\\+?</span>)?(</a>)`),
      `$1{{${name}-count}}$2`,
    )
  const accountTokens = html.replace(
    /(<form\b[^>]*action="\/account\/accounts\/select"[^>]*>[\s\S]*?<input\b[^>]*name="accountId"\s+value="(\d+)"[^>]*>[\s\S]*?<button\b[^>]*class="account-menu-account"[^>]*>)(?:<span class="unread-dot"\s+aria-label="unread activity"><\/span>)?/g,
    (_match, prefix: string, accountId: string) => `${prefix}{{account-${accountId}-unread}}`,
  ).replace(
    /(<(?:summary|a)\b[^>]*class="account-menu-handle"[^>]*>)(?:\s*<span class="unread-dot"\s+aria-label="unread account activity"><\/span>)?/,
    '$1{{linked-account-unread}}',
  )
  return token(token(token(accountTokens, '\/my-feed', 'my feed', 'for-you'), '\/@', '@', 'to-me'), '\/all', 'all',
    'latest')
    .replace(/<a href="\/drafts">drafts<\/a>|(?=<\/span>\s*<span class="account-nav-row account-nav-primary">)/,
      '{{drafts-link}}')
}

export function personalizedReadActionOutOfSync(kind: 'for-you' | 'to-me', html: string) {
  const path = kind === 'to-me' ? '/@' : '/my-feed'
  const label = kind === 'to-me' ? '@' : 'my feed'
  const count = Number(html.match(new RegExp(
    `href="${path.replace('/', '\\/')}"[^>]*>${label}<span class="to-me-count">(\\d+)\\+?</span>`,
  ))?.[1] || 0)
  const action = kind === 'to-me' ? '/@/read-all' : '/my-feed/read-all'
  return (count > 0) !== html.includes(`action="${action}"`)
}

export function memoryHitNeedsReadAction(kind: MaterializedFeedKind, hitActionDone: boolean, actionStale = false) {
  return !hitActionDone || actionStale || kind === 'for-you' || kind === 'to-me'
}

export function readActionNeedsRerender(changed: boolean | void, actionStale = false) {
  return changed !== false || actionStale
}

function appearanceVariant(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const names = ['appearance', 'font', 'sans-serif-font', 'primary-font', 'font-size', 'notification_device',
    'donation_banner_dismissed', 'pwa_standalone', 'pwa_install_banner_dismissed']
  return `${isMobileRequest(request) ? 'mobile' : 'desktop'}|${
    locationMapProvider(request.headers.get('user-agent') || '')
  }|${names.map(name => cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || '').join('|')}`
}

export async function rpcMaterializedFeedPage(request: Request, kind: MaterializedFeedKind, viewerId: number,
  render: () => Response | Promise<Response>, rerenderForCache = false, cacheVersion = 0, background = false,
  renderForCache?: () => Response | Promise<Response>, onCacheHit?: () => boolean | void | Promise<boolean | void>)
{
  // Feed profiling is used to diagnose materialization itself. Keep the cache active for those explicit development
  // modes; ordinary hot-reload development still bypasses it so direct fixture/database edits remain visible.
  const profilingMaterialization = Bun.env.FEED_QUERY_METRICS === 'true'
    || Bun.env.REACT_RENDER_METRICS === 'true'
  if (Bun.env.DEV_RELOAD === 'true' && !profilingMaterialization) return await render()
  const variant = `${MATERIALIZED_HTML_VERSION}|${cacheVersion ? `${cacheVersion}|` : ''}${appearanceVariant(request)}`
  const call = background ? backgroundDatabaseCall : databaseService().call.bind(databaseService())
  const key = `${kind}\0${viewerId}\0${variant}`
  const memory = memoryCacheEnabled() ? memoryMaterializations.get(key) : undefined
  if (memory) {
    memoryMaterializations.delete(key)
    memoryMaterializations.set(key, memory)
    const hydratedMemoryBody = viewerId >= 0
      ? await databaseService().call('cache.hydrateMaterializedFeed', { html: memory.body, viewerId })
      : memory.body
    const personalizedActionStale = (kind === 'for-you' || kind === 'to-me')
      && personalizedReadActionOutOfSync(kind, hydratedMemoryBody)
    let memoryBodyChanged = false
    // Personalized pages can gain new unread entries without changing this process's memory entry. Consume the
    // visible page on every visit so reads made in My Feed are reflected in All before the response is returned.
    if (memoryHitNeedsReadAction(kind, memory.hitActionDone, personalizedActionStale) && onCacheHit) {
      memory.hitActionDone = true
      const changed = await onCacheHit()
      if (renderForCache && readActionNeedsRerender(changed, personalizedActionStale)) {
        memory.body = materializedBody(await (await renderForCache()).text(), viewerId)
        memoryBodyChanged = true
      }
    }
    const body = viewerId >= 0 && memoryBodyChanged
      ? await databaseService().call('cache.hydrateMaterializedFeed', { html: memory.body, viewerId })
      : hydratedMemoryBody
    const headers = new Headers(memory.headers)
    headers.set('x-feed-cache', 'memory')
    return new Response(body, { status: memory.status, headers })
  }
  const startedAtMemoryGeneration = memoryGeneration
  let materialization = materializations.get(key)
  if (!materialization) {
    materialization = (async () => {
      const cached = await call('cache.materializedFeedGet', { kind, viewerId, variant })
      if (cached.html) {
        const changed = await onCacheHit?.()
        const cachedHtml = onCacheHit && renderForCache && changed !== false
          ? await (await renderForCache()).text()
          : cached.html
        if (cachedHtml !== cached.html) {
          await call('cache.materializedFeedPut', {
            kind,
            viewerId,
            variant,
            generation: cached.generation,
            html: cachedHtml,
          })
        }
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
        return { body: kind === 'latest' ? cached.html : cachedHtml, status: 200,
          headers: [['content-type', 'text/html;charset=utf-8'], ['cache-control', 'private, no-store'], [
            'x-feed-cache',
            cached.stale ? 'stale' : 'durable',
          ]] }
      }
      const response = await render()
      const html = await response.text()
      let memoryBody: string | undefined
      if (response.status === 200) {
        const cachedHtml = renderForCache
          ? await (await renderForCache()).text()
          : rerenderForCache
          ? await (await render()).text()
          : html
        memoryBody = cachedHtml
        await call('cache.materializedFeedPut', {
          kind,
          viewerId,
          variant,
          generation: cached.generation,
          html: cachedHtml,
        })
      }
      return { body: html, memoryBody, status: response.status,
        headers: [...response.headers.entries(), ['x-feed-cache', 'miss']] }
    })()
    materializations.set(key, materialization)
    void materialization.finally(() => {
      if (materializations.get(key) === materialization) materializations.delete(key)
    }).catch(() => {})
  }
  const result = await materialization
  if (!memoryCacheEnabled()) return new Response(result.body, { status: result.status, headers: result.headers })
  if (result.headers.some(([name, value]) => name.toLowerCase() === 'x-feed-cache' && value === 'stale')) {
    return new Response(result.body, { status: result.status, headers: result.headers })
  }
  // A publication may have completed while this page was rendering. Never let that older render repopulate the LRU.
  if (startedAtMemoryGeneration !== memoryGeneration) {
    return new Response(result.body, { status: result.status, headers: result.headers })
  }
  rememberMaterialization(key, result, viewerId)
  return new Response(result.body, { status: result.status, headers: result.headers })
}
