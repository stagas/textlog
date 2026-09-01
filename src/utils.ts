import type { Database } from 'bun:sqlite'
import { LinkifyIt } from 'linkify-it'
import { createHash, randomBytes } from 'node:crypto'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import tlds from 'tlds'
import { userForApiKey } from './api-keys'
import { sessionCookieName } from './brand'
import { containsAsciiArt, MAX_HASHTAGS_PER_POST, normalizeHashtag, type PostContentFlags,
  splitSpoilerBody } from './content'
import { texToMathML } from './math'
import { requestContext } from './request-context'
import { locationDestination } from './locations'
import { markSessionUsed, sessionHash } from './sessions'
import { activeTimezone, timezoneLabel } from './timezone'
import { activeRequest } from './theme'
import type { User } from './types'
import type { LinkPreview, LocationView, UserProfileStats } from './types'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)

const highlightedCodeLanguages: Record<string, 'javascript' | 'python'> = {
  js: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
}

export function userHoverTitle(noteCount: number, bio?: string) {
  const noteLabel = `${noteCount.toLocaleString()} ${noteCount === 1 ? 'note' : 'notes'}`
  return bio?.trim() ? `${noteLabel}\n\n${displayBio(bio)}` : noteLabel
}

export const displayBio = (bio?: string | null) => bio?.trimEnd() || 'No bio yet.'
export const displayPostBody = (body: string) => body.trimEnd()

export type ReferencePopoverOptions = {
  signedIn: boolean
  currentHandle?: string
  formPrefix: string
  mentionFollowing?: Record<string, boolean>
  mentionFollowsViewer?: Record<string, boolean>
  mentionProfileStats?: Record<string, UserProfileStats>
  hashtagFollowing?: Record<string, boolean>
  hashtagFollowerCounts?: Record<string, number>
  linkPreviews?: Record<string, LinkPreview>
  location?: LocationView
  mentionPopovers?: boolean
  referencePopovers?: boolean
  linkUnknownMentions?: boolean
}

function previewLink(html: string, url: string, appUrl: string | undefined, popover?: ReferencePopoverOptions,
  suppressSite = false)
{
  const vocarooAudioUrl = (() => {
    try {
      const parsed = new URL(url)
      if (!['voca.ro', 'www.voca.ro', 'vocaroo.com', 'www.vocaroo.com'].includes(parsed.hostname.toLowerCase())) {
        return undefined
      }
      const id = parsed.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1]
      return id ? `/media/vocaroo/${encodeURIComponent(id)}` : undefined
    }
    catch {
      return undefined
    }
  })()
  if (popover && vocarooAudioUrl) {
    return `<span class="remote-link-menu"><input class="mobile-popover-toggle" type="checkbox" `
      + `aria-label="Toggle link preview">${html}<span class="remote-link-popover remote-link-audio-popover">`
      + `<audio controls preload="none" src="${esc(vocarooAudioUrl)}"></audio></span></span>`
  }
  const preview = popover?.linkPreviews?.[url]
  if (!preview) return html
  if (preview.renderedPostHtml) {
    const triggerHtml = (() => {
      if (!preview.linkedPostReturnPath) return html
      try {
        const destination = new URL(url)
        destination.searchParams.set('from', preview.linkedPostReturnPath)
        return html.replace(/href="[^"]*"/, `href="${esc(destination.href)}"`)
      }
      catch {
        return html
      }
    })()
    const mobileLabel = triggerHtml.match(/^<a\b[^>]*>([\s\S]*)<\/a>$/)?.[1]
    return `<span class="remote-link-menu internal-post-link-menu">`
      + (mobileLabel === undefined
        ? `<input class="mobile-popover-toggle" type="checkbox" aria-label="Toggle link preview">`
        : `<label class="mobile-post-popover-trigger"><input class="mobile-popover-toggle" type="checkbox" `
          + `aria-label="Toggle link preview"><span>${mobileLabel}</span></label>`)
      + triggerHtml
      + `<span class="remote-link-popover internal-post-popover">${preview.renderedPostHtml}</span></span>`
  }
  if (preview.linkedPost) return html
  if (preview.mimeType?.toLowerCase().startsWith('audio/')) {
    return `<span class="remote-link-menu"><input class="mobile-popover-toggle" type="checkbox" `
      + `aria-label="Toggle link preview">${html}<span class="remote-link-popover remote-link-audio-popover">`
      + `<audio controls preload="none" src="${esc(url)}"></audio></span></span>`
  }
  const cssUrl = preview.imageUrl.replace(/["'\\\n\r\f]/g, character => `\\${character}`)
  const aspect = preview.imageWidth && preview.imageHeight
    ? `;--preview-ratio:${preview.imageWidth / preview.imageHeight};--preview-width:${
      Math.min(200, preview.imageHeight) * preview.imageWidth / preview.imageHeight
    }px`
    : ''
  const imageClass = `remote-link-image${aspect ? ' remote-link-image-sized' : ''}`
  const hostname = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    }
    catch {
      return ''
    }
  })()
  const site = suppressSite ? '' : preview.siteName || hostname
  const details = site || preview.title || preview.description
    ? `<span class="remote-link-copy">${site ? `<span class="remote-link-site">${esc(site)}</span>` : ''}${
      preview.title ? `<strong class="remote-link-title">${esc(preview.title)}</strong>` : ''
    }${preview.description ? `<span class="remote-link-description">${esc(preview.description)}</span>` : ''}</span>`
    : ''
  return `<span class="remote-link-menu"><input class="mobile-popover-toggle" type="checkbox" `
    + `aria-label="Toggle link preview">${html}<a class="remote-link-popover" href="${esc(url)}" `
    + `${linkAttributes(url, appUrl).trimStart()} `
    + `style="--preview-image:url(&quot;${esc(cssUrl)}&quot;)${aspect}"><span class="${imageClass}" role="img" `
    + `aria-label="${esc(preview.title || `Preview of ${hostname}`)}"></span>${details}</a></span>`
}

