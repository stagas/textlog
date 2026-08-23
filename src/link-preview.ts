import type { Database } from 'bun:sqlite'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { appName, appOrigin } from './brand'
import { createImageKey, deleteImages, deleteImagesAfterCommit, getImageUrl, imageDimensions, isImageKey,
  MAX_IMAGE_BYTES, uploadImage, validateImageData } from './image-storage'
import type { LinkPreview } from './types'
import { postLinks } from './utils'

const MAX_LINKS = 3
const MAX_HTML_BYTES = 1024 * 1024
const MAX_YOUTUBE_CHANNEL_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 5000

export function isDirectImageUrl(value: string) {
  try {
    return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(new URL(value).pathname)
  }
  catch {
    return false
  }
}

export function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
      || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
  }
  catch {
    return false
  }
}

function isYouTubeChannelUrl(url: URL) {
  return isYouTubeUrl(url.href) && /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/i.test(url.pathname)
}

function ownPostPreview(database: Database, rawUrl: string) {
  const origin = appOrigin()
  if (!origin) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    return null
  }
  if (url.origin !== origin) return null
  const match = url.pathname.match(/^\/post\/([1-9]\d*)$/)
  if (!match) return null
  const post = database.query(`SELECT p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(Number(match[1])) as { body: string; handle: string } | null
  if (!post) return null
  const text = post.body.replace(/\s+/g, ' ').trim()
  return {
    url: rawUrl,
    imageUrl: `${origin}/post/${match[1]}/og.png?v=4`,
    title: `@${post.handle} wrote on ${appName()}`,
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

export function decodeHtmlEntities(value: string) {
  const decode = (text: string) =>
    text.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi,
      (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
        if (decimal || hexadecimal) {
          const codePoint = Number.parseInt(decimal || hexadecimal!, decimal ? 10 : 16)
          return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? String.fromCodePoint(codePoint)
            : entity
        }
        return ({ '&amp;': '&', '&quot;': '"', '&apos;': '\'', '&lt;': '<', '&gt;': '>' } as Record<string, string>)[
          entity.toLowerCase()
        ] || entity
      })
  let decoded = value
  for (let depth = 0; depth < 4; depth++) {
    const next = decode(decoded)
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

export function openGraphMetadata(html: string, pageUrl: string) {
  const metadata: Record<string, string> = {}
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const property = attribute(match[0], 'property') || attribute(match[0], 'name')
    const content = attribute(match[0], 'content')
    if (!content || !/^og:(?:image(?::(?:url|secure_url|width|height))?|title|description|site_name)$/i
      .test(property || ''))
    {
      continue
    }
    metadata[property!.toLowerCase()] ??= decodeHtmlEntities(content).replace(/\s+/g, ' ').trim()
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

export function youtubeChannelMetadata(html: string) {
  const start = html.indexOf('"channelMetadataRenderer":{')
  if (start === -1) return null
  const metadata = html.slice(start, start + 20_000)
  const jsonString = (name: string) => {
    const match = metadata.match(new RegExp(`"${name}":("(?:\\\\.|[^"\\\\])*")`))
    if (!match) return undefined
    try {
      return JSON.parse(match[1]) as string
    }
    catch {
      return undefined
    }
  }
  const avatar = metadata.match(
    /"avatar":\{"thumbnails":\[\{"url":("(?:\\.|[^"\\])*")\s*,\s*"width":(\d+)\s*,\s*"height":(\d+)/,
  )
  if (!avatar) return null
  try {
    return {
      imageUrl: JSON.parse(avatar[1]) as string,
      title: jsonString('title')?.slice(0, 200),
      description: jsonString('description')?.replace(/\s+/g, ' ').trim().slice(0, 500),
      siteName: 'YouTube',
      imageWidth: Number(avatar[2]),
      imageHeight: Number(avatar[3]),
    }
  }
  catch {
    return null
  }
}

export const openGraphImage = (html: string, pageUrl: string) => openGraphMetadata(html, pageUrl)?.imageUrl || null

export async function readHtmlHead(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  let html = ''
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      html += decoder.decode()
      return html
    }
    size += value.byteLength
    html += decoder.decode(value, { stream: true })
    const end = html.search(/<\/head\s*>/i)
    if (end !== -1) {
      await reader.cancel()
      const head = html.slice(0, end) + '</head>'
      return new TextEncoder().encode(head).byteLength <= MAX_HTML_BYTES ? head : null
    }
    if (size > MAX_HTML_BYTES) {
      await reader.cancel()
      return null
    }
  }
}

