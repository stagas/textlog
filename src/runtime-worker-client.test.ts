import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseUnavailableError, RuntimeWorkerClient } from './runtime-worker-client'

const directory = mkdtempSync(join(tmpdir(), 'textlog-database-worker-'))
const databasePath = join(directory, 'primary.sqlite')
const cacheDatabasePath = join(directory, 'cache.sqlite')
let client: RuntimeWorkerClient

beforeAll(async () => {
  client = new RuntimeWorkerClient(new URL('./runtime-worker.ts', import.meta.url), {
    allowTestControls: true,
    env: { NODE_ENV: 'test', DATABASE_PATH: databasePath, CACHE_DATABASE_PATH: cacheDatabasePath },
  })
  await client.ready()
}, 30_000)

afterAll(() => {
  client.terminate()
  rmSync(directory, { recursive: true, force: true })
})

test('a blocked database worker leaves the main event loop responsive', async () => {
  const blocked = client.testControl('block')
  const started = performance.now()
  await Bun.sleep(20)
  expect(performance.now() - started).toBeLessThan(200)
  await blocked
})

test('foreground calls overtake queued background work', async () => {
  const completed: string[] = []
  const background = Array.from({ length: 30 }, (_, index) =>
    client.callBackground(
      'system.health',
      { databasePath },
    ).then(() => completed.push(`background-${index}`)))
  const foreground = client.call('system.health', { databasePath })
    .then(() => completed.push('foreground'))
  await Promise.all([...background, foreground])
  expect(completed.indexOf('foreground')).toBeLessThan(completed.length - 1)
})

test('a crash rejects pending work without replay and automatically recovers', async () => {
  const pending = client.testControl('crash')
  await expect(pending).rejects.toBeInstanceOf(DatabaseUnavailableError)
  expect(['unavailable', 'restarting']).toContain(client.state)
  await client.ready()
  expect(client.state).toBe('ready')
  const health = await client.call('system.health', { databasePath })
  expect(health.busyTimeoutMs).toBeGreaterThan(0)
})
