const MAX_POST_PAGES = 10

type MaterializedPostPage = {
  html: string
  headers: [string, string][]
  status: number
}

const pages = new Map<string, MaterializedPostPage>()

function response(page: MaterializedPostPage) {
  return new Response(page.html, { status: page.status, headers: page.headers })
}

export function cachedAnonymousPostPage(key: string) {
  const cached = pages.get(key)
  if (!cached) return null
  pages.delete(key)
  pages.set(key, cached)
  return response(cached)
}

export async function materializeAnonymousPostPage(key: string, rendered: Response) {
  const page: MaterializedPostPage = {
    html: await rendered.text(),
    headers: [...rendered.headers.entries()],
    status: rendered.status,
  }
  pages.delete(key)
  pages.set(key, page)
  while (pages.size > MAX_POST_PAGES) {
    const oldest = pages.keys().next().value
    if (oldest === undefined) break
    pages.delete(oldest)
  }
  return response(page)
}

export function clearAnonymousPostPageCache() {
  pages.clear()
}
