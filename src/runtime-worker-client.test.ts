import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseUnavailableError, RuntimeWorkerClient } from './runtime-worker-client'

const directory = mkdtempSync(join(tmpdir(), 'textlog-database-worker-'))
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
  rmSync(directory, { recursive: true, force: true })
})

test('a blocked database worker leaves the main event loop responsive', async () => {
  const blocked = client.testControl('block')
  const started = performance.now()
  await Bun.sleep(20)
  expect(performance.now() - started).toBeLessThan(200)
  await blocked
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