async function fetchHtml(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    const html = await readHtmlHead(response)
    return html === null ? null : { html, url: url.href }
  }
  return null
}

async function audioMimeType(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response = await fetch(url, {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'audio/*,text/html;q=0.8', 'user-agent': 'textlog-link-preview/1.0' },
    })
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'audio/*,text/html;q=0.8', range: 'bytes=0-0',
          'user-agent': 'textlog-link-preview/1.0' },
      })
      await response.body?.cancel()
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      const redirected = await publicHttpUrl(new URL(location, url).href)
      if (!redirected) return null
      url = redirected
      continue
    }
    if (!response.ok) return null
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    return mimeType?.startsWith('audio/') ? mimeType : null
  }
  return null
}

async function fetchYouTubeChannel(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; textlog-link-preview/1.0)',
        cookie: 'CONSENT=YES+cb',
      },
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
    if (declaredSize > MAX_YOUTUBE_CHANNEL_BYTES) return null
    const reader = response.body?.getReader()
    if (!reader) return null
    const decoder = new TextDecoder()
    let html = ''
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) return youtubeChannelMetadata(html + decoder.decode())
      size += value.byteLength
      if (size > MAX_YOUTUBE_CHANNEL_BYTES) {
        await reader.cancel()
        return null
      }
      html += decoder.decode(value, { stream: true })
      const metadata = youtubeChannelMetadata(html)
      if (metadata) {
        await reader.cancel()
        return metadata
      }
    }
  }
  return null
}

async function fetchImage(initialUrl: URL) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
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
    const data = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    const validatedType = validateImageData(data, contentType)
    const dimensions = imageDimensions(data, validatedType)
    return { data, contentType: validatedType, ...dimensions }
  }
  return null
}

async function youtubeMetadata(url: URL) {
  const endpoint = new URL('https://www.youtube.com/oembed')
  endpoint.searchParams.set('url', url.href)
  endpoint.searchParams.set('format', 'json')
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) return null
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > 16 * 1024) return null
  const body = await response.text()
  if (body.length > 16 * 1024) return null
  const value = JSON.parse(body) as Record<string, unknown>
  if (typeof value.thumbnail_url !== 'string') return null
  return {
    imageUrl: value.thumbnail_url,
    title: typeof value.title === 'string' ? value.title.slice(0, 200) : undefined,
    siteName: typeof value.provider_name === 'string' ? value.provider_name.slice(0, 100) : 'YouTube',
    imageWidth: typeof value.thumbnail_width === 'number' ? value.thumbnail_width : undefined,
    imageHeight: typeof value.thumbnail_height === 'number' ? value.thumbnail_height : undefined,
  }
}

export async function storeRemotePreviewImage(rawUrl: string) {
  const url = await publicHttpUrl(rawUrl)
  if (!url || url.protocol !== 'https:') return null
  const image = await fetchImage(url)
  if (!image) return null
  const key = createImageKey(image.contentType)
  await uploadImage(key, image.data, image.contentType)
  return { key, width: image.width, height: image.height }
}

