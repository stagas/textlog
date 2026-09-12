import { activeTimezone } from '../timezone'

type PostAgeWording = 'just' | 'recently' | 'earlier' | 'a while ago' | 'some time ago' | 'a long time ago'
export type PostAge = { label: string; wording: PostAgeWording }

export function approximatePostAge(createdAt: string, now = Date.now()): PostAge {
  const timestamp = Date.parse(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (elapsedMinutes < 60) return { label: `${elapsedMinutes}mins`, wording: 'just' }
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedMinutes < 12 * 60) return { label: `${elapsedHours}h`, wording: 'recently' }
  const elapsedDays = Math.max(1, Math.floor(elapsedMinutes / (24 * 60)))
  if (elapsedMinutes < 3 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'earlier' }
  if (elapsedMinutes < 14 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'a while ago' }
  if (elapsedMinutes < 90 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'some time ago' }
  return { label: 'older', wording: 'a long time ago' }
}

export function shortPostAge(createdAt: string, now = Date.now()) {
  const timestamp = Date.parse(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (days < 60) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (days < 365) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

export function postAgeTitle(createdAt: string, now = Date.now()) {
  const date = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const elapsedMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000))
  const { wording } = approximatePostAge(createdAt, now)
  const relative = wording === 'just' ? 'just now'
    : elapsedMinutes < 24 * 60 ? wording
    : elapsedMinutes >= 365 * 24 * 60 ? `${Math.round(elapsedMinutes / (365 * 24 * 60))}y ago`
    : elapsedMinutes >= 30 * 24 * 60 ? `${Math.round(elapsedMinutes / (30 * 24 * 60))}mo ago`
    : elapsedMinutes > 7 * 24 * 60 ? `${Math.round(elapsedMinutes / (7 * 24 * 60))}w ago`
    : `${Math.round(elapsedMinutes / (24 * 60))}d ago`
  const monthYear = new Intl.DateTimeFormat('en', {
    month: 'short', year: 'numeric', timeZone: activeTimezone(),
  }).format(date)
  return `${monthYear}, ${relative}`
}

export function ageContextLabel(label: string, wording: PostAge['wording']) {
  const plain = label.replace(/:$/, '')
  const mentionSuffix = ' and mentioned you'
  const hasMention = plain.endsWith(mentionSuffix)
  const attribution = hasMention ? plain.slice(0, -mentionSuffix.length) : plain
  const aged = wording === 'just' ? `${attribution} just now` : `${attribution} ${wording}`
  return aged + (hasMention ? mentionSuffix : '') + ':'
}
