import { brotliCompressSync, gzipSync } from 'node:zlib'

type Encoding = 'br' | 'gzip' | 'identity'

export type StylesAsset = {
  etag: string
  bodies: Record<Encoding, ArrayBuffer>
}

function acceptedQuality(header: string, encoding: Encoding) {
  let wildcard: number | undefined
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...parameters] = part.trim().split(';')
    const quality = parameters
      .map(parameter => parameter.trim().match(/^q=(0(?:\.\d+)?|1(?:\.0+)?)$/)?.[1])
      .find(Boolean)
    const value = quality === undefined ? 1 : Number(quality)
    if (name === encoding) return value
    if (name === '*') wildcard = value
  }
  return wildcard ?? (encoding === 'identity' ? 1 : 0)
}

export function preferredStylesEncoding(acceptEncoding: string | null): Encoding {
  if (!acceptEncoding) return 'identity'
  const brotli = acceptedQuality(acceptEncoding, 'br')
  const gzip = acceptedQuality(acceptEncoding, 'gzip')
  if (brotli > 0 && brotli >= gzip) return 'br'
  if (gzip > 0) return 'gzip'
  return 'identity'
}

export async function loadStylesAsset(path: string): Promise<StylesAsset> {
  const build = await Bun.build({ entrypoints: [path], minify: true })
  if (!build.success || !build.outputs[0]) {
    throw new Error(`Could not build styles.css: ${build.logs.join('\n')}`)
  }
  const identity = new Uint8Array(await build.outputs[0].arrayBuffer())
  const digest = new Bun.CryptoHasher('sha256').update(identity).digest('hex')
  return {
    etag: `"${digest}"`,
    bodies: {
      identity: Uint8Array.from(identity).buffer,
      br: Uint8Array.from(brotliCompressSync(identity)).buffer,
      gzip: Uint8Array.from(gzipSync(identity)).buffer,
    },
  }
}

export function stylesResponse(asset: StylesAsset, request: Request, cache = true) {
  const headers = new Headers({
    'content-type': 'text/css; charset=utf-8',
    'cache-control': cache ? 'public, max-age=0, must-revalidate' : 'no-store',
    vary: 'Accept-Encoding',
  })
  if (cache) {
    headers.set('etag', asset.etag)
    if (request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers })
  }

  const encoding = preferredStylesEncoding(request.headers.get('accept-encoding'))
  if (encoding !== 'identity') headers.set('content-encoding', encoding)
  return new Response(asset.bodies[encoding], { headers })
}
