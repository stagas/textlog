export function normalizeHashtag(tag: string) {
  return tag.normalize('NFC').toLowerCase()
}

export function isValidHashtag(tag: string) {
  return /^[\p{L}\p{M}\p{N}_]{1,280}$/u.test(tag)
}

export const MAX_HASHTAGS_PER_POST = 5

export function extractHashtags(body: string) {
  const tags = new Set<string>()
  let count = 0
  for (const match of body.matchAll(/#([\p{L}\p{M}\p{N}_]+)/gu)) {
    if (count++ === MAX_HASHTAGS_PER_POST) break
    tags.add(normalizeHashtag(match[1]))
  }
  return [...tags]
}

export function containsAsciiArt(body: string) {
  return extractHashtags(body).some(tag => tag === 'ascii' || tag === 'ascii_art')
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
      /(?:https?:\/\/|www\.|[A-Za-z0-9-]+\.[A-Za-z]{2,}|\[[^\]\r\n]+\]\(|(?<![A-Za-z0-9_])@[A-Za-z0-9_]+|(?<![\p{L}\p{M}\p{N}_])#[\p{L}\p{M}\p{N}_]+)/u
          .test(body)
        ? 1
        : 0,
    has_code: body.includes('`') ? 1 : 0,
  }
}
