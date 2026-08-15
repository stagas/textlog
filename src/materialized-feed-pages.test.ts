import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { invalidateMaterializedFeedPages, materializedFeedPage } from './materialized-feed-pages'

function databases() {
  const primary = new Database(':memory:', { strict: true })
  primary.run(`CREATE TABLE feed_snapshot_generation(id INTEGER PRIMARY KEY,generation INTEGER NOT NULL);
    INSERT INTO feed_snapshot_generation VALUES(1,1);`)
  const cache = new Database(':memory:', { strict: true })
  cache.run(`CREATE TABLE materialized_feed_pages_v2(kind TEXT,viewer_id INTEGER,variant TEXT,generation INTEGER,html TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(kind,viewer_id,variant,generation));`)
  return { primary, cache }
}

test('reuses rendered HTML until the mutation generation changes', async () => {
  const { primary, cache } = databases()
  let renders = 0
  const render = () => new Response(`<p>${++renders}</p>`, { headers: { 'content-type': 'text/html;charset=utf-8' } })
  const request = new Request('https://textlog.test/latest')

  expect(await (await materializedFeedPage(primary, request, 'latest', -1, render, cache)).text()).toBe('<p>1</p>')
  expect(await (await materializedFeedPage(primary, request, 'latest', -1, render, cache)).text()).toBe('<p>1</p>')
  primary.run('UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1')
  expect(await (await materializedFeedPage(primary, request, 'latest', -1, render, cache)).text()).toBe('<p>2</p>')
})

test('keeps appearance variants separate without storing the full cookie', async () => {
  const { primary, cache } = databases()
  let renders = 0
  const render = () => new Response(`<p>${++renders}</p>`)
  const light = new Request('https://textlog.test/latest', { headers: { cookie: 'appearance=light.sage; feed=hot' } })
  const dark = new Request('https://textlog.test/latest', { headers: { cookie: 'appearance=dark.purple; feed=hot' } })

  await materializedFeedPage(primary, light, 'latest', 7, render, cache)
  await materializedFeedPage(primary, dark, 'latest', 7, render, cache)
  expect(renders).toBe(2)
  expect(cache.query('SELECT variant FROM materialized_feed_pages_v2 ORDER BY variant').all()).toEqual([
    { variant: 'dark.purple|||||' },
    { variant: 'light.sage|||||' },
  ])
})

test('stores the post-read render and supports viewer-specific invalidation', async () => {
  const { primary, cache } = databases()
  let renders = 0
  const render = () => new Response(`<p>${++renders}</p>`)
  const request = new Request('https://textlog.test/for-you')

  expect(await (await materializedFeedPage(primary, request, 'for-you', 7, render, cache, true)).text())
    .toBe('<p>1</p>')
  expect(await (await materializedFeedPage(primary, request, 'for-you', 7, render, cache, true)).text())
    .toBe('<p>2</p>')
  invalidateMaterializedFeedPages(7, ['for-you'], cache)
  expect(await (await materializedFeedPage(primary, request, 'for-you', 7, render, cache, true)).text())
    .toBe('<p>3</p>')
})
