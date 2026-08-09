export function extractHashtags(body: string) {
  return [...new Set([...body.matchAll(/#([A-Za-z0-9_]+)/g)].map(match => match[1].toLowerCase()))]
}

export function containsAsciiArt(body: string) {
  return extractHashtags(body).some(tag => tag === 'ascii' || tag === 'ascii_art')
}

export function extractMentions(body: string) {
  return [...new Set([...body.matchAll(/(?<![A-Za-z0-9_])@([A-Za-z0-9_]{2,24})(?![A-Za-z0-9_])/g)]
    .map(match => match[1].toLowerCase()))]
}