export async function discoverLinkPreviews(body: string, database?: Database) {
  const storedImage = async (url: URL) => {
    const image = await fetchImage(url)
    if (!image) return null
    const key = createImageKey(image.contentType)
    await uploadImage(key, image.data, image.contentType)
    return { imageUrl: getImageUrl(key), imageKey: key, imageWidth: image.width, imageHeight: image.height }
  }
  const preview = async (rawUrl: string) => {
    try {
      const ownPreview = database && ownPostPreview(database, rawUrl)
      if (ownPreview) return ownPreview
      const url = await publicHttpUrl(rawUrl)
      if (!url) return null
      const mimeType = await audioMimeType(url)
      if (mimeType) {
        const filename = decodeURIComponent(url.pathname.split('/').pop() || url.hostname)
        return { url: rawUrl, imageUrl: rawUrl, title: filename, siteName: url.hostname.replace(/^www\./, ''),
          mimeType }
      }
      if (isDirectImageUrl(url.href)) {
        if (url.protocol !== 'https:' && url.origin !== appOrigin()) return null
        const image = await storedImage(url)
        if (!image) return null
        const filename = decodeURIComponent(url.pathname.split('/').pop() || url.hostname)
        return { url: rawUrl, ...image, title: filename, siteName: url.hostname.replace(/^www\./, '') }
      }
      let metadata = isYouTubeUrl(url.href) ? await youtubeMetadata(url) : null
      if (!metadata && isYouTubeChannelUrl(url)) metadata = await fetchYouTubeChannel(url)
      if (!metadata) {
        const page = await fetchHtml(url)
        if (!page) return null
        metadata = openGraphMetadata(page.html, page.url)
      }
      const imageUrl = metadata && await publicHttpUrl(metadata.imageUrl)
      if (!imageUrl || imageUrl.protocol !== 'https:') return null
      const image = await storedImage(imageUrl)
      if (!image) return null
      const { imageUrl: _, imageWidth: _width, imageHeight: _height, ...details } = metadata!
      return { url: rawUrl, ...details, ...image }
    }
    catch {
      // A preview is optional; publishing must not fail with a remote site.
      return null
    }
  }
  const previews = await Promise.all(postLinks(body).slice(0, MAX_LINKS).map(preview))
  return previews.filter(value => value !== null)
}

export async function saveLinkPreviews(database: Database, postId: number,
  previews: ({ url: string } & LinkPreview)[])
{
  if (!previews.length) return
  const available = database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
  ).get()
  if (!available) {
    await deleteImages(previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : []))
    return
  }
  const replacedKeys: string[] = []
  try {
    database.transaction(() => writeLinkPreviews(database, postId, previews, replacedKeys))()
  }
  catch (error) {
    await deleteImages(previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : []))
    throw error
  }
  await deleteImagesAfterCommit(replacedKeys)
}

function writeLinkPreviews(database: Database, postId: number, previews: ({ url: string } & LinkPreview)[],
  replacedKeys: string[] = [])
{
  const existing = database.query('SELECT image_url FROM post_link_previews WHERE post_id=? AND url=?')
  const supportsMimeType = database.query("SELECT 1 FROM pragma_table_info('post_link_previews') WHERE name='mime_type'")
    .get()
  const insert = supportsMimeType ? database.query(`INSERT INTO post_link_previews
    (post_id,url,image_url,title,description,site_name,image_width,image_height,mime_type) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(post_id,url) DO UPDATE SET image_url=excluded.image_url,title=excluded.title,
      description=excluded.description,site_name=excluded.site_name,image_width=excluded.image_width,
      image_height=excluded.image_height,mime_type=excluded.mime_type`) : database.query(`INSERT INTO post_link_previews
    (post_id,url,image_url,title,description,site_name,image_width,image_height) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(post_id,url) DO UPDATE SET image_url=excluded.image_url,title=excluded.title,
      description=excluded.description,site_name=excluded.site_name,image_width=excluded.image_width,
      image_height=excluded.image_height`)
  for (const preview of previews) {
    const previous = existing.get(postId, preview.url) as { image_url: string } | null
    const values = [postId, preview.url, preview.imageKey || preview.imageUrl, preview.title || null,
      preview.description || null, preview.siteName || null, preview.imageWidth || null, preview.imageHeight || null]
    insert.run(...values, ...(supportsMimeType ? [preview.mimeType || null] : []))
    if (previous && isImageKey(previous.image_url) && previous.image_url !== preview.imageKey) {
      replacedKeys.push(previous.image_url)
    }
  }
}

function linkPreviewTableAvailable(database: Database) {
  return Boolean(database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
  ).get())
}

function storedPreviewKeys(database: Database, postId: number) {
  if (!linkPreviewTableAvailable(database)) return []
  return (database.query('SELECT image_url FROM post_link_previews WHERE post_id=?').all(postId) as {
    image_url: string
  }[]).map(row => row.image_url).filter(isImageKey)
}

