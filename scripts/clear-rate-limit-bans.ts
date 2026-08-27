import { Database } from 'bun:sqlite'
import { defaultDatabasePath } from '../src/database-backup'
import { clearRateLimitBans } from '../src/rate-limit-bans'

const database = new Database(defaultDatabasePath, { strict: true })

try {
  database.run(`PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=${Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)};`)
  const cleared = clearRateLimitBans(database)
  console.log(`Cleared rate-limit state from ${defaultDatabasePath}:`)
  console.log(`  authentication attempts: ${cleared.authAttempts}`)
  console.log(`  API buckets: ${cleared.apiBuckets}`)
  console.log(`  blocked IPs: ${cleared.blockedIps}`)
  console.log('Restart the server to clear in-memory HTTP limits and its blocked-IP cache.')
}
finally {
  database.close()
}
