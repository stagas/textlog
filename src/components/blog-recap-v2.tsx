import { appName } from '../brand'
import type { PostView, User } from '../types'
import { Layout } from './layout'
import { Post } from './post'

const highlights = [
  ['01', 'More ways to write', '/write', <>
    Markdown tables and lists, code with syntax highlighting and execution, LaTeX, maps, polls, quizzes, todos,
    previews, drafts, and an embedded write form give every note the shape it needs.
  </>],
  ['02', 'Conversations that stay readable', '/hot', <>
    Thread trees, smarter collapsing, anchored replies, backlinks, thread locks, and contextual back links make even
    long conversations easy to enter and leave.
  </>],
  ['03', 'Feeds with a point of view', '/@', <>
    Latest, Hot, For You, To Me, Any, All, and Random offer different ways into the community, with unread state and
    recent activity carried across visits.
  </>],
  ['04', 'Discovery with more context', '/explore', <>
    Full-text search, trending tags, profile and post hovercards, tag aliases and display names, and the dedicated meta
    conversation make it easier to find people and ideas.
  </>],
  ['05', 'A more personal textlog', '/account/edit/appearance', <>
    Moods, pinned notes, bookmarks, streaks, themes, accents, fonts, density, rounded corners, timestamps, and link
    preview controls let the site feel like yours.
  </>],
  ['06', 'Words across boundaries', null, <>
    Translation, Unicode hashtags, location cards, audio links, ASCII art, and content warnings help more kinds of
    expression travel safely through a text-first space.
  </>],
  ['07', 'Control without lock-in', '/account/security', <>
    Password and magic-link entry, multiple accounts, account switching, private feed keys, data export, unpublishing,
    and account deletion keep identity and writing under your control.
  </>],
  ['08', 'Connected on your terms', '/account/edit/notifications', <>
    Push notifications, interaction and recap emails, broadcast controls, and installable-app support help you stay
    close without making the site louder.
  </>],
  ['09', 'Built for the wider web', '/api', <>
    RSS and Atom, embeds, a public archive, a read/write API, conversations, drafts, bookmarks, and automatic tagging
    make textlog useful beyond its own pages.
  </>],
  ['10', 'Still small by design', '/about', <>
    Through all of it, textlog remains server-rendered, text-first, free of likes and engagement tricks, and centered
    on people writing to one another.
  </>],
] as const

export function BlogRecapV2({ user, posts, pageUrl }: { user: User | null; posts: PostView[]; pageUrl: string }) {
  const name = appName()
  return (
    <Layout user={user} title="The story so far" pageUrl={pageUrl} social={{
      title: `The story so far · ${name}`,
      description: 'A complete recap of how textlog grew: writing, conversations, discovery, identity, portability, and more.',
      image: new URL('/og.png?v=2', pageUrl).href,
      url: pageUrl,
      type: 'article',
      imageAlt: name,
    }}>
      <article className="static-page recap-page">
        <p className="eyebrow">the story so far</p>
        <h1>More ways to connect.<br />Still quietly.</h1>
        <p className="recap-intro">
          {name} began as a small place for short notes. It has grown into a richer social space without losing the
          simplicity that made it feel different. Here is the whole story in one place.
        </p>
        <section className="recap-highlights" aria-labelledby="recap-v2-highlights-title">
          <p className="eyebrow">the complete recap</p>
          <h2 id="recap-v2-highlights-title">What textlog has become</h2>
          <ol>
            {highlights.map(([marker, title, path, copy]) => (
              <li key={marker}>
                <span className="recap-marker" aria-hidden="true">{marker}</span>
                <div>
                  <h3>{path ? <a href={path}>{title}</a> : title}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="recap-community" aria-labelledby="recap-v2-community-title">
          <p className="eyebrow">from the community</p>
          <h2 id="recap-v2-community-title">The conversations that grew</h2>
          <p>These notes started some of textlog’s most active conversations, ranked by replies across the full thread.</p>
        </section>
      </article>
      {posts.map(post => (
        <Post key={post.id} p={post} user={user} showReplyCount tappable
          returnPath={`/blog/recap-v2#post-${post.id}`} />
      ))}
      <div className="recap-closing">
        <p>Every feature began with people writing, replying, and making this quiet corner of the web their own.</p>
        <div className="recap-actions">
          <a className="button" href="/enter" rel="nofollow">join the community</a>
          <a className="button" href="/hot">browse notes →</a>
        </div>
      </div>
    </Layout>
  )
}
