import { LinkifyIt } from 'linkify-it'
import tlds from 'tlds'

export function normalizeHashtag(tag: string) {
  return tag.normalize('NFC').toLowerCase().replaceAll('_', '')
}

export function isValidHashtag(tag: string) {
  return /^[\p{L}\p{M}\p{N}]{1,280}$/u.test(tag)
}

export const MAX_HASHTAGS_PER_POST = 15

export type ExtractedHashtag = { tag: string; authored: string }

export function pascalCaseHashtagDisplayName(authored: string) {
  if (!/^[A-Z][a-z\d]+(?:[A-Z][a-z\d]+)+$/.test(authored)) return null
  return authored
}

export function singularHashtag(tag: string) {
  if (tag.length > 2 && tag.endsWith('ses')) return tag.slice(0, -2)
  return tag.length > 1 && tag.endsWith('s') && !tag.endsWith('ss') ? tag.slice(0, -1) : tag
}

export function pluralHashtag(tag: string) {
  return tag.endsWith('s') ? `${tag}es` : `${tag}s`
}

export const SPOILER_HASHTAGS = new Set([
  'spoiler',
  'tldr',
  'sensitive',
  'contentwarning',
  'cw',
  'triggerwarning',
])

const urlMatcher = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false }).tlds(tlds)
const hashtagCache = new Map<string, string[]>()
const MAX_HASHTAG_CACHE_ENTRIES = 4_096

export function withoutMarkdownCode(body: string) {
  const characters = body.split('')
  const lines = [...body.matchAll(/.*(?:\n|$)/g)]
  let fence: { marker: string; length: number } | undefined

  for (const line of lines) {
    if (!line[0]) continue
    const content = line[0].replace(/\n$/, '')
    const opening = content.match(/^ {0,3}(`{3,}|~{3,})/)
    const closing = fence && content.match(new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`))
    if (fence || opening) {
      const start = line.index!
      for (let index = start; index < start + line[0].length; index++) {
        if (characters[index] !== '\n') characters[index] = ' '
      }
      if (closing) fence = undefined
      else if (!fence && opening) fence = { marker: opening[1][0], length: opening[1].length }
    }
  }

  const outsideFences = characters.join('')
  const openers = /`+/g
  let opener: RegExpExecArray | null
  while ((opener = openers.exec(outsideFences))) {
    const length = opener[0].length
    const remainder = outsideFences.slice(opener.index + length)
    const delimiter = String.fromCharCode(96).repeat(length)
    const closer = remainder.match(new RegExp(`(^|[^\\x60])(${delimiter})(?!\\x60)`))
    if (!closer) continue
    const end = opener.index + length + closer.index! + closer[1].length + length
    for (let index = opener.index; index < end; index++) {
      if (characters[index] !== '\n') characters[index] = ' '
    }
    openers.lastIndex = end
  }
  return characters.join('')
}

export function extractAuthoredHashtags(body: string) {
  const tags = new Map<string, string>()
  let count = 0
  const searchableBody = withoutMarkdownCode(body)
  const urls = urlMatcher.match(searchableBody) || []
  for (const match of searchableBody.matchAll(/(?<![\p{L}\p{M}\p{N}_])#([\p{L}\p{M}\p{N}_]+)/gu)) {
    let slashes = 0
    while (match.index > slashes && searchableBody[match.index - slashes - 1] === '\\') slashes++
    if (slashes % 2 === 1) continue
    if (urls.some(url => match.index >= url.index && match.index < url.lastIndex)) continue
    if (count++ === MAX_HASHTAGS_PER_POST) break
    const tag = normalizeHashtag(match[1])
    if (!tags.has(tag)) tags.set(tag, match[1].normalize('NFC'))
  }
  return [...tags].map(([tag, authored]) => ({ tag, authored }))
}

export function extractHashtags(body: string) {
  const cached = hashtagCache.get(body)
  if (cached) return cached
  const result = extractAuthoredHashtags(body).map(({ tag }) => tag)
  hashtagCache.set(body, result)
  if (hashtagCache.size > MAX_HASHTAG_CACHE_ENTRIES) hashtagCache.delete(hashtagCache.keys().next().value!)
  return result
}

export function containsAsciiArt(body: string) {
  return extractHashtags(body).some(tag => tag === 'ascii' || tag === 'asciiart')
}

export function containsSpoilerTag(body: string) {
  return extractHashtags(body).some(tag => SPOILER_HASHTAGS.has(tag))
}

export function splitSpoilerBody(body: string) {
  const lines = body.split('\n')
  const searchableLines = withoutMarkdownCode(body).split('\n')
  const spoilerLine = searchableLines.findIndex(containsSpoilerTag)
  return spoilerLine < 0
    ? { visible: body, hidden: '' }
    : {
      visible: lines.slice(0, spoilerLine + 1).join('\n'),
      hidden: lines.slice(spoilerLine + 1).join('\n'),
    }
}

export function extractMentions(body: string) {
  return [...new Set([...body.matchAll(/(?<![A-Za-z0-9_])@([A-Za-z0-9_]{2,24})(?![A-Za-z0-9_])/g)]
    .map(match => match[1].toLowerCase()))]
}

export type PostContentFlags = {
  has_latex: number
  has_links: number
  has_code: number
}

// These checks run once when a post is written. They are deliberately conservative:
// a false positive only invokes a parser, while a false negative would change rendering.
export function postContentFlags(body: string): PostContentFlags {
  return {
    has_latex: body.includes('$') || /```\s*(?:latex|tex)(?:\s|$)/im.test(body) ? 1 : 0,
    has_links:
      /(?:https?:\/\/|www\.|[A-Za-z0-9-]+\.[A-Za-z]{2,}|\[[^\]\r\n]+\]\(|(?<![A-Za-z0-9_])@[A-Za-z0-9_]+|(?<![\p{L}\p{M}\p{N}_])#[\p{L}\p{M}\p{N}_]+|(?<![\p{L}\p{M}\p{N}_&])&[0-9]+)/u
          .test(body)
        ? 1
        : 0,
    has_code: body.includes('`') ? 1 : 0,
  }
}
