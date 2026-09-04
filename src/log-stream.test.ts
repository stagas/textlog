import { expect, test } from 'bun:test'
import { hasLogSubscribers, LOG_HISTORY_LIMIT, logHistory, openLogStream, publishLog } from './log-stream'

test('log stream retains and replays only the latest 1,000 entries', () => {
  const prefix = crypto.randomUUID()
  for (let index = 0; index < LOG_HISTORY_LIMIT + 5; index++) publishLog([prefix, index])

  const replay = logHistory().filter(entry => entry.text.startsWith(prefix))
  expect(replay).toHaveLength(LOG_HISTORY_LIMIT)
  expect(replay[0].text).toBe(`${prefix} 5`)
  expect(replay.at(-1)?.text).toBe(`${prefix} ${LOG_HISTORY_LIMIT + 4}`)
})

test('log stream subscribers receive ANSI payloads unchanged and can unsubscribe', () => {
  const received: string[] = []
  const stream = openLogStream(entry => received.push(entry.text))
  expect(hasLogSubscribers()).toBe(true)
  publishLog(['\x1b[31merror\x1b[0m'])
  stream.close()
  expect(hasLogSubscribers()).toBe(false)
  publishLog(['after close'])

  expect(received).toEqual(['\x1b[31merror\x1b[0m'])
})

test('log stream replay resumes after the last received event ID', () => {
  publishLog(['before resume'])
  const lastSeen = logHistory().at(-1)!.id
  publishLog(['after resume'])

  const stream = openLogStream(() => undefined, lastSeen)
  expect(stream.history.map(entry => entry.text)).toEqual(['after resume'])
  stream.close()
})
