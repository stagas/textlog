import { Database } from 'bun:sqlite'
import { runAutomatedBackup } from './backup-automation'
import { defaultDatabasePath } from './database-backup'
import { archivePrivacyIsCurrent, createPublicArchive, publicArchiveIsCurrent } from './public-archive'

declare const self: Worker

type Request = {
  id: number
  operation: 'archive' | 'backup'
  path?: string
  directory?: string
  now: string
}

const database = new Database(defaultDatabasePath, { create: false, strict: true })
const busyTimeoutMs = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
database.run(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
  PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=${busyTimeoutMs};`)

self.onmessage = async event => {
  const request = event.data as Request
  try {
    const now = new Date(request.now)
    const result = request.operation === 'archive'
      ? publicArchiveIsCurrent(request.path!, now) && archivePrivacyIsCurrent(database, request.path!)
        ? null
        : null //await createPublicArchive(database, request.path!, now)
      : null //await runAutomatedBackup(database, { directory: request.directory!, alertWebhookUrl: null }, now)
    self.postMessage({ id: request.id, result })
  }
  catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.stack || error.message : String(error) })
  }
}
