import { expect, test } from 'bun:test'
import { IdleWorkScheduler } from './idle-work'

test('only requests from qualified addresses postpone idle work', async () => {
  let now = 10_000
  const scheduler = new IdleWorkScheduler(100, () => now)
  scheduler.record('unqualified')
  await scheduler.waitUntilIdle()

  scheduler.record('browser', true)
  now += 100
  await scheduler.waitUntilIdle()
  now += 1
  scheduler.record('browser')
  expect(now).toBe(10_101)
})
