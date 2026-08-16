import type { Database } from 'bun:sqlite'
import { LinkifyIt } from 'linkify-it'
import { createHash, randomBytes } from 'node:crypto'
import tlds from 'tlds'
import { userForApiKey } from './api-keys'
import { sessionCookieName } from './brand'
import { containsAsciiArt, MAX_HASHTAGS_PER_POST, type PostContentFlags } from './content'
import { db, type User } from './db'
import { texToMathML } from './math'
import { markSessionUsed, sessionHash } from './sessions'
import type { LinkPreview, UserProfileStats } from './types'

export function userHoverTitle(noteCount: number, bio?: string) {
  return `${noteCount.toLocaleString()} ${noteCount === 1 ? 'note' : 'notes'}\n\n${displayBio(bio)}`
}

export const displayBio = (bio?: string | null) => bio?.trimEnd() || 'No bio yet.'
export const displayPostBody = (body: string) => body.trimEnd()

export type ReferencePopoverOptions = {
  signedIn: boolean
  currentHandle?: string
  formPrefix: string
  mentionFollowing?: Record<string, boolean>
  mentionProfileStats?: Record<string, UserProfileStats>
  hashtagFollowing?: Record<string, boolean>
  hashtagFollowerCounts?: Record<string, number>
  linkPreviews?: Record<string, LinkPreview>
}

function previewLink(html: string, url: string, popover?: ReferencePopoverOptions) {
  const preview = popover?.linkPreviews?.[url]
  if (!preview) return html
  const cssUrl = preview.imageUrl.replace(/["'\\\n\r\f]/g, character => `\\${character}`)
  const aspect = preview.imageWidth && preview.imageHeight
    ? `;--preview-ratio:${preview.imageWidth / preview.imageHeight};--preview-width:${
      200 * preview.imageWidth / preview.imageHeight
    }px`
    : ''
  const imageClass = `remote-link-image${aspect ? ' remote-link-image-sized' : ''}`
  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return '' }
  })()
  const site = preview.siteName || hostname
  const details = site || preview.title || preview.description
    ? `<span class="remote-link-copy">${site ? `<span class="remote-link-site">${esc(site)}</span>` : ''}${
      preview.title ? `<strong class="remote-link-title">${esc(preview.title)}</strong>` : ''}${
      preview.description ? `<span class="remote-link-description">${esc(preview.description)}</span>` : ''
    }</span>`
    : ''
  return `<span class="remote-link-menu">${html}<a class="remote-link-popover" href="${esc(url)}" `
    + `target="_blank" rel="noopener noreferrer nofollow" `
    + `style="--preview-image:url(&quot;${esc(cssUrl)}&quot;)${aspect}"><span class="${imageClass}" role="img" `
    + `aria-label="${esc(preview.title || `Preview of ${hostname}`)}"></span>${details}</a></span>`
}

function profileStatLinks(handle: string, stats: UserProfileStats, navigationQuery = '') {
  const base = `/u/${handle}`
  const href = (tab?: string) =>
    tab
      ? `${base}?tab=${tab}${navigationQuery ? `&${navigationQuery.slice(1)}` : ''}`
      : `${base}${navigationQuery}`
  const count = (value: number, singular: string, plural = singular + 's') =>
    `${value.toLocaleString()} ${value === 1 ? singular : plural}`
  return `<span class="reference-profile-tabs"><a href="${href()}">${count(stats.notes, 'note')}</a>`
    + `<a href="${href('replies')}">${count(stats.replies, 'reply', 'replies')}</a>`
    + `<a href="${href('following')}">${count(stats.followingTags, 'tag')}, ${
      count(stats.following, 'user')
    } following</a>`
    + `<a href="${href('followers')}">${count(stats.followers, 'follower')}</a></span>`
}

function tagStatLinks(tag: string, notes: number, followers: number, navigationQuery = '') {
  const base = `/tag/${encodeURIComponent(tag)}`
  const followersHref = `${base}?tab=followers${navigationQuery ? `&${navigationQuery.slice(1)}` : ''}`
  const count = (value: number, singular: string) =>
    `${value.toLocaleString()} ${value === 1 ? singular : singular + 's'}`
  return `<span class="reference-profile-tabs"><a href="${base}${navigationQuery}">${count(notes, 'note')}</a>`
    + `<a href="${followersHref}">${count(followers, 'follower')}</a></span>`
}

export function referenceFormId(prefix: string, kind: 'user' | 'tag', value: string,
  action: 'follow' | 'block' = 'follow')
{
  return `${prefix}-${kind}-${encodeURIComponent(value)}${action === 'block' ? '-block' : ''}`
}

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
export function fmt(d: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - timestamp(d).getTime()) / 1000))
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
const emojiPattern = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu

