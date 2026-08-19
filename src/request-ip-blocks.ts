import { backgroundDatabaseCall, databaseService } from './database-service'
import { ipPseudonym } from './ip-privacy'
import { logError } from './log'

export type DailyIpRequest = { hash: string; obfuscated: string; requests: number; blocked: boolean }

const pending = new Map<string, { day: string; hash: string; requests: number }>()
const blocked = new Set<string>()
let flushing = false

export function requestIpIdentity(address: string, at = new Date()) {
  const day = at.toISOString().slice(0, 10)
  return { day, hash: ipPseudonym(address, 'http-log', at) }
}

export function recordIpRequest(address: string, at = new Date()) {
  if (!address || address === '-') return
  const identity = requestIpIdentity(address, at)
  const key = `${identity.day}:${identity.hash}`
  const current = pending.get(key)
  pending.set(key, { ...identity, requests: (current?.requests || 0) + 1 })
  if (pending.size >= 100) void flushIpRequests().catch(error => logError('IP request buffer flush failed', error))
}

export function isIpBlocked(address: string, at = new Date()) {
  const { day, hash } = requestIpIdentity(address, at)
  return blocked.has(`${day}:${hash}`)
}

export function cacheBlockedIp(day: string, hash: string) {
  blocked.add(`${day}:${hash}`)
}

export async function loadBlockedIps(day = new Date().toISOString().slice(0, 10)) {
  blocked.clear()
  const hashes = await databaseService().call('system.blockedIps', { day })
  for (const hash of hashes) blocked.add(`${day}:${hash}`)
}

export async function flushIpRequests() {
  if (flushing) return
  const entries = [...pending.values()]
  if (!entries.length) return
  flushing = true
  try {
    await backgroundDatabaseCall('maintenance.flushIpRequests', { entries })
    for (const entry of entries) {
      const key = `${entry.day}:${entry.hash}`
      if (pending.get(key) === entry) pending.delete(key)
    }
  }
  finally {
    flushing = false
  }
}
