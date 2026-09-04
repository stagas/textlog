import { expect, test } from 'bun:test'
import { hydrateMaterializedFeedCounts, materializedFeedTemplate } from './database-domain'
import { materializedBody, memoryHitNeedsReadAction, readActionNeedsRerender,
  personalizedReadActionOutOfSync } from './materialized-feed-service'

test('anonymous feed caches never expose unread-counter template tokens', () => {
  const html = '<nav><a href="/hot">hot</a><a href="/all">all</a></nav>'

  expect(materializedBody(html, -1)).toBe(html)
  expect(materializedBody(html, 1)).toContain('all{{latest-count}}')
})

test('materialized feed templates refresh tab counts without rerendering the page', () => {
  const html = '<header><span class="account-nav-row account-nav-secondary"><a href="/explore">explore</a>'
    + '<a href="/drafts">drafts</a></span><span class="account-nav-row account-nav-primary"></span></header><nav>'
    + '<a href="/@">@</a><a class="active" href="/my-feed">my feed<span class="to-me-count">9</span></a>'
    + '<a href="/all">all<span class="to-me-count">4</span></a>'
    + '</nav><main>expensive feed body</main>'
  const template = materializedFeedTemplate(html)

  expect(template).toContain('my feed{{for-you-count}}')
  expect(template).toContain('@{{to-me-count}}')
  expect(template).toContain('all{{latest-count}}')
  expect(template).toContain('{{drafts-link}}')
  expect(hydrateMaterializedFeedCounts(template, { forYou: 0, toMe: 3, latest: 12, drafts: 0 })).toBe(
    '<header><span class="account-nav-row account-nav-secondary"><a href="/explore">explore</a>'
      + '</span><span class="account-nav-row account-nav-primary"></span></header>'
      + '<nav><a href="/@">@<span class="to-me-count">3</span></a>'
      + '<a class="active" href="/my-feed">my feed</a>'
      + '<a href="/all">all<span class="to-me-count">12</span></a>'
      + '</nav><main>expensive feed body</main>',
  )
})

test('materialized feed templates add a drafts link when a first draft is created', () => {
  const html = '<span class="account-nav-row account-nav-secondary"><a href="/explore">explore</a></span>'
    + '<span class="account-nav-row account-nav-primary"></span>'
  const template = materializedFeedTemplate(html)

  expect(hydrateMaterializedFeedCounts(template, { forYou: 0, toMe: 0, latest: 0, drafts: 1 }))
    .toContain('<a href="/drafts">drafts</a>')
})

test('materialized feed templates replace capped counters', () => {
  const html = '<a href="/@">@<span class="to-me-count">99+</span></a>'
    + '<a href="/my-feed">my feed<span class="to-me-count">99+</span></a>'
    + '<a href="/all">all<span class="to-me-count">99+</span></a>'

  expect(materializedFeedTemplate(html)).toBe(
    '<a href="/@">@{{to-me-count}}</a><a href="/my-feed">my feed{{for-you-count}}</a>'
      + '<a href="/all">all{{latest-count}}</a>',
  )
})

test('personalized cache entries detect stale read-all markup', () => {
  const count = '<a href="/my-feed">my feed<span class="to-me-count">99+</span></a>'
  expect(personalizedReadActionOutOfSync('for-you', count)).toBe(true)
  expect(personalizedReadActionOutOfSync('for-you', count
    + '<form action="/my-feed/read-all"></form>')).toBe(false)
  expect(
    personalizedReadActionOutOfSync('for-you',
      '<a href="/my-feed">my feed</a><form action="/my-feed/read-all"></form>'),
  ).toBe(true)
})

test('personalized memory hits always run their page-read action', () => {
  expect(memoryHitNeedsReadAction('for-you', true)).toBe(true)
  expect(memoryHitNeedsReadAction('to-me', true)).toBe(true)
  expect(memoryHitNeedsReadAction('hot', true)).toBe(false)
  expect(memoryHitNeedsReadAction('latest', false)).toBe(true)
})

test('a no-op page-read action does not rebuild cached feed HTML', () => {
  expect(readActionNeedsRerender(false)).toBeFalse()
  expect(readActionNeedsRerender(false, true)).toBeTrue()
  expect(readActionNeedsRerender(true)).toBeTrue()
})
