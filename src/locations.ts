import { getAirportByIata, getAirportByIcao, searchByName } from 'airport-data-ts'
import { createCanvas, loadImage } from 'canvas'
import { createHash } from 'node:crypto'
import { appName } from './brand'
import { withoutMarkdownCode } from './content'
import { getImageUrl, uploadImage } from './image-storage'

export const LOCATION_ZOOM = 3
export const LOCATION_MAP_STYLE_VERSION = 3
export const MAPTILER_MAP_ID = 'topo-v2'
const TIMEOUT_MS = 4_000
const MAX_RESPONSE_BYTES = 1024 * 1024

export type LocationMetadata = { query: string; latitude: number; longitude: number; displayName: string }
export type ResolvedLocation = LocationMetadata & { imageKey: string; imageUrl: string; imageWidth: number;
  imageHeight: number }

export function flyingText(body: string) {
  const visible = withoutMarkdownCode(body)
  const match = /(?:^|\s)#flying(?:[ \t]+([^\n]+)|[ \t]*\n(?:[ \t]*\n)*[ \t]*([^\n]+))/i.exec(visible)
  const query = (match?.[1] || match?.[2] || '').trim()
  if (!query || query.length > 300 || query.split(/\s*(?:->|→)\s*/).length !== 2) return null
  const index = match!.index + match![0].lastIndexOf(query)
  return { query, index, lastIndex: index + query.length }
}

export async function resolveAirports(query: string) {
  const parts = query.split(/\s*(?:->|→)\s*/)
  if (parts.length !== 2 || parts.some(part => !part.trim())) return null
  const airports = await Promise.all(parts.map(async part => {
    const code = part.trim().toUpperCase()
    const exact = /^[A-Z]{3}$/.test(code) ? await getAirportByIata(code)
      : /^[A-Z]{4}$/.test(code) ? await getAirportByIcao(code) : []
    const results = exact.length ? exact : await searchByName(part.trim())
    return results.filter(a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
      .sort((a, b) => Number(b.scheduled_service === 'TRUE') - Number(a.scheduled_service === 'TRUE')
        || Number(b.type === 'large_airport') - Number(a.type === 'large_airport')
        || b.runway_length - a.runway_length)[0]
  }))
  return airports[0] && airports[1] ? airports : null
}

export function locationCacheKey(location: LocationMetadata, zoom = LOCATION_ZOOM) {
  return `${zoom}:${LOCATION_MAP_STYLE_VERSION}:${location.latitude.toFixed(6)}:${location.longitude.toFixed(6)}`
    + (/(?:->|→)/.test(location.query) ? `:flight:${location.query}` : '')
}

export function parseLocationQuery(body: string) {
  const flight = flyingText(body)
  if (flight) return flight.query
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
      accept: 'application/json',
      'accept-language': 'en',
      'user-agent': `${appName()} location preview/1.0`,
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
  const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180
  const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale
  return { x, y }
}

export function locationMapKey(location: LocationMetadata, zoom = LOCATION_ZOOM) {
  const value = locationCacheKey(location, zoom)
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
  const route = /(?:->|→)/.test(location.query) ? await resolveAirports(location.query) : null
  let zoom = LOCATION_ZOOM
  let points = route?.map(a => tilePosition(a.latitude, a.longitude, zoom))
  if (points) {
    for (zoom = 8; zoom >= 0; zoom--) {
      points = route!.map(a => tilePosition(a.latitude, a.longitude, zoom))
      const world = 2 ** zoom
      if (points[1]!.x - points[0]!.x > world / 2) points[1]!.x -= world
      if (points[0]!.x - points[1]!.x > world / 2) points[1]!.x += world
      if (Math.abs(points[1]!.x - points[0]!.x) * 256 < width - 100
        && Math.abs(points[1]!.y - points[0]!.y) * 256 < height - 90) break
    }
    zoom = Math.max(0, zoom)
  }
  const center = points ? { x: (points[0]!.x + points[1]!.x) / 2,
    y: (points[0]!.y + points[1]!.y) / 2 } : tilePosition(location.latitude, location.longitude, zoom)
  const originX = center.x * 256 - width / 2
  const originY = center.y * 256 - height / 2
  const firstX = Math.floor(originX / 256)
  const firstY = Math.floor(originY / 256)
  const lastX = Math.floor((originX + width - 1) / 256)
  const lastY = Math.floor((originY + height - 1) / 256)
  try {
    const tiles = [] as Array<{ x: number; y: number; data: Uint8Array }>
    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const url = mapTilerRasterTileUrl(((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom, Math.max(0, Math.min(2 ** zoom - 1, y)), apiKey, zoom)
        const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: {
          accept: 'image/png',
          'accept-language': 'en',
          'user-agent': `${appName()} location preview/1.0`,
        } })
        if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) return null
        const data = await limitedBytes(response)
        if (!data) return null
        tiles.push({ x, y, data })
      }
    }
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    for (const tile of tiles) {
      const image = await loadImage(Buffer.from(tile.data))
      context.drawImage(image, tile.x * 256 - originX, tile.y * 256 - originY)
    }
    const markers = points?.map(p => ({ x: p.x * 256 - originX, y: p.y * 256 - originY }))
      || [{ x: width / 2, y: height / 2 }]
    if (points) {
      context.beginPath()
      context.moveTo(markers[0]!.x, markers[0]!.y)
      context.lineTo(markers[1]!.x, markers[1]!.y)
      context.strokeStyle = '#3a6ea5'
      context.lineWidth = 4
      context.stroke()
    }
    markers.forEach((point, i) => {
      context.beginPath()
      context.arc(point.x, point.y, 9, 0, Math.PI * 2)
      context.fillStyle = '#3a6ea5'
      context.fill()
      context.lineWidth = 3
      context.strokeStyle = '#fff'
      context.stroke()
      if (route) {
        context.font = 'bold 13px sans-serif'
        const label = route[i]!.iata || route[i]!.icao
        const labelWidth = context.measureText(label).width
        context.fillStyle = 'rgba(255,255,255,.9)'
        context.fillRect(point.x - labelWidth / 2 - 4, point.y + 13, labelWidth + 8, 20)
        context.fillStyle = '#222'
        context.fillText(label, point.x - labelWidth / 2, point.y + 28)
      }
    })
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
  const route = /(?:->|→)/.test(query) ? await resolveAirports(query) : null
  const location = /(?:->|→)/.test(query) ? route ? { query,
    latitude: route[0]!.latitude, longitude: route[0]!.longitude,
    displayName: `${route[0]!.airport} → ${route[1]!.airport}` } : null : await geocodeLocation(query, fetcher)
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
