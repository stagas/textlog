import { appName, appOrigin } from './brand'
import { markdownPlainText } from './markdown'
import { shortPostAge } from './components/post-age'
import type { PostFeedPage } from './types'

const ansi = {
  accent: '\x1b[38;2;116;150;104m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
}

const terminalControlSequence = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]|\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?)/g

function terminalPostBody(body: string) {
  const plain = markdownPlainText(body).replace(terminalControlSequence, '')
  return plain.replace(
    /(?<![\p{L}\p{M}\p{N}_])(?:@[A-Za-z0-9_]{2,24}(?![A-Za-z0-9_])|#[\p{L}\p{M}\p{N}_]+)/gu,
    value => `${ansi.accent}${value}${ansi.reset}`,
  )
}

export function isCurlRequest(request: Request) {
  return /^curl(?:\/|$)/i.test(request.headers.get('user-agent') || '')
}

export function terminalFeed(feed: PostFeedPage, requestUrl: string, title: 'new' | 'hot' | 'all' | 'any',
  now = Date.now())
{
  const origin = appOrigin() || new URL(requestUrl).origin
  const posts = feed.posts
  const heading = `${ansi.bold}${appName()}${ansi.reset}  ${ansi.accent}${title}${ansi.reset}`
  if (!posts.length) return `${heading}\n\n${ansi.dim}No posts.${ansi.reset}\n`

  const postIds = new Set(posts.map(post => post.id))
  const children = new Map<number, typeof posts>()
  for (const post of posts) {
    if (post.parent_id === null || !postIds.has(post.parent_id)) continue
    const siblings = children.get(post.parent_id) || []
    siblings.push(post)
    children.set(post.parent_id, siblings)
  }
  const roots = posts.filter(post => post.parent_id === null || !postIds.has(post.parent_id))

  const renderPost = (post: (typeof posts)[number], prefix = '', connector = ''): string => {
    const rightMeta = `${origin}/post/${post.id} · ${shortPostAge(post.created_at, now)}`
    const handle = `@${post.handle}`
    const left = `${prefix}${connector}`
    const meta = `${left}${ansi.accent}${handle}${ansi.reset}  ${ansi.dim}${rightMeta}${ansi.reset}`
    const body = terminalPostBody(post.body) || '[empty post]'
    const bodyPrefix = `${prefix}${connector === '├── ' ? '│   ' : connector === '└── ' ? '    ' : ''}`
    const descendants = children.get(post.id) || []
    const branches = descendants.map((child, index) => renderPost(
      child,
      bodyPrefix,
      index === descendants.length - 1 ? '└── ' : '├── ',
    ))
    return `${meta}\n${bodyPrefix}${body}${branches.length ? `\n${branches.join('\n')}` : ''}`
  }
  return `${heading}\n\n${roots.map(post => renderPost(post)).join('\n\n')}\n`
}

export function terminalFeedResponse(feed: PostFeedPage, requestUrl: string,
  title: 'new' | 'hot' | 'all' | 'any' = 'new')
{
  return new Response(terminalFeed(feed, requestUrl, title), { headers: {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=15, stale-while-revalidate=30',
    vary: 'User-Agent',
  } })
}
