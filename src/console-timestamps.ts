import { publishLog } from './log-stream'

const timestampedConsole = Symbol.for('textlog.timestampedConsole')

export function logTimestamp(date = new Date()) {
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]
  const twoDigits = (value: number) => String(value).padStart(2, '0')
  return `${month} ${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:` +
    `${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`
}

export function installConsoleTimestamps() {
  const timestamped = console as Console & { [timestampedConsole]?: boolean }
  if (timestamped[timestampedConsole]) return

  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console)
    console[level] = (...values: unknown[]) => {
      const timestamp = logTimestamp()
      publishLog([timestamp, ...values])
      original(timestamp, ...values)
    }
  }
  timestamped[timestampedConsole] = true
}

installConsoleTimestamps()
