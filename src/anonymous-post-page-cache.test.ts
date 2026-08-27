import { afterEach, describe, expect, test } from 'bun:test'
import {
  cachedAnonymousPostPage,
  clearAnonymousPostPageCache,
  materializeAnonymousPostPage,
} from './anonymous-post-page-cache'

afterEach(clearAnonymousPostPageCache)

describe('anonymous post page cache', () => {
  test('materializes a response for reuse', async () => {
    const first = await materializeAnonymousPostPage('/post/1', new Response('<p>post</p>', {
      headers: { 'content-type': 'text/html;charset=utf-8' },
    }))

    expect(await first.text()).toBe('<p>post</p>')
    const cached = cachedAnonymousPostPage('/post/1')!
    expect(await cached.text()).toBe('<p>post</p>')
    expect(cached.headers.get('content-type')).toBe('text/html;charset=utf-8')
  })

  test('keeps the 256 most recently used request variants', async () => {
    for (let index = 0; index < 256; index++) {
      await materializeAnonymousPostPage(`/post/${index}`, new Response(String(index)))
    }
    expect(cachedAnonymousPostPage('/post/0')).not.toBeNull()
    await materializeAnonymousPostPage('/post/256', new Response('256'))

    expect(cachedAnonymousPostPage('/post/1')).toBeNull()
    expect(cachedAnonymousPostPage('/post/0')).not.toBeNull()
  })
})
