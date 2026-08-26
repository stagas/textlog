import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { configureDatabaseService } from './database-service'
import { db } from './db'
import { logInfo } from './log'
import type { MainToRuntimeMessage, RuntimeToMainMessage } from './runtime-worker-protocol'

declare const self: Worker

configureDatabaseService({
  async call(operation, input) {
    return await executeDatabaseDomain(db, operation, input)
  },
})

function send(message: RuntimeToMainMessage) {
  self.postMessage(message)
}

type QueuedDomainMessage = Extract<MainToRuntimeMessage, { type: 'domain' }> & { queuedAt: number }
const foregroundQueue: QueuedDomainMessage[] = []
const backgroundQueue: QueuedDomainMessage[] = []
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
    const started = performance.now()
    try {
      const result = await executeDatabaseDomain(db, message.operation, message.input)
      send({ type: 'domainResult', id: message.id, result })
    }
    catch (error) {
      const value = error instanceof Error ? error : new Error(String(error))
      send({ type: 'error', id: message.id, error: { name: value.name, message: value.message, stack: value.stack } })
    }
    const finished = performance.now()
    const durationMs = finished - started
    const queueMs = started - message.queuedAt
    const slowMs = Number(Bun.env.DATABASE_SLOW_OPERATION_MS || 250)
    if (Bun.env.DATABASE_LOG_SLOW_OPERATIONS === 'true' && (durationMs >= slowMs || queueMs >= slowMs)) {
      logInfo(
        `database operation=${message.operation} priority=${message.priority} duration_ms=${durationMs.toFixed(1)}`
          + ` queue_ms=${queueMs.toFixed(1)} foreground_queued=${foregroundQueue.length}`
          + ` background_queued=${backgroundQueue.length}`,
      )
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

self.onmessage = event => {
  const message = event.data as MainToRuntimeMessage
  if (message.type === 'testControl') {
    if (message.action === 'crash') process.exit(70)
    const until = performance.now() + 500
    while (performance.now() < until) {}
    send({ type: 'domainResult', id: message.id, result: null })
    return
  }
  const queued = { ...message, queuedAt: performance.now() }
  if (message.priority === 'background') backgroundQueue.push(queued)
  else foregroundQueue.push(queued)
  scheduleDrain()
}

send({ type: 'ready' })
