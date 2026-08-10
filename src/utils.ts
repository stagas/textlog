import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { db, type User } from './db'
import { markSessionUsed, sessionHash } from './sessions'

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))
export const hash = (p: string) => createHash('sha256').update(p).digest('hex')
export const hashPassword = (password: string) =>
  Bun.password.hash(password, {
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
export const sessionToken = (req: Request) => req.headers.get('cookie')?.match(/(?:^|;\s*)textlog=([^;]+)/)?.[1] || null
export const bearerToken = (req: Request) => req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] || null
function userForSession(token: string | null, database: Database): User | null {
  const tokenHash = sessionHash(token)
  if (!tokenHash) return null
  const user = database.query(`SELECT u.id,u.handle,u.email,u.bio,u.suspended_at,u.email_verified_at,u.handle_chosen_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(tokenHash, Date.now()) as User | null
  if (user) markSessionUsed(database, token!, Date.now())
  return user
}
export function currentUser(req: Request, database: Database = db): User | null {
  return userForSession(sessionToken(req), database)
}
// The API never reads the cookie. A bearer token cannot be attached by another site,
// so write endpoints are not reachable by cross-site requests.
export function apiUser(req: Request, database: Database = db): User | null {
  return userForSession(bearerToken(req), database)
}
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
function highlighted(text: string, terms: string[]) {
  if (!terms.length) return esc(text)
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (!pattern) return esc(text)
  let html = ''
  let end = 0
  for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
    html += esc(text.slice(end, match.index)) + `<mark>${esc(match[0])}</mark>`
    end = match.index + match[0].length
  }
  return html + esc(text.slice(end))
}

function linkAttributes(url: string, appUrl: string | undefined) {
  const opensInNewTab = !appUrl || !url.startsWith(appUrl)
  return opensInNewTab
    ? ' target="_blank" rel="nofollow ugc noopener noreferrer"'
    : ' rel="nofollow ugc"'
}

function linkLabel(url: string, appUrl: string | undefined) {
  if (!appUrl || !url.startsWith(appUrl)) return url
  const relative = url.slice(appUrl.length)
  if (!relative) return '/'
  return relative.startsWith('/') ? relative : `/${relative}`
}

export function linkify(body: string, mentionBios: Record<string, string> = {}, highlightTerms: string[] = [],
  appUrl: string | undefined = Bun.env.APP_URL) {
  const tokens = /\[([^\]\r\n]+)\]\((https?:\/\/[^\s<>")]+)\)|https?:\/\/[^\s<>"]+|(?<![A-Za-z0-9_])[@#][A-Za-z0-9_]+/gi
  let html = ''
  let end = 0
  for (const match of body.matchAll(tokens)) {
    html += highlighted(body.slice(end, match.index), highlightTerms)
    const token = match[0]
    if (match[1] !== undefined && match[2] !== undefined) {
      html += `<a href="${esc(match[2])}" title="${esc(match[2])}"${linkAttributes(match[2], appUrl)}>${
        highlighted(match[1], highlightTerms)
      }</a>`
    }
    else if (/^https?:\/\//i.test(token)) {
      const url = token.replace(/[.,!?;:)]+$/, '')
      const punctuation = token.slice(url.length)
      const label = linkLabel(url, appUrl)
      html += `<a href="${esc(url)}"${label === url ? '' : ` title="${esc(url)}"`}${linkAttributes(url, appUrl)}>${
        highlighted(label, highlightTerms)
      }</a>${
        esc(punctuation)
      }`
    }
    else {
      const value = token.slice(1)
      html += token[0] === '@'
        ? `<a href="/u/${value.toLowerCase()}"${
          mentionBios[value.toLowerCase()] !== undefined
            ? ` title="${esc(mentionBios[value.toLowerCase()] || 'No bio yet.')}"`
            : ''
        }>${highlighted(`@${value}`, highlightTerms)}</a>`
        : `<a href="/tag/${value}">${highlighted(`#${value}`, highlightTerms)}</a>`
    }
    end = match.index + token.length
  }
  return html + highlighted(body.slice(end), highlightTerms)
}
