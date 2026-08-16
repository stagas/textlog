import { AsyncLocalStorage } from 'node:async_hooks'

export const DEFAULT_TIMEZONE = 'UTC'

export const TIMEZONE_CHOICES = [
  { value: 'Etc/GMT+12', label: 'UTC -12 — Baker Island' },
  { value: 'Pacific/Pago_Pago', label: 'UTC -11 — American Samoa, Niue' },
  { value: 'Pacific/Honolulu', label: 'UTC -10 — Hawaii, Tahiti' },
  { value: 'America/Anchorage', label: 'UTC -09/-08 — Anchorage, Juneau' },
  { value: 'America/Los_Angeles', label: 'UTC -08/-07 — Los Angeles, Vancouver, Tijuana' },
  { value: 'America/Denver', label: 'UTC -07/-06 — Denver, Edmonton' },
  { value: 'America/Chicago', label: 'UTC -06/-05 — Chicago, Winnipeg' },
  { value: 'America/New_York', label: 'UTC -05/-04 — New York, Toronto' },
  { value: 'America/Halifax', label: 'UTC -04/-03 — Halifax, Bermuda' },
  { value: 'America/Argentina/Buenos_Aires', label: 'UTC -03 — Buenos Aires, Montevideo' },
  { value: 'America/Noronha', label: 'UTC -02 — Fernando de Noronha, South Georgia' },
  { value: 'Atlantic/Cape_Verde', label: 'UTC -01 — Cape Verde' },
  { value: DEFAULT_TIMEZONE, label: 'UTC ±00 — Accra, Reykjavík' },
  { value: 'Europe/London', label: 'UTC ±00/+01 — London, Dublin, Lisbon' },
  { value: 'Europe/Paris', label: 'UTC +01/+02 — Paris, Berlin, Rome' },
  { value: 'Europe/Athens', label: 'UTC +02/+03 — Athens, Helsinki, Bucharest' },
  { value: 'Europe/Istanbul', label: 'UTC +03 — Istanbul, Moscow, Nairobi' },
  { value: 'Asia/Dubai', label: 'UTC +04 — Dubai, Muscat' },
  { value: 'Asia/Karachi', label: 'UTC +05 — Karachi, Tashkent, Maldives' },
  { value: 'Asia/Dhaka', label: 'UTC +06 — Dhaka, Thimphu' },
  { value: 'Asia/Bangkok', label: 'UTC +07 — Bangkok, Hanoi, Jakarta' },
  { value: 'Asia/Singapore', label: 'UTC +08 — Singapore, Beijing, Perth' },
  { value: 'Asia/Tokyo', label: 'UTC +09 — Tokyo, Seoul, Osaka' },
  { value: 'Australia/Sydney', label: 'UTC +10/+11 — Sydney, Melbourne, Hobart' },
  { value: 'Pacific/Noumea', label: 'UTC +11 — Nouméa, Solomon Islands' },
  { value: 'Pacific/Auckland', label: 'UTC +12/+13 — Auckland, Wellington, Fiji' },
] as const

const timezoneContext = new AsyncLocalStorage<string>()
const validTimezones = new Set<string>(TIMEZONE_CHOICES.map(choice => choice.value))

export function validTimezone(value: string | null | undefined): value is string {
  return !!value && validTimezones.has(value)
}

export function withTimezone<T>(timezone: string | null | undefined, callback: () => T) {
  return timezoneContext.run(validTimezone(timezone) ? timezone : DEFAULT_TIMEZONE, callback)
}

export function activeTimezone() {
  return timezoneContext.getStore() || DEFAULT_TIMEZONE
}

export function timezoneLabel(timezone: string, date = new Date()) {
  const part = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(date).find(candidate => candidate.type === 'timeZoneName')?.value || 'GMT'
  if (part === 'GMT') return 'UTC ±00'
  const match = part.match(/^GMT([+-])(\d{2}):?(\d{2})$/)
  if (!match) return part.replace('GMT', 'UTC ')
  return `UTC ${match[1]}${match[2]}${match[3] === '00' ? '' : `:${match[3]}`}`
}
