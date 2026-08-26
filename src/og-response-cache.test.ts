import { afterEach, describe, expect, test } from 'bun:test'
import { cachedOgResponse, cacheOgResponse, clearOgResponseCache } from './og-response-cache'

afterEach(clearOgResponseCache)

describe('OG response cache', () => {
  test('returns an independent response from memory', async () => {
    const original = cacheOgResponse('post:1', new Uint8Array([1, 2, 3]), {
      'content-type': 'image/png',
      'x-test': 'cached',
    })

    expect([...new Uint8Array(await original.arrayBuffer())]).toEqual([1, 2, 3])
    const cached = cachedOgResponse('post:1')!
    expect([...new Uint8Array(await cached.arrayBuffer())]).toEqual([1, 2, 3])
    expect(cached.headers.get('x-test')).toBe('cached')
  })

  test('keeps only the 10 most recently used responses', () => {
    for (let index = 0; index < 10; index++) {
      cacheOgResponse(`post:${index}`, new Uint8Array([index]), {})
    }
    expect(cachedOgResponse('post:0')).not.toBeNull()
    cacheOgResponse('post:10', new Uint8Array([10]), {})

    expect(cachedOgResponse('post:1')).toBeNull()
    expect(cachedOgResponse('post:0')).not.toBeNull()
    expect(cachedOgResponse('post:10')).not.toBeNull()
  })
})
