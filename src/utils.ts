import { createHash, randomBytes } from 'node:crypto'
import { db, type User } from './db'

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const hash = (p: string) => createHash('sha256').update(p).digest('hex')
export const hashPassword = (password: string) => Bun.password.hash(password, {
  algorithm: 'argon2id',
  memoryCost: 65536,
  timeCost: 3,
})
export async function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith('$argon2id$')) return Bun.password.verify(password, storedHash)
  // Accounts created before Argon2id are upgraded after their next successful login.
  return storedHash === hash(password)
}
export const token = () => randomBytes(32).toString('hex')
export function currentUser(req: Request): User | null { const t = req.headers.get('cookie')?.match(/root=([^;]+)/)?.[1]; if (!t) return null; return db.query('SELECT u.id,u.handle,u.email,u.bio FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.deleted_at IS NULL').get(t, Date.now()) as User | null }
const timestamp = (d: string) => new Date(d.replace(' ', 'T') + 'Z')
export function fmt(d: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp(d).getTime()) / 1000))
  if (seconds < 60) return `${Math.max(1, seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}
export const fmtFull = (d: string) => timestamp(d).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
export function linkify(body: string) {
  const tokens = /https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])[@#][A-Za-z0-9_]+/gi
  let html = ''
  let end = 0
  for (const match of body.matchAll(tokens)) {
    html += esc(body.slice(end, match.index))
    const token = match[0]
    if (/^https?:\/\//i.test(token)) {
      const url = token.replace(/[.,!?;:]+$/, '')
      const punctuation = token.slice(url.length)
      html += `<a href="${esc(url)}" rel="nofollow ugc">${esc(url)}</a>${esc(punctuation)}`
    }
    else {
      const value = token.slice(1)
      html += token[0] === '@'
        ? `<a href="/u/${value.toLowerCase()}">@${value}</a>`
        : `<a href="/tag/${value}">#${value}</a>`
    }
    end = match.index + token.length
  }
  return html + esc(body.slice(end))
}
