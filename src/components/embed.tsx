import type { PostView } from '../types'
import { fmt, fmtFull, linkify } from '../utils'
import type { AccentChoice, ThemeChoice } from '../theme'
import { containsAsciiArt } from '../content'

export function Embed({ posts, title, href, theme, accent }: { posts: PostView[]; title: string; href: string;
  theme: ThemeChoice; accent: AccentChoice })
{
  const query = new URLSearchParams({ theme, accent })
  const embedLinks = (post: PostView) => linkify(post.body, post.mention_bios)
    .replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener noreferrer" ')
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{title} · textlog</title>
        <link rel="stylesheet" href="/embed.css?v=2" />
        <link rel="stylesheet" href={`/theme.css?${query}`} />
      </head>
      <body className="embed-body">
        <div className="embed-card">
          <header className="embed-header">
            <a className="embed-brand" href="/" target="_blank" rel="noopener noreferrer" aria-label="textlog home">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13,19V16H21V19H13M8.5,13L2.47,7H6.71L11.67,11.95C12.25,12.54 12.25,13.5 11.67,14.07L6.74,19H2.5L8.5,13Z" /></svg>
              <span>textlog</span>
            </a>
            <a className="embed-title" href={href} target="_blank" rel="noopener noreferrer">{title}</a>
          </header>
          <main>
            {posts.length
              ? posts.map(post => (
                <article className="embed-post" key={post.id}>
                  <div className="embed-post-top">
                    <a href={`/u/${post.handle}`} target="_blank" rel="noopener noreferrer">@{post.handle}</a>
                    <a className="embed-date" href={`/post/${post.id}`} target="_blank" rel="noopener noreferrer">
                      <time dateTime={post.created_at} title={fmtFull(post.created_at)}>{fmt(post.created_at)}</time>
                      {(post.reply_count || 0) > 0 && <span> · {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}</span>}
                    </a>
                  </div>
                  <p className={containsAsciiArt(post.body) ? 'ascii-art' : undefined}
                    dangerouslySetInnerHTML={{ __html: embedLinks(post) }} />
                </article>
              ))
              : <p className="embed-empty">No notes here yet.</p>}
          </main>
          <footer><a href={href} target="_blank" rel="noopener noreferrer">view on textlog →</a></footer>
        </div>
      </body>
    </html>
  )
}
