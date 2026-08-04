import type { ApiPost } from './api'

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

function itemTitle(post: ApiPost) {
  return `@${post.author.handle}: ${post.body.replace(/\s+/g, ' ').trim()}`
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
    <content type="text">${xml(post.body)}</content>
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
      <description>${xml(post.body)}</description>
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