export function locationPreviewLink(html: string, location: LocationView, appUrl?: string) {
  return previewLink(html, location.url, appUrl, { signedIn: false, formPrefix: 'location',
    linkPreviews: { [location.url]: location.preview } }, true)
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
  const moodColumn = database.query("SELECT 1 FROM pragma_table_info('users') WHERE name='mood'").get()
    ? 'u.mood'
    : "'' mood"
  const user = database.query(`SELECT u.id,u.handle,u.email,u.bio,${moodColumn},u.suspended_at,u.email_verified_at,
      u.handle_chosen_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(tokenHash, Date.now()) as User | null
  if (user) {
    try {
      const preferences = database.query(`SELECT show_link_previews,show_moderated_content,hide_people_follow_activity,
          hide_hashtag_follow_activity,show_note_streak,show_timestamps,timezone FROM users WHERE id=?`).get(user.id) as Pick<User,
        'show_link_previews' | 'show_moderated_content' | 'hide_people_follow_activity'
        | 'hide_hashtag_follow_activity' | 'show_note_streak' | 'show_timestamps' | 'timezone'> | null
      if (preferences) Object.assign(user, preferences)
    }
    catch {}
  }
  if (user) markSessionUsed(database, token!, Date.now())
  return user
}
export function currentUser(req: Request, database?: Database): User | null {
  const resolved = requestContext()
  if (resolved) return resolved.sessionUser
  return database ? userForSession(sessionToken(req), database) : null
}
// The API never reads the cookie. A bearer token cannot be attached by another site,
// so write endpoints are not reachable by cross-site requests.
export function apiUser(req: Request, database?: Database): User | null {
  const resolved = requestContext()
  if (resolved) return resolved.apiUser
  if (!database) return null
  const value = bearerToken(req)
  return userForApiKey(database, value) || userForSession(value, database)
}
const timestamp = (d: string) => new Date(d.replace(' ', 'T') + 'Z')
export const fmtFull = (d: string) => {
  const timeZone = activeTimezone()
  const date = timestamp(d)
  return `${date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone })} (${
    timezoneLabel(timeZone, date)
  })`
}
const emojiPattern =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*)/gu

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
  const withoutProtocol = url.replace(/^https?:\/\//i, '')
  if (/^https?:\/\/[^/]+\/$/i.test(url)) return withoutProtocol.slice(0, -1)
  if (withoutProtocol.length <= LONG_URL_LABEL_LENGTH) return withoutProtocol
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
  const normalizedAppUrl = appUrl?.replace(/\/$/, '')
  if (!normalizedAppUrl || !url.startsWith(normalizedAppUrl)) return shortenedUrlLabel(url)
  const relative = url.slice(normalizedAppUrl.length)
  if (!relative || relative === '/') return new URL(normalizedAppUrl).host
  return relative.startsWith('/') ? relative : `/${relative}`
}

function renderedRawLinkLabel(label: string, render: (value: string) => string) {
  const pathStart = label.indexOf('/')
  if (pathStart < 0) return render(label)
  return render(label.slice(0, pathStart))
    + `<span class="raw-link-rest">${render(label.slice(pathStart))}</span>`
}

const urlMatcher = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false })
  .tlds(tlds)

export function markdownUrl(destination: string) {
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
  kind: 'bold' | 'code' | 'code-fence' | 'italics' | 'latex-fence' | 'math' | 'markdown' | 'redacted' | 'strikethrough'
    | 'underline' | 'url' | 'reference' | 'post-reference' | 'location'
  raw: string
  url?: string
  label?: string
  language?: string
  display?: boolean
}

const linkTokenCache = new Map<string, LinkToken[]>()
const MAX_LINK_TOKEN_CACHE_ENTRIES = 8_192

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

export function linkTokens(body: string, flags?: PostContentFlags): LinkToken[] {
  const cacheKey = `${flags?.has_latex ?? 2}${flags?.has_links ?? 2}${flags?.has_code ?? 2}\0${body}`
  const cached = linkTokenCache.get(cacheKey)
  if (cached) return cached
  const tokens: LinkToken[] = []
  if (!flags || flags.has_code || flags.has_latex) {
    for (const match of body.matchAll(/^```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```(?=\r?$)/gm)) {
      const language = match[1].trim().toLowerCase()
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length,
        kind: language === 'latex' || language === 'tex' ? 'latex-fence' : 'code-fence', raw: match[0],
        label: match[2], language })
    }
    for (const match of body.matchAll(/`([^`\r\n]+)`/g)) {
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'code', raw: match[0],
        label: match[1] })
    }
  }
  if (!flags || flags.has_latex) tokens.push(...mathTokens(body, tokens))
  for (const expression of [
    /(?<!~)(~~)(?!~)([^~\r\n]*?\S[^~\r\n]*?)\1(?!~)/g,
    /(?<!~)(~)(?![~0-9])([^~\r\n]*?\S[^~\r\n]*?)\1(?!~)/g,
  ]) {
    for (const match of body.matchAll(expression)) {
      if (!escapedAt(body, match.index)) {
        tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'strikethrough', raw: match[0],
          label: match[2] })
      }
    }
  }
  for (const [marker, kind] of [['*', 'bold'], ['_', 'underline']] as const) {
    const escapedMarker = marker === '*' ? '\\*' : '_'
    const expression = new RegExp(`(?<!${escapedMarker})(${escapedMarker}{1,2})(?!${escapedMarker})`
      + `([^${escapedMarker}\\r\\n]*?\\S[^${escapedMarker}\\r\\n]*?)\\1(?!${escapedMarker})`, 'g')
    for (const match of body.matchAll(expression)) {
      if (!escapedAt(body, match.index)) {
        tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind, raw: match[0],
          label: match[2] })
      }
    }
  }
  for (const match of body.matchAll(/(?<!\S)\/([^\/\s](?:[^\/\r\n]*?[^\/\s])?)\/(?!\/)/g)) {
    if (!escapedAt(body, match.index)) {
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'italics', raw: match[0],
        label: match[1] })
    }
  }
  for (const match of body.matchAll(/(?<!\|)\|(?!\|)([^|\r\n]*?\S[^|\r\n]*?)\|(?!\|)/g)) {
    if (!escapedAt(body, match.index)) {
      tokens.push({ index: match.index, lastIndex: match.index + match[0].length, kind: 'redacted', raw: match[0],
        label: match[1] })
    }
  }
  if (!flags || flags.has_links) {
    for (const match of body.matchAll(/!?\[((?:\\[\[\]]|[^\]\r\n])+)\]\(([^\s<>")]+)\)/gi)) {
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
    const overlapsUrl = (index: number, lastIndex: number) =>
      tokens.some(token =>
        token.kind === 'url'
        && index < token.lastIndex && lastIndex > token.index
      )
    for (const match of body.matchAll(/(?<![A-Za-z0-9_])@[A-Za-z0-9_]+/g)) {
      const lastIndex = match.index + match[0].length
      if (!overlapsUrl(match.index, lastIndex)) {
        tokens.push({ index: match.index, lastIndex, kind: 'reference', raw: match[0] })
      }
    }
    let hashtagCount = 0
    for (const match of body.matchAll(/(?<![\p{L}\p{M}\p{N}_])#[\p{L}\p{M}\p{N}_]+/gu)) {
      if (escapedAt(body, match.index)) continue
      if (hashtagCount++ === MAX_HASHTAGS_PER_POST) break
      const lastIndex = match.index + match[0].length
      if (!overlapsUrl(match.index, lastIndex)) {
        tokens.push({ index: match.index, lastIndex, kind: 'reference', raw: match[0] })
      }
    }
  }
  for (const match of body.matchAll(/(?<![\p{L}\p{M}\p{N}_&])&[0-9]+/gu)) {
    const lastIndex = match.index + match[0].length
    if (!escapedAt(body, match.index)
      && !tokens.some(token => token.kind === 'url' && match.index < token.lastIndex && lastIndex > token.index)) {
      tokens.push({ index: match.index, lastIndex, kind: 'post-reference', raw: match[0] })
    }
  }
  const priority = { location: -1, 'code-fence': 0, 'latex-fence': 0, code: 1, math: 2, markdown: 3, redacted: 4, strikethrough: 4,
    bold: 4, italics: 4, underline: 4, url: 5, reference: 6, 'post-reference': 6 }
  const result = tokens.sort((a, b) => a.index - b.index || priority[a.kind] - priority[b.kind])
  linkTokenCache.set(cacheKey, result)
  if (linkTokenCache.size > MAX_LINK_TOKEN_CACHE_ENTRIES) linkTokenCache.delete(linkTokenCache.keys().next().value!)
  return result
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

export function postReferenceIds(body: string) {
  return linkTokens(body)
    .filter(token => token.kind === 'post-reference')
    .map(token => Number(token.raw.slice(1)))
}

function renderedText(value: string, highlightTerms: string[]) {
  let html = ''
  let start = 0
  for (let index = 0; index < value.length - 1; index++) {
    if (value[index] !== '\\' || !['$', '#'].includes(value[index + 1]) || !escapedAt(value, index + 1)) continue
    if (value[index + 1] === '#' && !/[\p{L}\p{M}\p{N}_]/u.test(value[index + 2] || '')) continue
    html += highlighted(value.slice(start, index), highlightTerms) + value[index + 1]
    start = index + 2
    index++
  }
  return html + highlighted(value.slice(start), highlightTerms)
}

function renderedMath(source: string, display: boolean) {
  const output = texToMathML(source, display)
  return output && display ? `<span class="math-display">${output}</span>` : output
}

type MarkdownTable = {
  index: number
  lastIndex: number
  headers: string[]
  alignments: Array<'left' | 'center' | 'right' | undefined>
  rows: string[][]
}

function markdownTableCells(line: string) {
  if (!line.includes('|')) return null
  const cells: string[] = []
  let cell = ''
  let codeTicks = 0
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (character === '\\' && line[index + 1] === '|') {
      cell += '|'
      index++
    }
    else if (character === '`') {
      let ticks = 1
      while (line[index + ticks] === '`') ticks++
      if (!codeTicks) codeTicks = ticks
      else if (codeTicks === ticks) codeTicks = 0
      cell += '`'.repeat(ticks)
      index += ticks - 1
    }
    else if (character === '|' && !codeTicks) {
      cells.push(cell.trim())
      cell = ''
    }
    else cell += character
  }
  cells.push(cell.trim())
  if (!cells[0]) cells.shift()
  if (!cells.at(-1)) cells.pop()
  return cells.length > 1 ? cells : null
}

function markdownTable(body: string): MarkdownTable | null {
  const lines = body.split('\n')
  const fencedRanges = linkTokens(body).filter(token => token.kind === 'code-fence' || token.kind === 'latex-fence')
  let offset = 0
  for (let index = 0; index < lines.length - 1; index++) {
    const headerOffset = offset
    const nextOffset = offset + lines[index].length + 1
    offset = nextOffset
    if (fencedRanges.some(range => headerOffset >= range.index && headerOffset < range.lastIndex)) continue
    const headers = markdownTableCells(lines[index])
    const delimiters = markdownTableCells(lines[index + 1])
    if (!headers || !delimiters || headers.length !== delimiters.length
      || !delimiters.every(cell => /^:?-{3,}:?$/.test(cell))) continue
    const rows: string[][] = []
    let endLine = index + 2
    for (; endLine < lines.length; endLine++) {
      const cells = markdownTableCells(lines[endLine])
      if (!cells) break
      rows.push(headers.map((_, cellIndex) => cells[cellIndex] || ''))
    }
    const lastIndex = lines.slice(0, endLine).reduce((length, line) => length + line.length + 1, 0) - 1
    return {
      index: headerOffset,
      lastIndex,
      headers,
      alignments: delimiters.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center'
        : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined),
      rows,
    }
  }
  return null
}

function markdownHorizontalRule(body: string) {
  const fencedRanges = linkTokens(body).filter(token => token.kind === 'code-fence' || token.kind === 'latex-fence')
  let offset = 0
  for (const line of body.split('\n')) {
    const match = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)
    if (match && !fencedRanges.some(range => offset >= range.index && offset < range.lastIndex)) {
      return { index: offset, lastIndex: offset + line.length }
    }
    offset += line.length + 1
  }
  return null
}

type MarkdownList = {
  index: number
  lastIndex: number
  ordered: boolean
  start: number
  items: string[]
}

function markdownList(body: string): MarkdownList | null {
  const lines = body.split('\n')
  const fencedRanges = linkTokens(body).filter(token => token.kind === 'code-fence' || token.kind === 'latex-fence')
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const lineOffset = offset
    offset += lines[index].length + 1
    if (fencedRanges.some(range => lineOffset >= range.index && lineOffset < range.lastIndex)) continue
    const first = /^( {0,3})(?:(\d+)\.|([-+*]))[ \t]+(.+)$/.exec(lines[index])
    if (!first) continue
    const ordered = first[2] !== undefined
    const items = [first[4]]
    let endLine = index + 1
    for (; endLine < lines.length; endLine++) {
      const item = /^( {0,3})(?:(\d+)\.|([-+*]))[ \t]+(.+)$/.exec(lines[endLine])
      if (!item || (item[2] !== undefined) !== ordered) break
      items.push(item[4])
    }
    if (items.length < 2) continue
    const lastIndex = lines.slice(0, endLine).reduce((length, line) => length + line.length + 1, 0) - 1
    return { index: lineOffset, lastIndex, ordered, start: Number(first[2] || 1), items }
  }
  return null
}

function renderedReference(token: string, mentionBios: Record<string, string>,
  mentionNoteCounts: Record<string, number>, hashtagCounts: Record<string, number>, highlightTerms: string[],
  navigationQuery = '', popover?: ReferencePopoverOptions)
{
  const value = token.slice(1)
  const normalizedValue = normalizeHashtag(value)
  const isUser = token[0] === '@'
  const key = isUser ? value.toLowerCase() : normalizedValue
  const href = isUser
    ? `/u/${key}${navigationQuery}`
    : `/tag/${encodeURIComponent(key)}${navigationQuery}`
  const label = highlighted(`${token[0]}${value}`, highlightTerms)
  const hasData = isUser ? mentionBios[key] !== undefined : hashtagCounts[key] !== undefined
  if (isUser && !hasData) return popover?.linkUnknownMentions ? `<a href="${href}">${label}</a>` : label
  if (!hasData) return `<a href="${href}">${label}</a>`
  if (popover?.referencePopovers === false) return `<a href="${href}">${label}</a>`
  if (isUser && popover?.mentionPopovers === false) return `<a href="${href}">${label}</a>`
  const count = isUser ? mentionNoteCounts[key] || 0 : hashtagCounts[key]
  const referencePopover = popover && (!isUser || popover.mentionPopovers !== false) ? popover : undefined
  if (!referencePopover) {
    if (!isUser) return `<a href="${href}">${label}</a>`
    return `<a href="${href}" title="${esc(userHoverTitle(count, mentionBios[key]))}">${label}</a>`
  }
  const following = isUser ? !!referencePopover.mentionFollowing?.[key] : !!referencePopover.hashtagFollowing?.[key]
  const followsViewer = isUser && !!referencePopover.mentionFollowsViewer?.[key]
  const ownUser = isUser && key === referencePopover.currentHandle?.toLowerCase()
  const action = ownUser ? '' : referencePopover.signedIn
    ? `<span class="reference-popover-actions"><span class="follow-action">${
      followsViewer ? '<span class="follows-you">follows you</span>' : ''
    }<button class="button${following ? ' button-muted' : ''}" type="submit" form="${
      esc(referenceFormId(referencePopover.formPrefix, isUser ? 'user' : 'tag', key))
    }">${
      following ? 'unfollow' : followsViewer ? 'follow back' : 'follow'
    }</button></span></span>`
    : '<a class="button" href="/enter" rel="nofollow">enter to follow</a>'
  return `<span class="reference-menu"><input class="mobile-popover-toggle" type="checkbox" `
    + `aria-label="Toggle reference details"><a class="reference-menu-trigger" href="${href}">${label}</a>`
    + `<span class="reference-menu-popover${isUser ? '' : ' reference-menu-popover-tag'}">`
    + `<span class="mobile-reference-destination"><a class="button" href="${href}">${
      isUser ? 'profile' : 'notes'
    }</a></span>`
    + action
    + (isUser && (mentionBios[key]?.trim() || ownUser)
      ? `<span class="reference-popover-bio${ownUser ? ' reference-popover-bio-own' : ''}${
        mentionBios[key]?.trim() ? '' : ' bio-empty'
      }">${
        mentionBios[key]?.trim()
          ? linkify(displayBio(mentionBios[key]), {}, [], Bun.env.APP_URL, undefined, navigationQuery)
          : 'No bio yet'
      }</span>`
      : '')
    + '</span></span>'
}

function linkifyAsciiReferences(body: string, mentionBios: Record<string, string>, appUrl: string | undefined,
  navigationQuery = '', hashtagCounts: Record<string, number> = {}, mentionNoteCounts: Record<string, number> = {},
  popover?: ReferencePopoverOptions)
{
  let html = ''
  let end = 0
  const tokens = linkTokens(body, { has_latex: 1, has_links: 1, has_code: 1 })
  const markupRanges = tokens.filter(token => token.kind !== 'reference' && token.kind !== 'post-reference'
    && token.kind !== 'url')
  for (const match of tokens) {
    if ((match.kind !== 'reference' && match.kind !== 'post-reference' && match.kind !== 'url') || match.index < end
      || markupRanges.some(range => match.index >= range.index && match.index < range.lastIndex)) continue
    html += esc(body.slice(end, match.index))
    if (match.kind === 'reference') {
      html += renderedReference(match.raw, mentionBios, mentionNoteCounts, hashtagCounts, [], navigationQuery, popover)
    }
    else if (match.kind === 'post-reference') {
      const href = `/post/${Number(match.raw.slice(1))}`
      const previewUrl = appUrl ? `${appUrl.replace(/\/$/, '')}${href}` : href
      html += previewLink(`<a href="${href}">${esc(match.raw)}</a>`, previewUrl, appUrl, popover)
    }
    else {
      const url = match.url!
      const label = linkLabel(url, appUrl)
      const displayLabel = label === url ? match.raw : label
      html += previewLink(
        `<a href="${esc(url)}" class="raw-link"${displayLabel === match.raw ? '' : ` title="${esc(url)}"`}${
          linkAttributes(url, appUrl)
        }>${renderedRawLinkLabel(displayLabel, esc)}</a>`,
        url,
        appUrl,
        popover,
      )
    }
    end = match.lastIndex
  }
  return html + esc(body.slice(end))
}

export function linkify(body: string, mentionBios: Record<string, string> = {}, highlightTerms: string[] = [],
  appUrl: string | undefined = Bun.env.APP_URL, flags?: PostContentFlags, navigationQuery = '',
  hashtagCounts: Record<string, number> = {}, mentionNoteCounts: Record<string, number> = {},
  popover?: ReferencePopoverOptions, renderSpoiler = true, renderBlocks = true): string
{
  const spoiler = renderSpoiler ? splitSpoilerBody(body) : { visible: body, hidden: '' }
  if (spoiler.hidden) {
    const renderPart = (part: string): string =>
      linkify(part, mentionBios, highlightTerms, appUrl, flags, navigationQuery, hashtagCounts, mentionNoteCounts,
        popover, false)
    return renderPart(spoiler.visible)
      + `<span class="post-spoiler"><label class="post-spoiler-summary">`
      + `<input class="post-spoiler-input" type="checkbox"><span>reveal</span></label>`
      + `<span class="post-spoiler-content"><span class="post-spoiler-content-inner">${
        renderPart(spoiler.hidden)
      }</span></span></span>`
  }
  // Keep the drawing literal while retaining navigation for social references.
  if (containsAsciiArt(body)) {
    return linkifyAsciiReferences(body, mentionBios, appUrl, navigationQuery, hashtagCounts, mentionNoteCounts, popover)
  }
  const lines = body.split('\n')
  const fencedRanges = linkTokens(body).filter(token => token.kind === 'code-fence' || token.kind === 'latex-fence')
  let lineOffset = 0
  const quotedLines = lines.map(line => {
    const quoted = !fencedRanges.some(range => lineOffset >= range.index && lineOffset < range.lastIndex)
      && /^>\s?/.test(line)
    lineOffset += line.length + 1
    return quoted
  })
  if (quotedLines.some(Boolean)) {
    let html = ''
    for (let index = 0; index < lines.length;) {
      const quoted = quotedLines[index]
      const group: string[] = []
      while (index < lines.length && quotedLines[index] === quoted) {
        group.push(quoted ? lines[index].replace(/^>\s?/, '') : lines[index])
        index++
      }
      const rendered = linkify(group.join('\n'), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
        hashtagCounts, mentionNoteCounts, popover, false)
      const quoteTag = rendered.includes('<div class="markdown-table-wrap">')
        || rendered.includes('<div class="markdown-list-wrap">') || rendered.includes('<hr ') ? 'div' : 'span'
      html += quoted ? `<${quoteTag} class="post-quote">${rendered}</${quoteTag}>` : rendered
    }
    return html
  }
  const horizontalRule = renderBlocks ? markdownHorizontalRule(body) : null
  if (horizontalRule) {
    return linkify(body.slice(0, horizontalRule.index), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
      hashtagCounts, mentionNoteCounts, popover, false)
      + '<hr class="markdown-hr">'
      + linkify(body.slice(horizontalRule.lastIndex), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
        hashtagCounts, mentionNoteCounts, popover, false)
  }
  const list = renderBlocks ? markdownList(body) : null
  if (list) {
    const tag = list.ordered ? 'ol' : 'ul'
    const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : ''
    const renderedList = `<div class="markdown-list-wrap"><${tag} class="markdown-list"${start}>`
      + list.items.map(item => `<li>${linkify(item, mentionBios, highlightTerms, appUrl, flags, navigationQuery,
        hashtagCounts, mentionNoteCounts, popover, false, false)}</li>`).join('')
      + `</${tag}></div>`
    const beforeList = list.index > 0 && body[list.index - 1] === '\n' ? list.index - 1 : list.index
    const afterList = body[list.lastIndex] === '\n' ? list.lastIndex + 1 : list.lastIndex
    return linkify(body.slice(0, beforeList), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
      hashtagCounts, mentionNoteCounts, popover, false)
      + renderedList
      + linkify(body.slice(afterList), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
        hashtagCounts, mentionNoteCounts, popover, false)
  }
  const table = renderBlocks ? markdownTable(body) : null
  if (table) {
    const renderCell = (cell: string) => linkify(cell, mentionBios, highlightTerms, appUrl, flags, navigationQuery,
      hashtagCounts, mentionNoteCounts, popover, false, false)
    const renderedRow = (cells: string[], tag: 'th' | 'td') => '<tr>' + cells.map((cell, index) => {
      const alignment = table.alignments[index]
      return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${alignment ? ` class="align-${alignment}"` : ''}>${
        renderCell(cell)
      }</${tag}>`
    }).join('') + '</tr>'
    const renderedBodyRow = (row: string[]) => row.every(cell => /^-{3,}$/.test(cell))
      ? `<tr class="markdown-table-separator" aria-hidden="true"><td colspan="${table.headers.length}"></td></tr>`
      : renderedRow(row, 'td')
    const renderedTable = '<div class="markdown-table-wrap"><table class="markdown-table"><thead>'
      + renderedRow(table.headers, 'th') + '</thead><tbody>'
      + table.rows.map(renderedBodyRow).join('') + '</tbody></table></div>'
    const beforeTable = table.index > 0 && body[table.index - 1] === '\n' ? table.index - 1 : table.index
    const afterTable = body[table.lastIndex] === '\n' ? table.lastIndex + 1 : table.lastIndex
    return linkify(body.slice(0, beforeTable), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
      hashtagCounts, mentionNoteCounts, popover, false)
      + renderedTable
      + linkify(body.slice(afterTable), mentionBios, highlightTerms, appUrl, flags, navigationQuery,
        hashtagCounts, mentionNoteCounts, popover, false)
  }
  if (flags && !flags.has_latex && !flags.has_links && !flags.has_code && !/[&~*_/|]/.test(body)) {
    return highlighted(body, highlightTerms)
  }
  let html = ''
  let end = 0
  const locationToken = (() => {
    if (!popover?.location) return null
    const lines = body.split('\n')
    const marker = lines.findIndex(line => /(?:^|\s)#(?:map|location)\s*$/i.test(line))
    if (marker < 0) return null
    let offset = lines.slice(0, marker + 1).reduce((length, line) => length + line.length + 1, 0)
    for (const line of lines.slice(marker + 1)) {
      const trimmed = line.trim()
      if (trimmed) {
        if (trimmed !== popover.location.query) return null
        const index = offset + line.indexOf(trimmed)
        return { index, lastIndex: index + trimmed.length, kind: 'location' as const, raw: trimmed }
      }
      offset += line.length + 1
    }
    return null
  })()
  const tokens = [...linkTokens(body, flags), ...(locationToken ? [locationToken] : [])]
    .sort((a, b) => a.index - b.index || (a.kind === 'location' ? -1 : 1))
  for (const match of tokens) {
    if (match.index < end) continue
    html += renderedText(body.slice(end, match.index), highlightTerms)
    const token = match.raw
    if (match.kind === 'code' || match.kind === 'code-fence') {
      const language = match.language && highlightedCodeLanguages[match.language]
      const code = language ? hljs.highlight(match.label!, { language }).value : esc(match.label)
      html += `<code${match.kind === 'code-fence'
        ? ` class="code-fence${language ? ` hljs language-${language}` : ''}"`
        : ''}>${code}</code>`
    }
    else if (match.kind === 'latex-fence') {
      html += renderedMath(match.label!, true) || `<code class="code-fence">${esc(match.label)}</code>`
    }
    else if (match.kind === 'math') {
      html += renderedMath(match.label!, match.display!) || renderedText(match.raw, highlightTerms)
    }
    else if (match.kind === 'markdown') {
      html += previewLink(
        `<a href="${esc(match.url)}" title="${esc(match.url)}"${linkAttributes(match.url!, appUrl)}>${
          highlighted(match.label!, highlightTerms)
        }</a>`,
        match.url!,
        appUrl,
        popover,
      )
    }
    else if (match.kind === 'strikethrough') {
      html += `<del>${renderedText(match.label!, highlightTerms)}</del>`
    }
    else if (match.kind === 'bold') {
      html += `<strong>${renderedText(match.label!, highlightTerms)}</strong>`
    }
    else if (match.kind === 'underline') {
      html += `<u>${renderedText(match.label!, highlightTerms)}</u>`
    }
    else if (match.kind === 'italics') {
      html += `<em>${renderedText(match.label!, highlightTerms)}</em>`
    }
    else if (match.kind === 'redacted') {
      html += `<span class="redacted" tabindex="0">${renderedText(match.label!, highlightTerms)}</span>`
    }
    else if (match.kind === 'url') {
      const url = match.url!
      const label = linkLabel(url, appUrl)
      const displayLabel = label === url ? token : label
      html += previewLink(
        `<a href="${esc(url)}" class="raw-link"${displayLabel === token ? '' : ` title="${esc(url)}"`}${
          linkAttributes(url, appUrl)
        }>${renderedRawLinkLabel(displayLabel, value => highlighted(value, highlightTerms))}</a>`,
        url,
        appUrl,
        popover,
      )
    }
    else if (match.kind === 'post-reference') {
      const href = `/post/${Number(token.slice(1))}`
      const previewUrl = appUrl ? `${appUrl.replace(/\/$/, '')}${href}` : href
      html += previewLink(`<a href="${href}">${highlighted(token, highlightTerms)}</a>`, previewUrl, appUrl, popover)
    }
    else if (match.kind === 'location' && popover?.location) {
      const location = { ...popover.location, url: locationDestination(popover.location,
        activeRequest().headers.get('user-agent') || '') }
      html += locationPreviewLink(`<a href="${esc(location.url)}" target="_blank" `
        + `rel="nofollow ugc noopener noreferrer">${highlighted(token, highlightTerms)}</a>`,
      location, appUrl)
    }
    else {
      html += renderedReference(token, mentionBios, mentionNoteCounts, hashtagCounts, highlightTerms, navigationQuery,
        popover)
    }
    end = match.lastIndex
  }
  return html + renderedText(body.slice(end), highlightTerms)
}
