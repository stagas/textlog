import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseUnavailableError, RuntimeWorkerClient } from './runtime-worker-client'

const directory = mkdtempSync(join(tmpdir(), 'textlog-database-worker-'))
const originalEnvironment = {
  NODE_ENV: Bun.env.NODE_ENV,
  DATABASE_PATH: Bun.env.DATABASE_PATH,
  CACHE_DATABASE_PATH: Bun.env.CACHE_DATABASE_PATH,
}
let client: RuntimeWorkerClient

beforeAll(async () => {
  Bun.env.NODE_ENV = 'test'
  Bun.env.DATABASE_PATH = join(directory, 'primary.sqlite')
  Bun.env.CACHE_DATABASE_PATH = join(directory, 'cache.sqlite')
  client = new RuntimeWorkerClient(new URL('./runtime-worker.ts', import.meta.url), true)
  await client.ready()
})

afterAll(() => {
  client.terminate()
  if (originalEnvironment.NODE_ENV === undefined) delete Bun.env.NODE_ENV
  else Bun.env.NODE_ENV = originalEnvironment.NODE_ENV
  if (originalEnvironment.DATABASE_PATH === undefined) delete Bun.env.DATABASE_PATH
  else Bun.env.DATABASE_PATH = originalEnvironment.DATABASE_PATH
  if (originalEnvironment.CACHE_DATABASE_PATH === undefined) delete Bun.env.CACHE_DATABASE_PATH
  else Bun.env.CACHE_DATABASE_PATH = originalEnvironment.CACHE_DATABASE_PATH
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
  const background = Array.from({ length: 30 }, (_, index) => client.callBackground(
    'system.health', { databasePath: Bun.env.DATABASE_PATH! }).then(() => completed.push(`background-${index}`)))
  const foreground = client.call('system.health', { databasePath: Bun.env.DATABASE_PATH! })
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
  const health = await client.call('system.health', { databasePath: Bun.env.DATABASE_PATH! })
  expect(health.busyTimeoutMs).toBeGreaterThan(0)
})