function emojiText(text: string) {
  let html = ''
  let end = 0
  for (const match of text.matchAll(emojiPattern)) {
    html += esc(text.slice(end, match.index)) + `<span class="emoji">${esc(match[0])}</span>`
    end = match.index + match[0].length
  }
  return html + esc(text.slice(end))
}

function highlighted(text: string, terms: string[]) {
  if (!terms.length) return emojiText(text)
  const pattern = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (!pattern) return emojiText(text)
  let html = ''
  let end = 0
  for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
    html += emojiText(text.slice(end, match.index)) + `<mark>${emojiText(match[0])}</mark>`
    end = match.index + match[0].length
  }
  return html + emojiText(text.slice(end))
}

function linkAttributes(url: string, appUrl: string | undefined) {
  const opensInNewTab = !appUrl || !url.startsWith(appUrl)
  return opensInNewTab
    ? ' target="_blank" rel="nofollow ugc noopener noreferrer"'
    : ' rel="nofollow ugc"'
}

const LONG_URL_LABEL_LENGTH = 48
const LONG_URL_PART_LENGTH = 40
const URL_PART_START_LENGTH = 20
const URL_PART_END_LENGTH = LONG_URL_PART_LENGTH - URL_PART_START_LENGTH - 1

function shortenedUrlPart(part: string) {
  const characters = [...part]
  if (characters.length <= LONG_URL_PART_LENGTH) return part
  const boundaries = characters.flatMap((character, index) => /[^\p{L}\p{M}\p{N}_]/u.test(character) ? [index] : [])
  const closestBoundary = (target: number) =>
    boundaries.reduce((closest, index) => Math.abs(index - target) < Math.abs(closest - target) ? index : closest,
      boundaries[0])
  const startBoundary = boundaries.length ? closestBoundary(URL_PART_START_LENGTH - 1) : -1
  const endTarget = characters.length - URL_PART_END_LENGTH - 1
  const endBoundary = boundaries.length ? closestBoundary(endTarget) : -1
  const start = startBoundary >= 0 && startBoundary < endBoundary
    ? characters.slice(0, startBoundary + 1)
    : characters.slice(0, URL_PART_START_LENGTH)
  const end = endBoundary > startBoundary
    ? characters.slice(endBoundary + 1)
    : characters.slice(-URL_PART_END_LENGTH)
  return `${start.join('')}…${end.join('')}`
}

function shortenedUrlLabel(url: string) {
  if (url.length <= LONG_URL_LABEL_LENGTH) return url
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (!parts.length) return parsed.hostname
    const trailingSlash = parsed.pathname.endsWith('/') ? '/' : ''
    return `${parsed.hostname}/…/${shortenedUrlPart(parts.at(-1)!)}${trailingSlash}`
  }
  catch {
    return url
  }
}

