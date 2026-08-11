import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { LinkifyIt } from 'linkify-it'
import tlds from 'tlds'
import { db, type User } from './db'
import { markSessionUsed, sessionHash } from './sessions'
import { userForApiKey } from './api-keys'
import { sessionCookieName } from './brand'

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
export const sessionToken = (req: Request) => {
  const name = sessionCookieName()
  return req.headers.get('cookie')?.split(';').map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1) || null
}
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
  const value = bearerToken(req)
  return userForApiKey(database, value) || userForSession(value, database)
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

const urlMatcher = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false })
  .tlds(tlds)

type LinkToken = {
  index: number
  lastIndex: number
  kind: 'code' | 'code-fence' | 'markdown' | 'url' | 'reference'
  raw: string
  url?: string
  label?: string
}

function linkTokens(body: string): LinkToken[] {
  const tokens: LinkToken[] = []
  for (const match of body.matchAll(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```(?=\r?$)/gm)) {
    tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'code-fence',
      raw: match[0], label: match[1] })
  }
  for (const match of body.matchAll(/`([^`\r\n]+)`/g)) {
    tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'code',
      raw: match[0], label: match[1] })
  }
  for (const match of body.matchAll(/\[([^\]\r\n]+)\]\((https?:\/\/[^\s<>")]+)\)/gi)) {
    tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'markdown',
      raw: match[0], label: match[1], url: match[2] })
  }
  for (const match of urlMatcher.match(body) || []) {
    // Protocol-less domains default to HTTPS. Explicit schemes remain untouched.
    const url = match.schema ? match.url : `https://${match.raw}`
    tokens.push({ index: match.index, lastIndex: match.lastIndex, kind: 'url', raw: match.raw, url })
  }
  for (const match of body.matchAll(/(?<![A-Za-z0-9_])[@#][A-Za-z0-9_]+/g)) {
    tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'reference', raw: match[0] })
  }
  const priority = { 'code-fence': 0, code: 1, markdown: 2, url: 3, reference: 4 }
  return tokens.sort((a, b) => a.index - b.index || priority[a.kind] - priority[b.kind])
}

export function linkify(body: string, mentionBios: Record<string, string> = {}, highlightTerms: string[] = [],
  appUrl: string | undefined = Bun.env.APP_URL) {
  let html = ''
  let end = 0
  for (const match of linkTokens(body)) {
    if (match.index < end) continue
    html += highlighted(body.slice(end, match.index), highlightTerms)
    const token = match.raw
    if (match.kind === 'code' || match.kind === 'code-fence') {
      html += `<code${match.kind === 'code-fence' ? ' class="code-fence"' : ''}>${esc(match.label)}</code>`
    }
    else if (match.kind === 'markdown') {
      html += `<a href="${esc(match.url)}" title="${esc(match.url)}"${linkAttributes(match.url!, appUrl)}>${
        highlighted(match.label!, highlightTerms)
      }</a>`
    }
    else if (match.kind === 'url') {
      const url = match.url!
      const label = linkLabel(url, appUrl)
      html += `<a href="${esc(url)}"${label === url ? '' : ` title="${esc(url)}"`}${linkAttributes(url, appUrl)}>${
        highlighted(label === url ? token : label, highlightTerms)
      }</a>`
    }
    else {
      const value = token.slice(1)
      html += token[0] === '@'
        ? `<a href="/u/${value.toLowerCase()}"${
          mentionBios[value.toLowerCase()] !== undefined
            ? ` title="${esc(mentionBios[value.toLowerCase()] || 'No bio yet.')}"`
            : ''
        }>${highlighted(`@${value}`, highlightTerms)}</a>`
        : `<a href="/tag/${value.toLowerCase()}">${highlighted(`#${value}`, highlightTerms)}</a>`
    }
    end = match.lastIndex
  }
  return html + highlighted(body.slice(end), highlightTerms)
}
