import { appName } from '../brand'
import { containsAsciiArt } from '../content'
import type { AccentChoice, EmbedFontChoice, ThemeChoice } from '../theme'
import type { PostView } from '../types'
import { displayPostBody, linkify } from '../utils'

export function Embed(
  { posts, title, href, theme, accent, font }: { posts: PostView[]; title: string; href: string; theme?: ThemeChoice;
    accent: AccentChoice; font?: EmbedFontChoice },
) {
  const name = appName()
  const query = new URLSearchParams()
  if (theme) query.set('theme', theme)
  query.set('accent', accent)
  if (font) query.set('font', font)
  const embedLinks = (body: string, mentionBios?: Record<string, string>) =>
    linkify(displayPostBody(body), mentionBios)
      .replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener noreferrer" ')
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${title} · ${name}`}</title>
        <link rel="stylesheet" href="/embed.css?v=13" />
        <link rel="stylesheet" href={`/theme.css?${query}`} />
      </head>
      <body className="embed-body">
        <div className="embed-card">
          <header className="embed-header">
            <a className="embed-brand" href="/" target="_blank" rel="noopener noreferrer" aria-label={`${name} home`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13,19V16H21V19H13M8.5,13L2.47,7H6.71L11.67,11.95C12.25,12.54 12.25,13.5 11.67,14.07L6.74,19H2.5L8.5,13Z" />
              </svg>
              <span>{name}</span>
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
                      read
                    </a>
                  </div>
                  <div className={`embed-post-body${containsAsciiArt(post.body) ? ' ascii-art' : ''}`}
                    dangerouslySetInnerHTML={{ __html: embedLinks(post.body, post.mention_bios) }} />
                  {post.parent && (
                    <blockquote className={'embed-parent' + (containsAsciiArt(post.parent.body) ? ' ascii-art' : '')
                      + (post.parent.deleted_at ? ' deleted-parent' : '')}
                    >
                      {post.parent.deleted_at
                        ? (
                          <a href={`/post/${post.parent.id}`} target="_blank" rel="noopener noreferrer">
                            (deleted post)
                          </a>
                        )
                        : (
                          <>
                            <div className="embed-parent-top">
                              <a href={`/u/${post.parent.handle}`} target="_blank" rel="noopener noreferrer">
                                @{post.parent.handle}
                              </a>
                              <a className="embed-date" href={`/post/${post.parent.id}`} target="_blank"
                                rel="noopener noreferrer"
                              >
                                read
                              </a>
                            </div>
                            <div className={`embed-post-body${containsAsciiArt(post.parent.body) ? ' ascii-art' : ''}`}
                              dangerouslySetInnerHTML={{
                                __html: embedLinks(post.parent.body, post.parent.mention_bios),
                              }} />
                          </>
                        )}
                    </blockquote>
                  )}
                </article>
              ))
              : <p className="embed-empty">No notes here yet.</p>}
          </main>
          <footer>
            <a href={href} target="_blank" rel="noopener noreferrer">view on {name} →</a>
          </footer>
        </div>
      </body>
    </html>
  )
}
