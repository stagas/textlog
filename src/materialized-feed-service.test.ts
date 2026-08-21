import { expect, test } from 'bun:test'
import { refreshMaterializedTimestamps } from './materialized-feed-service'

test('refreshes production cached timestamps with full text', () => {
  const html = '<time dateTime="2026-08-21 10:00:00" title="full date">2h</time>'
  const now = Date.parse('2026-08-21T12:00:00Z')

  expect(refreshMaterializedTimestamps(html, now))
    .toBe('<time dateTime="2026-08-21 10:00:00" title="full date">2 hours ago</time>')
})
