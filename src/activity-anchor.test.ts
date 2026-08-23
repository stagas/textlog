import { expect, test } from 'bun:test'
import { activityAnchor } from './activity-anchor'

test('activity anchors are compact, stable, and distinguish events', () => {
  const eventKey = 'user-follow:00000000000000000062:00000000000000000275:2026-08-23 08:30:47'
  const anchor = activityAnchor(eventKey)

  expect(anchor).toBe(activityAnchor(eventKey))
  expect(anchor).toMatch(/^a-[A-Za-z0-9_-]{12}$/)
  expect(anchor).not.toContain('00000000000000000062')
  expect(anchor).not.toBe(activityAnchor(`${eventKey}.001`))
})
