import { appName } from '../brand'
import type { PostView, User } from '../types'
import { Layout } from './layout'
import { Post } from './post'

const highlights = [
  ['01', 'Write it your way', '/write',
    <>Notes grew support for links, code, LaTeX, unicode tags, emoji, previews, and smarter writing helpers.</>],
  ['02', 'Find your people', null, <>
    <a href="/search">Full-text search</a>,{' '}
    <a href="/explore">
      trending tags, profiles, follows, tag communities, and helpful popovers
    </a>{' '}
    make discovery easy.
  </>],
  ['03', 'Follow the conversation', '/hot', <>
    Threaded replies, backlinks, <a href="/for-you">jump-to-unread and activity in For You</a>, and{' '}
    <a href="/to-me">To Me</a> keep every conversation connected.
  </>],
  ['04', 'Make it feel like yours', '/account/edit/appearance',
    <>Choose your theme, accent, typeface, font size, density, page size, timezone, and link-preview preference.</>],
  ['05', 'Stay close, anywhere', null, <>
    <a href="/account/edit/notifications">Notifications</a>, <a href="/account/accounts">multiple accounts</a>, and{' '}
    <a href="/account/security">password or magic-link entry and private personalized feeds</a> keep you in the loop.
  </>],
  ['06', 'Built to travel', null, <>
    <a href="/latest.rss">RSS</a> and <a href="/latest.atom">Atom feeds</a>, <a href="/api/embed-examples">embeds</a>,
    {' '}
    <a href="/api">a documented API with write access</a>, and <a href="/dump.zip">a public archive</a>{' '}
    make your words portable.
  </>],
  ['07', 'Textlog in your pocket', null, <>
    A <a href="https://github.com/Faultless/textlog_flutter">mobile app for Android phones</a>, created by{' '}
    <a href="https://frontendienst.nl/">Serge Kamel aka Faultless</a>.
  </>],
] as const

export function BlogRecap({ user, posts, pageUrl }: { user: User | null; posts: PostView[]; pageUrl: string }) {
  const name = appName()
  return (
    <Layout user={user} title="A lot has happened" pageUrl={pageUrl} social={{
      title: `A lot has happened · ${name}`,
      description: 'A launch recap: better writing, discovery, conversations, notifications, feeds, and more.',
      image: new URL('/og.png?v=2', pageUrl).href,
      url: pageUrl,
      type: 'article',
      imageAlt: name,
    }}>
      <article className="static-page recap-page">
        <p className="eyebrow">since launch</p>
        <h1>
          A lot has happened.<br />Quietly, of course.
        </h1>
        <p className="recap-intro">
          We started with a simple place to write. Since then, {name}{' '}
          has become more expressive, more personal, and easier to carry with you—without getting any louder.
        </p>
        <section className="recap-highlights" aria-labelledby="recap-highlights-title">
          <p className="eyebrow">what’s new</p>
          <h2 id="recap-highlights-title">The short version</h2>
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
        <section className="recap-community" aria-labelledby="recap-community-title">
          <p className="eyebrow">from the community</p>
          <h2 id="recap-community-title">Notes we kept thinking about</h2>
        </section>
      </article>
      {posts.map(post => (
        <Post key={post.id} p={post} user={user} showReplyCount tappable
          returnPath={`/blog/recap-v1#post-${post.id}`} />
      ))}
      <div className="recap-closing">
        <p>
          There’s more to find, and plenty more to come. Thanks for making this small corner of the internet feel alive.
        </p>
        <div className="recap-actions">
          <a className="button" href="/about">about textlog</a>
          <a className="button" href="/hot">see what’s happening →</a>
        </div>
      </div>
    </Layout>
  )
}