function linkLabel(url: string, appUrl: string | undefined) {
  if (!appUrl || !url.startsWith(appUrl)) return shortenedUrlLabel(url)
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
    for (const match of body.matchAll(/\[((?:\\[\[\]]|[^\]\r\n])+)\]\(([^\s<>")]+)\)/gi)) {
      const url = markdownUrl(match[2])
      if (url) {
        tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'markdown', raw: match[0],
          label: match[1].replace(/\\([\[\]])/g, '$1'), url })
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

export function postLinks(body: string) {
  const links: string[] = []
  let end = 0
  for (const token of linkTokens(body)) {
    if (token.index < end) continue
    if ((token.kind === 'url' || token.kind === 'markdown') && token.url && !links.includes(token.url)) {
      links.push(token.url)
    }
    end = token.lastIndex
  }
  return links
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

function renderedReference(token: string, mentionBios: Record<string, string>,
  mentionNoteCounts: Record<string, number>, hashtagCounts: Record<string, number>, highlightTerms: string[],
  navigationQuery = '', popover?: ReferencePopoverOptions)
{
  const value = token.slice(1)
  const normalizedValue = value.normalize('NFC').toLowerCase()
  const isUser = token[0] === '@'
  const key = isUser ? value.toLowerCase() : normalizedValue
  const href = isUser
    ? `/u/${key}${navigationQuery}`
    : `/tag/${encodeURIComponent(key)}${navigationQuery}`
  const label = highlighted(`${token[0]}${value}`, highlightTerms)
  const hasData = isUser ? mentionBios[key] !== undefined : hashtagCounts[key] !== undefined
  if (!hasData) return `<a href="${href}">${label}</a>`
  const count = isUser ? mentionNoteCounts[key] || 0 : hashtagCounts[key]
  if (!popover) {
    const title = isUser
      ? userHoverTitle(count, mentionBios[key])
      : `${count.toLocaleString()} ${count === 1 ? 'note' : 'notes'}`
    return `<a href="${href}" title="${esc(title)}">${label}</a>`
  }
  const following = isUser ? !!popover.mentionFollowing?.[key] : !!popover.hashtagFollowing?.[key]
  const ownUser = isUser && key === popover.currentHandle?.toLowerCase()
  const action = ownUser ? '' : popover.signedIn
    ? `<span class="reference-popover-actions"><button class="button${
      following ? ' button-muted' : ''
    }" type="submit" form="${esc(referenceFormId(popover.formPrefix, isUser ? 'user' : 'tag', key))}">${
      following ? 'unfollow' : 'follow'
    }</button><button class="quiet danger" type="submit" form="${
      esc(referenceFormId(popover.formPrefix, isUser ? 'user' : 'tag', key, 'block'))
    }">block</button></span>`
    : '<a class="button" href="/enter" rel="nofollow">enter to follow</a>'
  return `<span class="reference-menu"><a class="reference-menu-trigger" href="${href}">${label}</a>`
    + `<span class="reference-menu-popover${isUser ? '' : ' reference-menu-popover-tag'}">${
      isUser && popover.mentionProfileStats?.[key]
        ? profileStatLinks(key, popover.mentionProfileStats[key], navigationQuery)
        : isUser
        ? `<span>${count.toLocaleString()} ${count === 1 ? 'note' : 'notes'}</span>`
        : tagStatLinks(key, count, popover.hashtagFollowerCounts?.[key] || 0, navigationQuery)
    }`
    + (isUser
      ? `<span class="reference-popover-bio">${
        linkify(displayBio(mentionBios[key]), {}, [], Bun.env.APP_URL, undefined, navigationQuery)
      }</span>`
      : '')
    + `${action}</span></span>`
}

function linkifyAsciiReferences(body: string, mentionBios: Record<string, string>, appUrl: string | undefined,
  navigationQuery = '', hashtagCounts: Record<string, number> = {}, mentionNoteCounts: Record<string, number> = {},
  popover?: ReferencePopoverOptions)
{
  let html = ''
  let end = 0
  const tokens = linkTokens(body, { has_latex: 1, has_links: 1, has_code: 1 })
  const markupRanges = tokens.filter(token => token.kind !== 'reference' && token.kind !== 'url')
  for (const match of tokens) {
    if ((match.kind !== 'reference' && match.kind !== 'url') || match.index < end
      || markupRanges.some(range => match.index >= range.index && match.index < range.lastIndex)) continue
    html += esc(body.slice(end, match.index))
    if (match.kind === 'reference') {
      html += renderedReference(match.raw, mentionBios, mentionNoteCounts, hashtagCounts, [], navigationQuery, popover)
    }
    else {
      const url = match.url!
      const label = linkLabel(url, appUrl)
      const displayLabel = label === url ? match.raw : label
      html += previewLink(`<a href="${esc(url)}"${displayLabel === match.raw ? '' : ` title="${esc(url)}"`}${
        linkAttributes(url, appUrl)
      }>${esc(displayLabel)}</a>`, url, popover)
    }
    end = match.lastIndex
  }
  return html + esc(body.slice(end))
}

export function linkify(body: string, mentionBios: Record<string, string> = {}, highlightTerms: string[] = [],
  appUrl: string | undefined = Bun.env.APP_URL, flags?: PostContentFlags, navigationQuery = '',
  hashtagCounts: Record<string, number> = {}, mentionNoteCounts: Record<string, number> = {},
  popover?: ReferencePopoverOptions)
{
  // Keep the drawing literal while retaining navigation for social references.
  if (containsAsciiArt(body)) {
    return linkifyAsciiReferences(body, mentionBios, appUrl, navigationQuery, hashtagCounts, mentionNoteCounts, popover)
  }
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
      html += previewLink(`<a href="${esc(match.url)}" title="${esc(match.url)}"${linkAttributes(match.url!, appUrl)}>${
        highlighted(match.label!, highlightTerms)
      }</a>`, match.url!, popover)
    }
    else if (match.kind === 'url') {
      const url = match.url!
      const label = linkLabel(url, appUrl)
      const displayLabel = label === url ? token : label
      html += previewLink(`<a href="${esc(url)}"${label === url ? '' : ` title="${esc(url)}"`}${linkAttributes(url, appUrl)}>${
        highlighted(displayLabel, highlightTerms)
      }</a>`, url, popover)
    }
    else {
      html += renderedReference(token, mentionBios, mentionNoteCounts, hashtagCounts, highlightTerms, navigationQuery,
        popover)
    }
    end = match.lastIndex
  }
  return html + renderedText(body.slice(end), highlightTerms)
}
