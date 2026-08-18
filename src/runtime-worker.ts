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

const foregroundQueue: Extract<MainToRuntimeMessage, { type: 'domain' }>[] = []
const backgroundQueue: Extract<MainToRuntimeMessage, { type: 'domain' }>[] = []
let processing = false
let drainScheduled = false

function scheduleDrain() {
  if (processing || drainScheduled || (!foregroundQueue.length && !backgroundQueue.length)) return
  drainScheduled = true
  setTimeout(() => {
    drainScheduled = false
    void drainQueue()
  }, 0)
}

async function drainQueue() {
  if (processing) return
  processing = true
  try {
    const message = foregroundQueue.shift() || backgroundQueue.shift()
    if (!message) return
    try {
      const result = await executeDatabaseDomain(db, message.operation, message.input)
      send({ type: 'domainResult', id: message.id, result })
    }
    catch (error) {
      const value = error instanceof Error ? error : new Error(String(error))
      send({ type: 'error', id: message.id,
        error: { name: value.name, message: value.message, stack: value.stack } })
    }
  }
  finally {
    processing = false
    scheduleDrain()
  }
}

// Every Worker generation owns and validates both connections before advertising readiness.
db.query('SELECT 1').get()
cacheDb.query('SELECT 1').get()
cacheDb.run('DELETE FROM materialized_feed_pages_v2')

self.onmessage = event => {
  const message = event.data as MainToRuntimeMessage
  if (message.type === 'testControl') {
    if (message.action === 'crash') process.exit(70)
    const until = performance.now() + 500
    while (performance.now() < until) {}
    send({ type: 'domainResult', id: message.id, result: null })
    return
  }
  if (message.priority === 'background') backgroundQueue.push(message)
  else foregroundQueue.push(message)
  scheduleDrain()
}

send({ type: 'ready' })
