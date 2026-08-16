import { AsyncLocalStorage } from 'node:async_hooks'

export const DEFAULT_TIMEZONE = 'UTC'

const places = [
  'Baker Island',
  'American Samoa, Niue',
  'Hawaii, Tahiti',
  'Alaska, Gambier Islands',
  'Los Angeles, Vancouver, Tijuana',
  'Denver, Phoenix, Edmonton',
  'Chicago, Mexico City, Guatemala City',
  'New York, Toronto, Lima',
  'Halifax, Caracas, Santo Domingo',
  'Buenos Aires, São Paulo, Montevideo',
  'South Georgia, Fernando de Noronha',
  'Azores, Cape Verde',
  'London, Dublin, Lisbon, Accra',
  'Paris, Berlin, Rome, Lagos',
  'Athens, Cairo, Helsinki, Johannesburg',
  'Istanbul, Moscow, Nairobi, Riyadh',
  'Dubai, Baku, Tbilisi, Muscat',
  'Karachi, Tashkent, Maldives',
  'Dhaka, Thimphu, Almaty',
  'Bangkok, Hanoi, Jakarta',
  'Beijing, Singapore, Perth, Manila',
  'Tokyo, Seoul, Osaka',
  'Sydney, Brisbane, Port Moresby',
  'Nouméa, Solomon Islands, Vanuatu',
  'Auckland, Fiji, Marshall Islands',
] as const

function timezoneForOffset(offset: number) {
  if (offset === 0) return DEFAULT_TIMEZONE
  // The signs in the IANA Etc/GMT names are intentionally reversed.
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

function offsetLabel(offset: number) {
  if (offset === 0) return 'UTC ±00'
  return `UTC ${offset > 0 ? '+' : '-'}${String(Math.abs(offset)).padStart(2, '0')}`
}

export const TIMEZONE_CHOICES = places.map((placeNames, index) => {
  const offset = index - 12
  return { value: timezoneForOffset(offset), label: `${offsetLabel(offset)} — ${placeNames}`, offset }
})

const timezoneContext = new AsyncLocalStorage<string>()
const validTimezones = new Set(TIMEZONE_CHOICES.map(choice => choice.value))

export function validTimezone(value: string | null | undefined): value is string {
  return !!value && validTimezones.has(value)
}

export function withTimezone<T>(timezone: string | null | undefined, callback: () => T) {
  return timezoneContext.run(validTimezone(timezone) ? timezone : DEFAULT_TIMEZONE, callback)
}

export function activeTimezone() {
  return timezoneContext.getStore() || DEFAULT_TIMEZONE
}

export function timezoneLabel(timezone: string) {
  const choice = TIMEZONE_CHOICES.find(candidate => candidate.value === timezone)
  return choice ? offsetLabel(choice.offset) : 'UTC ±00'
}
