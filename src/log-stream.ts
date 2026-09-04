import { format } from 'node:util'

export const LOG_HISTORY_LIMIT = 1_000

export type LogEntry = { id: number; text: string }
type Listener = (entry: LogEntry) => void

const history: LogEntry[] = []
const listeners = new Set<Listener>()
let nextId = 1

export function publishLog(values: unknown[]) {
  const entry = { id: nextId++, text: format(...values) }
  history.push(entry)
  if (history.length > LOG_HISTORY_LIMIT) history.splice(0, history.length - LOG_HISTORY_LIMIT)
  for (const listener of listeners) listener(entry)
}

export function openLogStream(listener: Listener, afterId = 0) {
  listeners.add(listener)
  return {
    history: history.filter(entry => entry.id > afterId),
    close: () => listeners.delete(listener),
  }
}

export function logHistory() {
  return history.slice()
}

export function hasLogSubscribers() {
  return listeners.size > 0
}
