import { databaseService, type DatabaseService } from './database-service'
import { logError } from './log'

const quietDelayMs = 10_000
const maximumDelayMs = 30_000
const batchSize = 100

let quietTimer: ReturnType<typeof setTimeout> | undefined
let maximumTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false
let scheduledService: DatabaseService | undefined

function clearTimers() {
  if (quietTimer) clearTimeout(quietTimer)
  if (maximumTimer) clearTimeout(maximumTimer)
  quietTimer = undefined
  maximumTimer = undefined
}

async function flush() {
  if (flushing) return
  flushing = true
  clearTimers()
  try {
    const service = scheduledService ?? databaseService()
    const call = service.callBackground?.bind(service) ?? service.call.bind(service)
    let result = await call('feeds.flushRelationshipInvalidation', { limit: batchSize })
    while (result.remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
      result = await call('feeds.flushRelationshipInvalidation', { limit: batchSize })
    }
  }
  catch (error) {
    logError('relationship feed invalidation flush failed', error)
    scheduleRelationshipFeedInvalidation()
  }
  finally {
    flushing = false
  }
}

export function scheduleRelationshipFeedInvalidation(service?: DatabaseService) {
  if (service) scheduledService = service
  if (quietTimer) clearTimeout(quietTimer)
  quietTimer = setTimeout(() => void flush(), quietDelayMs)
  quietTimer.unref?.()
  if (!maximumTimer) maximumTimer = setTimeout(() => void flush(), maximumDelayMs)
  maximumTimer.unref?.()
}

export function resumeRelationshipFeedInvalidation() {
  scheduledService = undefined
  scheduleRelationshipFeedInvalidation()
}
