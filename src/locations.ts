import { createCanvas, loadImage } from 'canvas'
import { createHash } from 'node:crypto'
import { appName } from './brand'
import { getImageUrl, uploadImage } from './image-storage'
import { withoutMarkdownCode } from './content'

export const LOCATION_ZOOM = 3
export const LOCATION_MAP_STYLE_VERSION = 3
export const MAPTILER_MAP_ID = 'topo-v2'
const TIMEOUT_MS = 4_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export type LocationMetadata = { query: string; latitude: number; longitude: number; displayName: string }
export type ResolvedLocation = LocationMetadata & { imageKey: string; imageUrl: string; imageWidth: number;
  imageHeight: number }

export function parseLocationQuery(body: string) {
  const lines = body.split('\n')
  const visible = withoutMarkdownCode(body).split('\n')
  const marker = visible.findIndex(line => /(?:^|\s)#(?:map|location)\s*$/i.test(line))
  if (marker < 0) return null
  return lines.slice(marker + 1).map(line => line.trim()).find(Boolean)?.slice(0, 300) || null
}

async function limitedBytes(response: Response, maximum = MAX_RESPONSE_BYTES) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maximum) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.byteLength <= maximum ? bytes : null
}

export async function geocodeLocation(query: string, fetcher: typeof fetch = fetch): Promise<LocationMetadata | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('accept-language', 'en')
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
      accept: 'application/json', 'accept-language': 'en', 'user-agent': `${appName()} location preview/1.0`,
    } })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null
    const bytes = await limitedBytes(response, 64 * 1024)
    if (!bytes) return null
    const first = (JSON.parse(new TextDecoder().decode(bytes)) as unknown[])[0] as Record<string, unknown> | undefined
    const latitude = Number(first?.lat)
    const longitude = Number(first?.lon)
    const displayName = typeof first?.display_name === 'string' ? first.display_name.trim().slice(0, 500) : ''
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude)
      || longitude < -180 || longitude > 180 || !displayName) return null
    return { query, latitude, longitude, displayName }
  }
  catch {
    return null
  }
}

function tilePosition(latitude: number, longitude: number, zoom: number) {
  const scale = 2 ** zoom
  const x = (longitude + 180) / 360 * scale
  const radians = latitude * Math.PI / 180
  const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale
  return { x, y }
}

export function locationMapKey(location: LocationMetadata, zoom = LOCATION_ZOOM) {
  const value = `${zoom}:${LOCATION_MAP_STYLE_VERSION}:${location.latitude.toFixed(6)}:${
    location.longitude.toFixed(6)}`
  return `location-maps/${createHash('sha256').update(value).digest('hex')}.png`
}

export function mapTilerRasterTileUrl(x: number, y: number, apiKey: string, zoom = LOCATION_ZOOM) {
  const url = new URL(`https://api.maptiler.com/maps/${MAPTILER_MAP_ID}/256/${zoom}/${x}/${y}.png`)
  url.searchParams.set('key', apiKey)
  return url
}

export async function generateLocationMap(location: LocationMetadata, fetcher: typeof fetch = fetch,
  apiKey = Bun.env.MAPTILER_API_KEY?.trim())
{
  if (!apiKey) return null
  const width = 600
  const height = 315
  const center = tilePosition(location.latitude, location.longitude, LOCATION_ZOOM)
  const originX = center.x * 256 - width / 2
  const originY = center.y * 256 - height / 2
  const firstX = Math.floor(originX / 256)
  const firstY = Math.floor(originY / 256)
  const lastX = Math.floor((originX + width - 1) / 256)
  const lastY = Math.floor((originY + height - 1) / 256)
  try {
    const tiles = [] as Array<{ x: number; y: number; data: Uint8Array }>
    for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
      const url = mapTilerRasterTileUrl(x, y, apiKey)
      const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
        accept: 'image/png', 'accept-language': 'en', 'user-agent': `${appName()} location preview/1.0`,
      } })
      if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) return null
      const data = await limitedBytes(response)
      if (!data) return null
      tiles.push({ x, y, data })
    }
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    for (const tile of tiles) {
      const image = await loadImage(Buffer.from(tile.data))
      context.drawImage(image, tile.x * 256 - originX, tile.y * 256 - originY)
    }
    context.beginPath()
    context.arc(width / 2, height / 2, 9, 0, Math.PI * 2)
    context.fillStyle = '#3a6ea5'
    context.fill()
    context.lineWidth = 3
    context.strokeStyle = '#fff'
    context.stroke()
    context.font = '12px sans-serif'
    const attribution = '© MapTiler © OpenStreetMap contributors'
    const textWidth = context.measureText(attribution).width
    context.fillStyle = 'rgba(255,255,255,.85)'
    context.fillRect(width - textWidth - 10, height - 19, textWidth + 10, 19)
    context.fillStyle = '#222'
    context.fillText(attribution, width - textWidth - 5, height - 5)
    const data = new Uint8Array(canvas.toBuffer('image/png'))
    const imageKey = locationMapKey(location)
    await uploadImage(imageKey, data, 'image/png')
    return { imageKey, imageUrl: getImageUrl(imageKey), imageWidth: width, imageHeight: height }
  }
  catch {
    return null
  }
}

export async function resolveLocation(query: string, fetcher: typeof fetch = fetch): Promise<ResolvedLocation | null> {
  const location = await geocodeLocation(query, fetcher)
  if (!location) return null
  const map = await generateLocationMap(location, fetcher)
  return map ? { ...location, ...map } : null
}

export function osmLocationUrl(location: Pick<LocationMetadata, 'latitude' | 'longitude'>) {
  const { latitude: lat, longitude: lon } = location
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${LOCATION_ZOOM}/${lat}/${lon}`
}

export function locationMapProvider(userAgent: string) {
  if (/(?:iPhone|iPad|iPod|Macintosh|Mac OS X)|Safari/i.test(userAgent)
    && !/(?:Android|Chrome|Chromium|CriOS|Edg|OPR)/i.test(userAgent)) return 'apple' as const
  if (/(?:Android|Linux|Windows)/i.test(userAgent)) return 'google' as const
  if (/(?:iPhone|iPad|iPod|Macintosh|Mac OS X)/i.test(userAgent)) return 'apple' as const
  return 'openstreetmap' as const
}

export function locationDestination(location: Pick<LocationMetadata, 'query' | 'latitude' | 'longitude'>,
  userAgent: string)
{
  const provider = locationMapProvider(userAgent)
  if (provider === 'apple') {
    const url = new URL('https://maps.apple.com/')
    url.searchParams.set('ll', `${location.latitude},${location.longitude}`)
    url.searchParams.set('q', location.query)
    return url.href
  }
  if (provider === 'google') {
    const url = new URL('https://www.google.com/maps/search/')
    url.searchParams.set('api', '1')
    url.searchParams.set('query', `${location.latitude},${location.longitude}`)
    return url.href
  }
  return osmLocationUrl(location)
}
