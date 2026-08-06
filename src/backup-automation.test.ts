import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAutomatedBackup } from './backup-automation'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'textlog-backup-automation-'))
  directories.push(directory)
  const database = new Database(join(directory, 'live.sqlite'), { create: true })
  database.run('CREATE TABLE state(value TEXT); INSERT INTO state VALUES(\'recoverable\'); PRAGMA user_version=14')
  return { directory, database, configuration: { directory: join(directory, 'backups') } }
}

describe('automated local backups', () => {
  test('creates one daily backup and performs one quarterly restore drill across restarts', async () => {
    const { database, configuration } = fixture()
    const now = new Date('2026-08-04T12:00:00Z')
    const first = await runAutomatedBackup(database, configuration, now)
    const second = await runAutomatedBackup(database, configuration, now)

    expect(first.created).toBe(true)
    expect(first.drill).toMatchObject({ quarter: '2026-Q3', status: 'passed', databaseVersion: 14 })
    expect(second).toMatchObject({ created: false, drill: null, path: first.path })
    expect(readdirSync(configuration.directory).filter(name => name.startsWith('textlog-daily-'))).toHaveLength(1)
    expect(readdirSync(join(configuration.directory, 'drills'))).toEqual(['2026-Q3.json'])
    database.close()
  })

  test('posts an optional alert when local backup creation fails', async () => {
    const { database, directory } = fixture()
    const alerts: unknown[] = []
    const fetcher = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      alerts.push(JSON.parse(String(init.body)))
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const configuration = { directory: join(directory, 'live.sqlite', 'invalid'),
      alertWebhookUrl: 'https://monitor.example/alerts' }
    expect(runAutomatedBackup(database, configuration, new Date('2026-08-04T12:00:00Z'), fetcher)).rejects.toThrow()
    expect(alerts).toHaveLength(1)
    database.close()
  })
})