export async function replaceLinkPreviews(database: Database, postId: number,
  previews: ({ url: string } & LinkPreview)[])
{
  if (!linkPreviewTableAvailable(database)) {
    await deleteImages(previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : []))
    return
  }
  const oldKeys = storedPreviewKeys(database, postId)
  const newKeys = previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : [])
  try {
    database.transaction(() => {
      database.query('DELETE FROM post_link_previews WHERE post_id=?').run(postId)
      writeLinkPreviews(database, postId, previews)
    })()
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
  await deleteImagesAfterCommit(oldKeys.filter(key => !newKeys.includes(key)))
}

export async function deleteLinkPreviewImages(database: Database, postId: number) {
  if (!linkPreviewTableAvailable(database)) return
  const keys = storedPreviewKeys(database, postId)
  database.query('DELETE FROM post_link_previews WHERE post_id=?').run(postId)
  await deleteImagesAfterCommit(keys)
}

function bioLinkPreviewTableAvailable(database: Database) {
  return Boolean(database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'user_bio_link_previews\'',
  ).get())
}

function storedBioPreviewKeys(database: Database, userId: number) {
  if (!bioLinkPreviewTableAvailable(database)) return []
  return (database.query('SELECT image_url FROM user_bio_link_previews WHERE user_id=?').all(userId) as {
    image_url: string
  }[]).map(row => row.image_url).filter(isImageKey)
}

export function userBioLinkPreviews(database: Database, userId: number) {
  if (!bioLinkPreviewTableAvailable(database)) return {}
  const rows = database.query(`SELECT url,image_url,title,description,site_name,image_width,image_height,mime_type
    FROM user_bio_link_previews WHERE user_id=?`).all(userId) as {
    url: string
    image_url: string
    title: string | null
    description: string | null
    site_name: string | null
    image_width: number | null
    image_height: number | null
    mime_type: string | null
  }[]
  return Object.fromEntries(rows.map(row => [row.url, {
    imageUrl: isImageKey(row.image_url) ? getImageUrl(row.image_url) : row.image_url,
    title: row.title ? decodeHtmlEntities(row.title) : undefined,
    description: row.description ? decodeHtmlEntities(row.description) : undefined,
    siteName: row.site_name ? decodeHtmlEntities(row.site_name) : undefined,
    imageWidth: row.image_width || undefined,
    imageHeight: row.image_height || undefined,
    mimeType: row.mime_type || undefined,
  }]))
}

export async function replaceBioLinkPreviews(database: Database, userId: number,
  previews: ({ url: string } & LinkPreview)[])
{
  if (!bioLinkPreviewTableAvailable(database)) {
    await deleteImages(previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : []))
    return
  }
  const oldKeys = storedBioPreviewKeys(database, userId)
  const newKeys = previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : [])
  const supportsMimeType = database.query(
    "SELECT 1 FROM pragma_table_info('user_bio_link_previews') WHERE name='mime_type'",
  ).get()
  const insert = supportsMimeType ? database.query(`INSERT INTO user_bio_link_previews
    (user_id,url,image_url,title,description,site_name,image_width,image_height,mime_type) VALUES(?,?,?,?,?,?,?,?,?)`)
    : database.query(`INSERT INTO user_bio_link_previews
      (user_id,url,image_url,title,description,site_name,image_width,image_height) VALUES(?,?,?,?,?,?,?,?)`)
  try {
    database.transaction(() => {
      database.query('DELETE FROM user_bio_link_previews WHERE user_id=?').run(userId)
      for (const preview of previews) {
        const values = [userId, preview.url, preview.imageKey || preview.imageUrl, preview.title || null,
          preview.description || null, preview.siteName || null, preview.imageWidth || null,
          preview.imageHeight || null]
        insert.run(...values, ...(supportsMimeType ? [preview.mimeType || null] : []))
      }
    })()
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
  await deleteImagesAfterCommit(oldKeys.filter(key => !newKeys.includes(key)))
}

export async function deleteBioLinkPreviewImages(database: Database, userId: number) {
  if (!bioLinkPreviewTableAvailable(database)) return
  const keys = storedBioPreviewKeys(database, userId)
  database.query('DELETE FROM user_bio_link_previews WHERE user_id=?').run(userId)
  await deleteImagesAfterCommit(keys)
}
