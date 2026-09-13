import { LinkifyIt } from 'linkify-it'
import { appOrigin } from './brand'
import { withoutMarkdownCode } from './content'

export const POST_MAX = 500
export const POST_MAX_LINES = 20
const urlMatcher = new LinkifyIt({ fuzzyLink: false, fuzzyEmail: false })

// Textareas expose line breaks as \n, but form submission may serialize them as
// \r\n. Store and validate the textarea value's canonical representation so a
// line break is consistently one character.
export function normalizePostBody(body: string) {
  body = body.replace(/\r\n?/g, '\n')
  const searchable = withoutMarkdownCode(body)
  const urls = urlMatcher.match(searchable) || []
  const replacements: { start: number; end: number; id: string }[] = []
  const origin = appOrigin()

  for (const match of urls) {
    const url = new URL(match.url)
    const post = url.pathname.match(/^\/post\/([1-9]\d*)\/?$/)
    if (origin && url.origin === origin && post && !url.username && !url.password) {
      replacements.push({ start: match.index, end: match.lastIndex, id: post[1] })
    }
  }
  for (const { start, end, id } of replacements.sort((a, b) => b.start - a.start)) {
    // Keep Markdown link destinations intact; a reference is inline content.
    if (body.slice(0, start).endsWith('](')) continue
    body = body.slice(0, start) + `&${id}` + body.slice(end)
  }
  return body
}

export function validPostBody(body: string) {
  return body.trim().length >= 1 && body.length <= POST_MAX && postBodyLineCount(body) <= POST_MAX_LINES
}

export function postBodyLineCount(body: string) {
  return body.split('\n').length
}

export function postBodyValidationMessage(body: string) {
  if (!body.trim()) return 'The note cannot be empty'

  const exceeded: string[] = []
  if (body.length > POST_MAX) exceeded.push(`${body.length}/${POST_MAX} characters`)

  const lines = postBodyLineCount(body)
  if (lines > POST_MAX_LINES) exceeded.push(`${lines}/${POST_MAX_LINES} lines`)

  if (exceeded.length === 1 && body.length > POST_MAX) return `The note cannot exceed ${POST_MAX} characters`
  return `The note exceeds the limit: ${exceeded.join(' and ')}.`
}
