import { expect, test } from 'bun:test'
import { hydrateMaterializedFeedCounts, materializedFeedTemplate } from './database-domain'

test('materialized feed templates refresh tab counts without rerendering the page', () => {
  const html = '<nav>'
    + '<a href="/@">@</a><a class="active" href="/my-feed">my feed<span class="to-me-count">9</span></a>'
    + '<a href="/all">all<span class="to-me-count">4</span></a>'
    + '</nav><main>expensive feed body</main>'
  const template = materializedFeedTemplate(html)

  expect(template).toContain('my feed{{for-you-count}}')
  expect(template).toContain('@{{to-me-count}}')
  expect(template).toContain('all{{latest-count}}')
  expect(hydrateMaterializedFeedCounts(template, { forYou: 0, toMe: 3, latest: 12 })).toBe(
    '<nav><a href="/@">@<span class="to-me-count">3</span></a>'
      + '<a class="active" href="/my-feed">my feed</a>'
      + '<a href="/all">all<span class="to-me-count">12</span></a>'
      + '</nav><main>expensive feed body</main>',
  )
})
