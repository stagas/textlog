import { expect, test } from 'bun:test'
import { hydrateMaterializedFeedCounts, materializedFeedTemplate } from './database-domain'

test('materialized feed templates refresh tab counts without rerendering the page', () => {
  const html = '<nav>'
    + '<a class="active" href="/for-you">for you<span class="to-me-count">9</span></a>'
    + '<a href="/to-me">to me</a><a href="/latest">latest<span class="to-me-count">4</span></a>'
    + '</nav><main>expensive feed body</main>'
  const template = materializedFeedTemplate(html)

  expect(template).toContain('for you{{for-you-count}}')
  expect(template).toContain('to me{{to-me-count}}')
  expect(template).toContain('latest{{latest-count}}')
  expect(hydrateMaterializedFeedCounts(template, { forYou: 0, toMe: 3, latest: 12 })).toBe(
    '<nav><a class="active" href="/for-you">for you</a>'
      + '<a href="/to-me">to me<span class="to-me-count">3</span></a>'
      + '<a href="/latest">latest<span class="to-me-count">12</span></a>'
      + '</nav><main>expensive feed body</main>',
  )
})
