import './console-timestamps'
import { cacheDb, clearCacheDatabase } from './cache-db'
import { executeDatabaseDomain, normalizeExistingWordNetTags } from './database-domain'
import { formatQueryMetrics, measuredDatabase } from './database-query-metrics'
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
let drainTimer: ReturnType<typeof setTimeout> | undefined
const BACKGROUND_IDLE_DELAY_MS = 25

function scheduleDrain() {
  if (processing || drainScheduled || (!foregroundQueue.length && !backgroundQueue.length)) return
  drainScheduled = true
  // Give incoming page requests a short window to overtake cache maintenance and warming. Background work is still
  // guaranteed to run during an idle period, but a burst of navigation does not get stuck behind work which is not
  // needed for the current response.
  drainTimer = setTimeout(() => {
    drainTimer = undefined
    drainScheduled = false
    void drainQueue()
  }, foregroundQueue.length ? 0 : BACKGROUND_IDLE_DELAY_MS)
}

async function drainQueue() {
  if (processing) return
  processing = true
  try {
    const message = foregroundQueue.shift() || backgroundQueue.shift()
    if (!message) return
    const started = performance.now()
    const measureQueries = Bun.env.FEED_QUERY_METRICS === 'true'
      && (message.operation === 'feeds.latestPage' || message.operation === 'feeds.personalizedPage')
    const measurement = measureQueries ? measuredDatabase(db) : undefined
    try {
      const result = await executeDatabaseDomain(measurement?.database || db, message.operation, message.input)
      send({ type: 'domainResult', id: message.id, result })
    }
    catch (error) {
      const value = error instanceof Error ? error : new Error(String(error))
      send({ type: 'error', id: message.id, error: { name: value.name, message: value.message, stack: value.stack } })
    }
    const finished = performance.now()
    const durationMs = finished - started
    const queueMs = started - message.queuedAt
    if (measurement) {
      const minimumMs = Math.max(0, Number(Bun.env.FEED_QUERY_METRICS_MIN_MS || 1))
      const limit = Math.max(1, Number(Bun.env.FEED_QUERY_METRICS_LIMIT || 10))
      for (const metric of formatQueryMetrics(message.operation, measurement.metrics, minimumMs, limit)) {
        logInfo(metric)
      }
    }
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
clearCacheDatabase(cacheDb)
await normalizeExistingWordNetTags(db)

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
  if (message.priority !== 'background' && drainScheduled && drainTimer) {
    clearTimeout(drainTimer)
    drainTimer = undefined
    drainScheduled = false
  }
  scheduleDrain()
}

send({ type: 'ready' })
