import type { ApiPost } from './api'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { decodeHtmlEntities } from './link-preview'
import { displayPostBody } from './utils'

export type SyndicationFormat = 'rss' | 'atom'

export type SyndicationFeed = {
  title: string
  description: string
  pageUrl: string
  feedUrl: string
  posts: ApiPost[]
}

function xml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function postHtml(body: string) {
  const renderer = new marked.Renderer()
  renderer.html = ({ text }) => /^<\/?(?:a|abbr|address|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)(?:\s|\/?>)/i.test(text)
    ? text
    : xml(text)
  const rendered = marked.parse(displayPostBody(body), {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  })
  return sanitizeHtml(rendered, {
    allowedTags: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p',
      'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  }).trim()
}

function itemTitle(post: ApiPost) {
  const text = decodeHtmlEntities(sanitizeHtml(postHtml(post.body), {
    allowedTags: [],
    allowedAttributes: {},
  })).replace(/\s+/g, ' ').trim()
  return `@${post.author.handle}: ${text}`
}

function updated(posts: ApiPost[]) {
  return posts.reduce((latest, post) => post.created_at > latest ? post.created_at : latest, '1970-01-01T00:00:00.000Z')
}

function atom(feed: SyndicationFeed) {
  const entries = feed.posts.map(post =>
    `  <entry>
    <title>${xml(itemTitle(post))}</title>
    <id>${xml(post.url)}</id>
    <link rel="alternate" href="${xml(post.url)}" />
    <published>${xml(post.created_at)}</published>
    <updated>${xml(post.created_at)}</updated>
    <author><name>${xml(`@${post.author.handle}`)}</name><uri>${xml(post.author.url)}</uri></author>
    <content type="html">${xml(postHtml(post.body))}</content>
  </entry>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(feed.title)}</title>
  <subtitle>${xml(feed.description)}</subtitle>
  <id>${xml(feed.feedUrl)}</id>
  <link rel="self" type="application/atom+xml" href="${xml(feed.feedUrl)}" />
  <link rel="alternate" type="text/html" href="${xml(feed.pageUrl)}" />
  <updated>${updated(feed.posts)}</updated>
${entries}${entries ? '\n' : ''}</feed>
`
}

function rss(feed: SyndicationFeed) {
  const items = feed.posts.map(post =>
    `    <item>
      <title>${xml(itemTitle(post))}</title>
      <link>${xml(post.url)}</link>
      <guid isPermaLink="true">${xml(post.url)}</guid>
      <pubDate>${new Date(post.created_at).toUTCString()}</pubDate>
      <dc:creator>${xml(`@${post.author.handle}`)}</dc:creator>
      <description>${xml(postHtml(post.body))}</description>
    </item>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(feed.title)}</title>
    <link>${xml(feed.pageUrl)}</link>
    <description>${xml(feed.description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(updated(feed.posts)).toUTCString()}</lastBuildDate>
    <atom:link href="${xml(feed.feedUrl)}" rel="self" type="application/rss+xml" />
${items}${items ? '\n' : ''}  </channel>
</rss>
`
}

export function syndicationResponse(format: SyndicationFormat, feed: SyndicationFeed) {
  return new Response(format === 'atom' ? atom(feed) : rss(feed), {
    headers: {
      'content-type': `application/${format}+xml; charset=utf-8`,
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}
