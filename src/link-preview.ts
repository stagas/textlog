import type { Database } from 'bun:sqlite'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { loadImage } from 'canvas'
import { appName, appOrigin } from './brand'
import type { LinkPreview } from './types'
import { postLinks } from './utils'

const MAX_LINKS = 3
const MAX_HTML_BYTES = 512 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 1500

function ownPostPreview(database: Database, rawUrl: string) {
  const origin = appOrigin()
  if (!origin) return null
  let url: URL
  try { url = new URL(rawUrl) }
  catch { return null }
  if (url.origin !== origin) return null
  const match = url.pathname.match(/^\/post\/([1-9]\d*)$/)
  if (!match) return null
  const post = database.query(`SELECT p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(Number(match[1])) as { body: string; handle: string } | null
  if (!post) return null
  const text = post.body.replace(/\s+/g, ' ').trim()
  const characters = [...text]
  const title = characters.length > 60 ? `${characters.slice(0, 59).join('').trimEnd()}…` : text
  return {
    url: rawUrl,
    imageUrl: `${origin}/post/${match[1]}/og.png?v=2`,
    title,
    description: text.slice(0, 500),
    siteName: appName(),
    imageWidth: 1200,
    imageHeight: 630,
  }
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd')
    || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea')
    || normalized.startsWith('feb')) return true
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
    || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

async function publicHttpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return null
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
    if (!addresses.length || addresses.some(result => privateAddress(result.address))) return null
  }
  catch {
    return null
  }
  return url
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/gi, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'",
  })[entity.toLowerCase()] || entity)
}

export function openGraphMetadata(html: string, pageUrl: string) {
  const metadata: Record<string, string> = {}
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const property = attribute(match[0], 'property') || attribute(match[0], 'name')
    const content = attribute(match[0], 'content')
    if (!content || !/^og:(?:image(?::(?:url|secure_url|width|height))?|title|description|site_name)$/i
      .test(property || '')) {
      continue
    }
    metadata[property!.toLowerCase()] ??= decodeEntities(content).replace(/\s+/g, ' ').trim()
  }
  const rawImage = metadata['og:image'] || metadata['og:image:url'] || metadata['og:image:secure_url']
  if (!rawImage) return null
  const dimension = (name: string) => {
    const value = Number(metadata[name])
    return Number.isInteger(value) && value > 0 && value <= 10000 ? value : undefined
  }
  try {
    return {
      imageUrl: new URL(rawImage, pageUrl).href,
      title: metadata['og:title']?.slice(0, 200),
      description: metadata['og:description']?.slice(0, 500),
      siteName: metadata['og:site_name']?.slice(0, 100),
      imageWidth: dimension('og:image:width'),
      imageHeight: dimension('og:image:height'),
    }
  }
  catch {
    return null
  }
}

export const openGraphImage = (html: string, pageUrl: string) => openGraphMetadata(html, pageUrl)?.imageUrl || null

async function fetchHtml(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'textlog-link-preview/1.0' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      const redirected = await publicHttpUrl(new URL(location, url).href)
      if (!redirected) return null
      url = redirected
      continue
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > MAX_HTML_BYTES) return null
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_HTML_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { html: new TextDecoder().decode(bytes), url: url.href }
  }
  return null
}

async function fetchImageDimensions(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'image/*', 'user-agent': 'textlog-link-preview/1.0' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      const redirected = await publicHttpUrl(new URL(location, url).href)
      if (!redirected) return null
      url = redirected
      continue
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) return null
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > MAX_IMAGE_BYTES) return null
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const image = await loadImage(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))
    return image.width > 0 && image.height > 0 ? { width: image.width, height: image.height } : null
  }
  return null
}

export async function discoverLinkPreviews(body: string, database?: Database) {
  const preview = async (rawUrl: string) => {
    try {
      const ownPreview = database && ownPostPreview(database, rawUrl)
      if (ownPreview) return ownPreview
      const url = await publicHttpUrl(rawUrl)
      if (!url) return null
      const page = await fetchHtml(url)
      if (!page) return null
      const metadata = openGraphMetadata(page.html, page.url)
      const imageUrl = metadata && await publicHttpUrl(metadata.imageUrl)
      if (!imageUrl || imageUrl.protocol !== 'https:') return null
      if (!metadata!.imageWidth || !metadata!.imageHeight) {
        const dimensions = await fetchImageDimensions(imageUrl)
        if (dimensions) {
          metadata!.imageWidth = dimensions.width
          metadata!.imageHeight = dimensions.height
        }
      }
      return { url: rawUrl, ...metadata! }
    }
    catch {
      // A preview is optional; publishing must not fail with a remote site.
      return null
    }
  }
  const previews = await Promise.all(postLinks(body).slice(0, MAX_LINKS).map(preview))
  return previews.filter(value => value !== null)
}

export function saveLinkPreviews(database: Database, postId: number,
  previews: ({ url: string } & LinkPreview)[]) {
  if (!previews.length) return
  const available = database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_link_previews'",
  ).get()
  if (!available) return
  const insert = database.query(`INSERT OR IGNORE INTO post_link_previews
    (post_id,url,image_url,title,description,site_name,image_width,image_height) VALUES(?,?,?,?,?,?,?,?)`)
  database.transaction(() => {
    for (const preview of previews) insert.run(postId, preview.url, preview.imageUrl, preview.title || null,
      preview.description || null, preview.siteName || null, preview.imageWidth || null, preview.imageHeight || null)
  })()
}
