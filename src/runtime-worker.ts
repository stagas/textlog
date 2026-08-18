import type { MainToRuntimeMessage, RuntimeToMainMessage } from './runtime-worker-protocol'
import { executeDatabaseDomain } from './database-domain'
import { db } from './db'
import { cacheDb } from './cache-db'
import { configureDatabaseService } from './database-service'

declare const self: Worker

configureDatabaseService({
  async call(operation, input) {
    return await executeDatabaseDomain(db, operation, input)
  },
})

function send(message: RuntimeToMainMessage) {
  self.postMessage(message)
}

let queue = Promise.resolve()

// Every Worker generation owns and validates both connections before advertising readiness.
db.query('SELECT 1').get()
cacheDb.query('SELECT 1').get()
cacheDb.run('DELETE FROM materialized_feed_pages_v2')

self.onmessage = event => {
  const message = event.data as MainToRuntimeMessage
  if (message.type === 'testControl') {
    if (Bun.env.NODE_ENV !== 'test') return
    if (message.action === 'crash') process.exit(70)
    const until = performance.now() + 500
    while (performance.now() < until) {}
    send({ type: 'domainResult', id: message.id, result: null })
    return
  }
  queue = queue.then(async () => {
    try {
      const result = await executeDatabaseDomain(db, message.operation, message.input)
      send({ type: 'domainResult', id: message.id, result })
    }
    catch (error) {
      const value = error instanceof Error ? error : new Error(String(error))
      send({ type: 'error', id: message.id,
        error: { name: value.name, message: value.message, stack: value.stack } })
    }
  })
}

send({ type: 'ready' })
