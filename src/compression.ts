import { brotliCompressSync, gzipSync } from 'node:zlib'
import { preferredStylesEncoding } from './styles'

const compressibleType = /^(?:text\/|application\/(?:json|javascript|xml|rss\+xml|atom\+xml|xhtml\+xml|svg\+xml))/i

function addVary(headers: Headers, value: string) {
  const existing = headers.get('vary')
  const values = existing?.split(',').map(item => item.trim().toLowerCase()) || []
  if (!values.includes(value.toLowerCase())) headers.set('vary', existing ? `${existing}, ${value}` : value)
}

export async function compressResponse(request: Request, response: Response, threshold = 1024) {
  const contentType = response.headers.get('content-type') || ''
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader)
  if (
    request.method === 'HEAD' || response.status === 204 || response.status === 205 || response.status === 206
    || response.status === 304 || !response.body || response.headers.has('content-encoding')
    || !compressibleType.test(contentType) || /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers.get('cache-control') || '')
    || (contentLength !== undefined && Number.isFinite(contentLength) && contentLength < threshold)
  ) return response

  const encoding = preferredStylesEncoding(request.headers.get('accept-encoding'))
  if (encoding === 'identity') return response

  const source = new Uint8Array(await response.arrayBuffer())
  if (source.byteLength < threshold) return new Response(source, response)

  const compressed = encoding === 'br' ? brotliCompressSync(source) : gzipSync(source)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.set('content-encoding', encoding)
  addVary(headers, 'Accept-Encoding')
  const etag = headers.get('etag')
  if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`)

  return new Response(Uint8Array.from(compressed).buffer, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
