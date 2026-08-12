import type { Database } from 'bun:sqlite'
import { LinkifyIt } from 'linkify-it'
import { createHash, randomBytes } from 'node:crypto'
import tlds from 'tlds'
import { userForApiKey } from './api-keys'
import { sessionCookieName } from './brand'
import { MAX_HASHTAGS_PER_POST, type PostContentFlags } from './content'
import { db, type User } from './db'
import { texToMathML } from './math'
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

function markdownUrl(destination: string) {
  if (/^https?:\/\//i.test(destination)) return destination
  const matches = urlMatcher.match(destination)
  const match = matches?.length === 1 ? matches[0] : null
  return match && match.index === 0 && match.lastIndex === destination.length && !match.schema
    ? `https://${destination}`
    : null
}

type LinkToken = {
  index: number
  lastIndex: number
  kind: 'code' | 'code-fence' | 'latex-fence' | 'math' | 'markdown' | 'url' | 'reference'
  raw: string
  url?: string
  label?: string
  display?: boolean
}

function escapedAt(body: string, index: number) {
  let slashes = 0
  while (index > slashes && body[index - slashes - 1] === '\\') slashes++
  return slashes % 2 === 1
}

function mathTokens(body: string, protectedTokens: LinkToken[]) {
  const tokens: LinkToken[] = []
  const protectedRanges = protectedTokens
    .filter(token => token.kind === 'code' || token.kind === 'code-fence' || token.kind === 'latex-fence')
    .sort((a, b) => a.index - b.index)
  let range = 0
  let index = 0

  while (index < body.length) {
    while (protectedRanges[range] && index >= protectedRanges[range].lastIndex) range++
    const protectedToken = protectedRanges[range]
    if (protectedToken && index >= protectedToken.index) {
      index = protectedToken.lastIndex
      continue
    }
    if (body[index] !== '$' || escapedAt(body, index)) {
      index++
      continue
    }

    const display = body[index + 1] === '$'
    const width = display ? 2 : 1
    const contentStart = index + width
    if (contentStart >= body.length || (!display && /\s/.test(body[contentStart]))) {
      index += width
      continue
    }

    let close = contentStart
    while (close < body.length) {
      const candidateRange = protectedRanges.find(token => close >= token.index && close < token.lastIndex)
      if (candidateRange) {
        close = candidateRange.lastIndex
        continue
      }
      if (body[close] === '$' && !escapedAt(body, close)
        && (!display || body[close + 1] === '$'))
      {
        const after = close + width
        const validInlineClose = display || (!/\s/.test(body[close - 1]) && !/\d/.test(body[after] || ''))
        if (validInlineClose) break
      }
      if (!display && (body[close] === '\n' || body[close] === '\r')) break
      close++
    }
    if (close >= body.length || body[close] !== '$' || (display && body[close + 1] !== '$')) {
      index += width
      continue
    }

    const lastIndex = close + width
    tokens.push({ index, lastIndex, kind: 'math', raw: body.slice(index, lastIndex),
      label: body.slice(contentStart, close), display })
    index = lastIndex
  }
  return tokens
}

function linkTokens(body: string, flags?: PostContentFlags): LinkToken[] {
  const tokens: LinkToken[] = []
  if (!flags || flags.has_code || flags.has_latex) {
    for (const match of body.matchAll(/^```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```(?=\r?$)/gm)) {
      const language = match[1].trim().toLowerCase()
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length,
        kind: language === 'latex' || language === 'tex' ? 'latex-fence' : 'code-fence', raw: match[0],
        label: match[2] })
    }
    for (const match of body.matchAll(/`([^`\r\n]+)`/g)) {
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'code', raw: match[0],
        label: match[1] })
    }
  }
  if (!flags || flags.has_latex) tokens.push(...mathTokens(body, tokens))
  if (!flags || flags.has_links) {
    for (const match of body.matchAll(/\[([^\]\r\n]+)\]\(([^\s<>")]+)\)/gi)) {
      const url = markdownUrl(match[2])
      if (url) {
        tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'markdown', raw: match[0],
          label: match[1], url })
      }
    }
    for (const match of urlMatcher.match(body) || []) {
      const url = match.schema ? match.url : `https://${match.raw}`
      tokens.push({ index: match.index, lastIndex: match.lastIndex, kind: 'url', raw: match.raw, url })
    }
    for (const match of body.matchAll(/(?<![A-Za-z0-9_])@[A-Za-z0-9_]+/g)) {
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'reference', raw: match[0] })
    }
    let hashtagCount = 0
    for (const match of body.matchAll(/(?<![\p{L}\p{M}\p{N}_])#[\p{L}\p{M}\p{N}_]+/gu)) {
      if (hashtagCount++ === MAX_HASHTAGS_PER_POST) break
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'reference', raw: match[0] })
    }
  }
  const priority = { 'code-fence': 0, 'latex-fence': 0, code: 1, math: 2, markdown: 3, url: 4, reference: 5 }
  return tokens.sort((a, b) => a.index - b.index || priority[a.kind] - priority[b.kind])
}

function renderedText(value: string, highlightTerms: string[]) {
  let html = ''
  let start = 0
  for (let index = 0; index < value.length - 1; index++) {
    if (value[index] !== '\\' || value[index + 1] !== '$' || !escapedAt(value, index + 1)) continue
    html += highlighted(value.slice(start, index), highlightTerms) + '$'
    start = index + 2
    index++
  }
  return html + highlighted(value.slice(start), highlightTerms)
}

function renderedMath(source: string, display: boolean) {
  const output = texToMathML(source, display)
  return output && display ? `<span class="math-display">${output}</span>` : output
}

export function linkify(body: string, mentionBios: Record<string, string> = {}, highlightTerms: string[] = [],
  appUrl: string | undefined = Bun.env.APP_URL, flags?: PostContentFlags)
{
  if (flags && !flags.has_latex && !flags.has_links && !flags.has_code) return highlighted(body, highlightTerms)
  let html = ''
  let end = 0
  for (const match of linkTokens(body, flags)) {
    if (match.index < end) continue
    html += renderedText(body.slice(end, match.index), highlightTerms)
    const token = match.raw
    if (match.kind === 'code' || match.kind === 'code-fence') {
      html += `<code${match.kind === 'code-fence' ? ' class="code-fence"' : ''}>${esc(match.label)}</code>`
    }
    else if (match.kind === 'latex-fence') {
      html += renderedMath(match.label!, true) || `<code class="code-fence">${esc(match.label)}</code>`
    }
    else if (match.kind === 'math') {
      html += renderedMath(match.label!, match.display!) || renderedText(match.raw, highlightTerms)
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
        : `<a href="/tag/${encodeURIComponent(value.normalize('NFC').toLowerCase())}">${
          highlighted(`#${value}`, highlightTerms)
        }</a>`
    }
    end = match.lastIndex
  }
  return html + renderedText(body.slice(end), highlightTerms)
}
