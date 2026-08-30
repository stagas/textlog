import { subscribeToFeedMutations } from './database-service'

const MAX_OG_RESPONSES = 10

type CachedOgResponse = {
  body: Uint8Array
  headers: [string, string][]
  status: number
}

const responses = new Map<string, CachedOgResponse>()

function response(entry: CachedOgResponse) {
  return new Response(entry.body.slice(), {
    status: entry.status,
    headers: entry.headers,
  })
}

export function cachedOgResponse(key: string) {
  const entry = responses.get(key)
  if (!entry) return null
  responses.delete(key)
  responses.set(key, entry)
  return response(entry)
}

export function cacheOgResponse(key: string, body: Uint8Array, headers: HeadersInit, status = 200) {
  const entry: CachedOgResponse = {
    body: body.slice(),
    headers: [...new Headers(headers).entries()],
    status,
  }
  responses.delete(key)
  responses.set(key, entry)
  while (responses.size > MAX_OG_RESPONSES) {
    const oldest = responses.keys().next().value
    if (oldest === undefined) break
    responses.delete(oldest)
  }
  return response(entry)
}

export function clearOgResponseCache() {
  responses.clear()
}

const postOgMutations = new Set([
  'admin.deletePost',
  'admin.translatePost',
  'api.deletePost',
  'api.persistPostLocation',
  'api.unpublishPost',
  'api.updatePost',
])

subscribeToFeedMutations(operation => {
  if (postOgMutations.has(operation)) clearOgResponseCache()
})
