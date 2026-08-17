import type { ApiPost } from './api'
import { markdownPlainText, sanitizedMarkdownHtml } from './markdown'
import { markdownUrl } from './utils'

export type SyndicationFormat = 'rss' | 'atom'

export type SyndicationFeed = {
  title: string
  description: string
  pageUrl: string
  feedUrl: string
  posts: ApiPost[]
  omitAuthorInTitles?: boolean
  activities?: SyndicationActivity[]
  postTitlePrefixes?: Record<number, string>
}

export type SyndicationActivity = {
  id: string
  title: string
  url: string
  created_at: string
  author: { handle: string; url: string }
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

function itemTitle(post: ApiPost, omitAuthor: boolean) {
  const text = markdownPlainText(post.body)
  return omitAuthor ? text : `@${post.author.handle}: ${text}`
}

function updated(posts: ApiPost[]) {
  return posts.reduce((latest, post) => post.created_at > latest ? post.created_at : latest, '1970-01-01T00:00:00.000Z')
}

function feedUpdated(feed: SyndicationFeed) {
  return (feed.activities || []).reduce((latest, activity) => activity.created_at > latest
    ? activity.created_at
    : latest, updated(feed.posts))
}

function feedContent(feed: SyndicationFeed, body: string) {
  const html = sanitizedMarkdownHtml(body)
  return html.replace(/\bhref="([^"]+)"/g, (attribute, href: string) => {
    if (/^(?:https?:|mailto:)/i.test(href)) return attribute
    try {
      const absolute = markdownUrl(href) || new URL(href, feed.pageUrl).href
      return `href="${absolute}"`
    }
    catch {
      return attribute
    }
  })
}

function atom(feed: SyndicationFeed) {
  const postEntries = feed.posts.map(post => ({ id: post.url,
    title: `${feed.postTitlePrefixes?.[post.id] || ''}${itemTitle(post, !!feed.omitAuthorInTitles)}`,
    url: post.url, created_at: post.created_at, author: post.author, content: feedContent(feed, post.body),
    permalink: true }))
  const allEntries = [...postEntries, ...(feed.activities || []).map(activity => ({ ...activity,
    content: `<p>${activity.title}</p>`, permalink: false }))].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const entries = allEntries.map(entry =>
    `  <entry>
    <title>${xml(entry.title)}</title>
    <id>${xml(entry.id)}</id>
    <link rel="alternate" href="${xml(entry.url)}" />
    <published>${xml(entry.created_at)}</published>
    <updated>${xml(entry.created_at)}</updated>
    <author><name>${xml(`@${entry.author.handle}`)}</name><uri>${xml(entry.author.url)}</uri></author>
    <content type="html">${xml(entry.content)}</content>
  </entry>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(feed.title)}</title>
  <subtitle>${xml(feed.description)}</subtitle>
  <id>${xml(feed.feedUrl)}</id>
  <link rel="self" type="application/atom+xml" href="${xml(feed.feedUrl)}" />
  <link rel="alternate" type="text/html" href="${xml(feed.pageUrl)}" />
  <updated>${feedUpdated(feed)}</updated>
${entries}${entries ? '\n' : ''}</feed>
`
}

function rss(feed: SyndicationFeed) {
  const postEntries = feed.posts.map(post => ({ id: post.url,
    title: `${feed.postTitlePrefixes?.[post.id] || ''}${itemTitle(post, !!feed.omitAuthorInTitles)}`,
    url: post.url, created_at: post.created_at, author: post.author, content: feedContent(feed, post.body),
    permalink: true }))
  const allEntries = [...postEntries, ...(feed.activities || []).map(activity => ({ ...activity,
    content: `<p>${activity.title}</p>`, permalink: false }))].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const items = allEntries.map(entry =>
    `    <item>
      <title>${xml(entry.title)}</title>
      <link>${xml(entry.url)}</link>
      <guid isPermaLink="${entry.permalink}">${xml(entry.id)}</guid>
      <pubDate>${new Date(entry.created_at).toUTCString()}</pubDate>
      <dc:creator>${xml(`@${entry.author.handle}`)}</dc:creator>
      <description>${xml(entry.content)}</description>
    </item>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(feed.title)}</title>
    <link>${xml(feed.pageUrl)}</link>
    <description>${xml(feed.description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(feedUpdated(feed)).toUTCString()}</lastBuildDate>
    <atom:link href="${xml(feed.feedUrl)}" rel="self" type="application/rss+xml" />
${items}${items ? '\n' : ''}  </channel>
</rss>
`
}

export function syndicationResponse(format: SyndicationFormat, feed: SyndicationFeed, cacheControl =
  'public, max-age=60, stale-while-revalidate=300') {
  return new Response(format === 'atom' ? atom(feed) : rss(feed), {
    headers: {
      'content-type': `application/${format}+xml; charset=utf-8`,
      'cache-control': cacheControl,
    },
  })
}
