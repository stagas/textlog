import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import type { ReactNode } from 'react'
import { appName, appOrigin } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('json', json)

function CodeBlock({ language, children }: { language: 'bash' | 'html' | 'json'; children: string }) {
  return (
    <pre>
      <code className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: hljs.highlight(children, { language }).value }} />
    </pre>
  )
}

function ApiSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <details className="api-docs-section">
      <summary>
        <h2 id={id}>{title}</h2>
      </summary>
      {children}
    </details>
  )
}

const endpoints: ReadonlyArray<readonly [string, string, ReactNode, boolean?]> = [
  ['POST', '/auth/request', 'Email a sign-in code to an existing account.'],
  ['POST', '/auth/verify', 'Exchange the code for a session token.'],
  ['DELETE', '/auth/session', 'Sign out by revoking the token you are using.', true],
  ['GET', '/me', 'Get the signed-in account.', true],
  ['PATCH', '/me', 'Update your bio.', true],
  ['POST', '/posts', <>
    Create a post, or reply by including <code>parent_id</code>.
  </>, true],
  ['GET', '/posts/:id', 'Get a single public post.'],
  ['PATCH', '/posts/:id', 'Edit a post you own.', true],
  ['DELETE', '/posts/:id', 'Delete a post you own. Replies remain and the post becomes a “(deleted post)” tombstone.',
    true],
  ['POST', '/posts/:id/unpublish', 'Move a post you own back into your drafts.', true],
  ['GET', '/posts/:id/replies', <>
    Get replies recursively. Use the optional <code>depth</code>{' '}
    query parameter (1–20, default 1). Each reply is returned with its depth, parent ID, and{' '}
    <code>top_id</code>; use its aggregate <code>reply_count</code>{' '}
    to detect omitted descendants. Top-level posts have a null <code>top_id</code>.
  </>],
  ['POST', '/posts/:id/report', 'Report a post.', true],
  ['POST', '/posts/:id/poll/votes', 'Vote in a poll. Results appear after voting or expiration.', true],
  ['GET', '/drafts', 'List your drafts.', true],
  ['POST', '/drafts', 'Create a post or reply draft.', true],
  ['GET', '/drafts/:id', 'Get one of your drafts.', true],
  ['PATCH', '/drafts/:id', 'Update one of your drafts.', true],
  ['DELETE', '/drafts/:id', 'Delete one of your drafts.', true],
  ['POST', '/drafts/:id/publish', 'Atomically publish and remove a draft.', true],
  ['GET', '/users/:handle', <>
    Get a public profile, relationship totals, and its pinned note and reply. Your authenticated profile also includes
    private blocked-user and blocked-tag counts.
  </>],
  ['GET', '/users/:handle/notes', 'Get a user\'s latest top-level notes.'],
  ['GET', '/users/:handle/posts', <>
    Backward-compatible alias for <code>/users/:handle/notes</code>.
  </>],
  ['GET', '/users/:handle/replies', 'Get a user\'s latest replies.'],
  ['GET', '/users/:handle/following/users', 'List accounts followed by a user.'],
  ['GET', '/users/:handle/following/tags', 'List hashtags followed by a user.'],
  ['GET', '/users/:handle/followers', 'List accounts following a user.'],
  ['POST', '/users/:handle/follow', 'Follow a user.', true],
  ['DELETE', '/users/:handle/follow', 'Unfollow a user.', true],
  ['POST', '/users/:handle/block', 'Block a user.', true],
  ['DELETE', '/users/:handle/block', 'Unblock a user.', true],
  ['GET', '/users/:handle/blocks', 'List accounts you have blocked. The handle must be your own.', true],
  ['GET', '/feeds/all', 'Get all public posts and replies.'],
  ['GET', '/feeds/all/conversations', 'Get the all feed grouped and classified like the web app.'],
  ['POST', '/feeds/all/read', 'Mark selected all-feed posts as read using post_ids.', true],
  ['POST', '/feeds/all/read-all', 'Mark every visible all-feed post as read.', true],
  ['GET', '/feeds/hot', 'Get posts ranked by recent activity and replies.'],
  ['GET', '/feeds/hot/conversations', 'Get the hot feed grouped and classified like the web app.'],
  ['GET', '/activities/my-feed', 'Get activity from followed people and tags, plus activity directed to you.', true],
  ['GET', '/activities/my-feed/conversations', <>
    Get My Feed activity in web timeline order, with post activity grouped into conversations.
  </>, true],
  ['POST', '/activities/my-feed/read', 'Mark selected activities as read using their activity_ids.', true],
  ['POST', '/activities/my-feed/read-all', 'Mark every My Feed activity as read.', true],
  ['GET', '/activities/@', 'Get replies, mentions, and follows directed to you.', true],
  ['GET', '/activities/@/conversations', <>
    Get @ activity in web timeline order, with post activity grouped into conversations.
  </>, true],
  ['POST', '/activities/@/read', 'Mark selected @ activities as read using their activity_ids.', true],
  ['POST', '/activities/@/read-all', 'Mark every @ activity as read.', true],
  ['GET', '/tags/:tag', 'Get hashtag details and post and follower counts.'],
  ['GET', '/tags/:tag/posts', 'Get the latest posts carrying a hashtag.'],
  ['GET', '/tags/:tag/followers', 'List accounts following a hashtag.'],
  ['POST', '/tags/:tag/follow', 'Follow a hashtag.', true],
  ['DELETE', '/tags/:tag/follow', 'Unfollow a hashtag.', true],
  ['POST', '/tags/:tag/block', 'Block a hashtag.', true],
  ['DELETE', '/tags/:tag/block', 'Unblock a hashtag.', true],
  ['GET', '/explore', 'Discover suggested people and trending hashtags.'],
  ['GET', '/search?q=:query', 'Search public posts by text.'],
  ['GET', '/firehose', 'Stream new posts as server-sent events.'],
] as const

export function ApiDocs({ user }: { user: User | null }) {
  const name = appName()
  const origin = appOrigin() || 'http://localhost:3000'
  return (
    <Layout user={user} title="API">
      <article className="static-page api-docs">
        <p className="eyebrow">developers</p>
        <h1>
          Build on{' '}
          <span className="api-title-brand">
            <img src="/textlog.svg?v=2" alt="" />
            <span>{name}</span>
          </span>
        </h1>
        <p>
          The public API is a small way to build feeds, profile cards, post embeds, and live widgets. Reading needs no
          account or API key, except personalized activity. Personalized activity and writing use a bearer token.
        </p>
        <p>
          All API endpoints allow cross-origin requests. The machine-readable specification is at{' '}
          <a href="/api/openapi.json">/api/openapi.json</a>.
        </p>

        <ApiSection title="Endpoints">
          <div className="api-base-url">
            <h3>Base URL</h3>
            <pre><code>{origin}/api/v1</code></pre>
          </div>
          <dl className="api-endpoints">
            {endpoints.map(([method, path, description, authentication]) => (
              <div className="api-endpoint" key={`${method}:${path}`}>
                <dt>
                  <code>
                    <span className="api-method" data-method={method} data-auth={authentication || undefined}>
                      {!!authentication && <span className="api-auth-dot" aria-hidden="true" />}
                      {method}
                    </span>
                    <span className="api-path">{path}</span>
                  </code>
                </dt>
                <dd>
                  <span>{description}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="api-auth-legend">
            <code>
              <span className="api-method" data-auth="true">
                <span className="api-auth-dot" aria-hidden="true" />
                VERB
              </span>
            </code>{' '}
            authentication bearer token required
          </p>
        </ApiSection>

        <ApiSection title="Web-compatible threaded feeds" id="threaded-feeds">
          <p>
            Use the <code>/conversations</code> variants when a client should render the same feed structure as the web
            app. The original endpoints remain flat, post- or activity-paginated collections for existing clients.
            Threaded feeds paginate conversations using the web page sizes <code>20</code>, <code>40</code>,{' '}
            <code>80</code>, or <code>100</code>.
          </p>
          <CodeBlock language="bash">{`curl '${origin}/api/v1/feeds/all/conversations?limit=20'
curl '${origin}/api/v1/feeds/hot/conversations?limit=20'

curl '${origin}/api/v1/activities/my-feed/conversations?limit=20' \\
  -H "authorization: Bearer $TOKEN"
curl '${origin}/api/v1/activities/@/conversations?limit=20' \\
  -H "authorization: Bearer $TOKEN"`}</CodeBlock>
          <p>
            Public threaded feeds return conversation objects containing the exact posts selected for that web feed
            page. Posts include <code>parent_id</code>, absolute <code>depth</code>, <code>classification</code>{' '}
            (<code>root</code> or <code>reply</code>), <code>feed_ancestor_gap</code>, <code>unread</code>, and{' '}
            <code>directed_to_viewer</code>. Follow each post’s parent relationship to build the visible reply tree.
          </p>
          <CodeBlock language="json">{`{
  "data": [{
    "id": 123,
    "posts": [
      { "id": 123, "parent_id": null, "depth": 0, "classification": "root" },
      { "id": 140, "parent_id": 123, "depth": 1, "classification": "reply" }
    ]
  }],
  "pagination": { "next_cursor": "opaque", "previous_cursor": null }
}`}</CodeBlock>
          <p>
            Personalized conversation feeds require a bearer token. Their ordered <code>data</code> array mixes{' '}
            <code>conversation</code> items with standalone typed <code>activity</code> items for user follows, hashtag
            follows, and signups. Conversation posts retain <code>activity_id</code> and <code>activity_type</code>{' '}
            (<code>post</code>, <code>reply</code>, or <code>mention</code>), so the existing activity read endpoints can
            mark them read.
          </p>
          <p>
            Pass <code>pagination.next_cursor</code> or <code>pagination.previous_cursor</code> back as{' '}
            <code>cursor</code>. Reading these endpoints does not mark items read.
          </p>
        </ApiSection>

        <ApiSection title="RSS and Atom">
          <p>
            Feed collections are also available as RSS 2.0 or Atom 1.0. Add <code>.rss</code> or <code>.atom</code>{' '}
            to the collection address and enter it manually in a feed reader.
          </p>
          <pre><code>{`/feeds/all.rss
/feeds/hot.atom
/users/:handle/posts.rss
/tags/:tag/posts.atom`}</code></pre>
          <p>The all and hot feeds also have shorter root-level aliases:</p>
          <pre><code>{`/all.json
/all.rss
/all.atom
/hot.json
/hot.rss
/hot.atom`}</code></pre>
          <p>
            Signed-in users can generate private, personalized My Feed RSS and Atom URLs under <strong>Feed key</strong>
            {' '}
            in{' '}
            <a href="/account/security#feed-keys" target="_blank">account security</a>. These unguessable URLs are
            read-only, require no bearer header, and must be kept secret. Each key can be named, expired, or revoked
            independently. Personalized feeds are marked private and are not publicly cached.
          </p>
          <pre><code>{`/feeds/my-feed/:key.rss
/feeds/my-feed/:key.atom`}</code></pre>
          <p>
            The former <code>latest</code>, <code>for-you</code>, and <code>to-me</code> API and feed addresses remain
            available as backward-compatible aliases.
          </p>
        </ApiSection>

        <ApiSection title="Public data archive" id="public-archive">
          <p>
            Download the latest daily, read-only snapshot as{' '}
            <a href="/dump.zip">dump.zip</a>. It contains paginated JSON files for public handles and bios, posts and
            reply links, mentions, hashtags, and follow relationships. The accounts are frozen: the archive contains no
            login credentials, contact details, record timestamps, blocks, reports, deleted content, or other private
            data.
          </p>
          <CodeBlock language="bash">{`curl -O ${origin}/dump.zip`}</CodeBlock>
        </ApiSection>

        <ApiSection title="Embeds" id="embeds">
          <p>
            Add a read-only {name}{' '}
            card to any website with an iframe. Copy an example and replace the handle, hashtag, or post number. Feed
            embeds show the five newest notes and all links open {name}. See every format together on the{' '}
            <a href="/api/embed-examples">live embed examples page</a>.
          </p>
          <CodeBlock language="html">
            {`<iframe
  src="${origin}/embed/user/alice?theme=system&accent=sage&font=menlo"
  title="@alice on ${name}"
  width="100%" height="520" loading="lazy"
  style="border:0"
></iframe>`}
          </CodeBlock>
          <CodeBlock language="html">
            {`<!-- all notes -->
<iframe src="${origin}/embed/all?theme=dark&accent=purple"
  title="All notes on ${name}" width="100%" height="520" style="border:0"></iframe>

<!-- hot notes -->
<iframe src="${origin}/embed/hot?theme=light&accent=blue"
  title="Hot notes on ${name}" width="100%" height="520" style="border:0"></iframe>

<!-- a hashtag -->
<iframe src="${origin}/embed/tag/photography?theme=system&accent=theme"
  title="#photography on ${name}" width="100%" height="520" style="border:0"></iframe>

<!-- one post -->
<iframe src="${origin}/embed/post/123?theme=sepia&accent=rust"
  title="Post 123 on ${name}" width="100%" height="220" style="border:0"></iframe>`}
          </CodeBlock>
          <p>
            Appearance uses the <code className="api-query-param">theme</code>,{' '}
            <code className="api-query-param">accent</code>, and <code className="api-query-param">font</code>{' '}
            query parameters.
          </p>
          <p>
            Themes: <code>system</code>, <code>light</code>, <code>dark</code>, <code>sepia</code>, and{' '}
            <code>dracula</code>.
          </p>
          <p>
            Accents: <code>theme</code>, <code>sage</code>, <code>purple</code>, <code>cyan</code>, <code>pink</code>,
            {' '}
            <code>amber</code>, <code>blue</code>, and <code>rust</code>.
          </p>
          <p>
            Fonts: <code>system</code>, <code>sf</code>, <code>menlo</code>, <code>monaco</code>, <code>consolas</code>,
            {' '}
            <code>cascadia</code>, <code>courier</code>, <code>lucida</code>, <code>dejavu</code>,{' '}
            <code>liberation</code>, <code>ubuntu</code>, <code>noto</code>, <code>droid</code>, <code>source</code>,
            {' '}
            <code>roboto</code>, <code>fira</code>, <code>jetbrains</code>, and <code>hack</code>.
          </p>
        </ApiSection>

        <ApiSection title="Pagination">
          <p>
            Collections accept <code>limit</code> from 1–100 (default 20). Pass the opaque{' '}
            <code>pagination.next_cursor</code> value back as <code>cursor</code>{' '}
            to fetch the next page. Replies include their immediate quoted post in{' '}
            <code>parent</code>, so displaying a feed needs no per-post follow-up requests.
          </p>
          <CodeBlock language="bash">{`curl '${origin}/api/v1/feeds/all?limit=10'`}</CodeBlock>
          <CodeBlock language="bash">
            {`curl '${origin}/api/v1/activities/my-feed?limit=10' \\
  -H "authorization: Bearer $TOKEN"`}
          </CodeBlock>
          <p>
            Personalized activity collections return <code>has_unread</code> and typed activity objects. Each activity’s
            {' '}
            <code>type</code> is <code>post</code>, <code>reply</code>, <code>mention</code>, <code>user_follow</code>,
            {' '}
            <code>tag_follow</code>, or <code>signup</code>; <code>payload</code>{' '}
            contains the corresponding post or actor and target.
          </p>
          <p>
            Explore has independent <code>people_limit</code>, <code>people_cursor</code>, <code>tags_limit</code>, and
            {' '}
            <code>tags_cursor</code>{' '}
            parameters. When a bearer token is supplied, reads include viewer relationship state and omit blocked people
            and hashtags.
          </p>
        </ApiSection>

        <ApiSection title="Search">
          <p>Search is public and uses the same prefix matching as the website. Separate words must all match.</p>
          <CodeBlock language="bash">{`curl '${origin}/api/v1/search?q=quiet+notes&limit=10'`}</CodeBlock>
        </ApiSection>

        <ApiSection title="Firehose">
          <p>
            The firehose is live-only and includes top-level posts and replies. Each new post arrives as a{' '}
            <code>post</code> event. Reconnects begin from that moment and do not replay missed events.
          </p>
          <pre><code>{`const events = new EventSource('${origin}/api/v1/firehose')
events.addEventListener('post', event => {
  const post = JSON.parse(event.data)
})`}</code></pre>
        </ApiSection>

        <ApiSection title="Writing">
          <p>
            Every account can use the write endpoints. Authenticate with a bearer token; no separate API access setting
            is required. For long-running integrations,{' '}
            <a href="/account/api-keys/new" target="_blank">generate a revocable API key</a>.
          </p>
          <p>
            Sign in with the code emailed alongside your magic link. Accounts are only created in a browser, so the API
            cannot sign anyone up.
          </p>
          <CodeBlock language="bash">
            {`curl -X POST ${origin}/api/v1/auth/request \\
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'

curl -X POST ${origin}/api/v1/auth/verify \\
  -H 'content-type: application/json' -d '{"email":"you@example.com","code":"123456"}'`}
          </CodeBlock>
          <p>
            Posts include link previews and poll metadata. Live poll counts are hidden until you vote or the poll
            expires. Drafts support ordinary CRUD plus an atomic publish endpoint.
          </p>
          <p>
            The returned token is an ordinary session. Both session tokens and generated API keys can be sent as bearer
            tokens and revoked under{' '}
            <a href="/account/security" target="_blank">account security</a>. Cookies are never accepted for writes.
          </p>
          <CodeBlock language="bash">
            {`curl -X POST ${origin}/api/v1/posts \\
  -H "authorization: Bearer $TOKEN" \\
  -H 'content-type: application/json' -d '{"body":"hello from an app"}'`}
          </CodeBlock>
        </ApiSection>
        <ApiSection title="Limits and errors">
          <p>
            API reads are limited to 120 requests per minute per IP. Writes are limited to 60 per hour per account, and
            posting keeps the same limit as the website: five posts every five minutes. A limited response uses{' '}
            <code>429</code> and includes <code>Retry-After</code>.
          </p>
          <CodeBlock language="json">
            {`{
  "error": { "code": "not_found", "message": "Post not found" }
}`}
          </CodeBlock>
        </ApiSection>
      </article>
    </Layout>
  )
}

export function EmbedExamples(
  { user, handle, tag, postId }: { user: User | null; handle: string | null; tag: string | null;
    postId: number | null },
) {
  const name = appName()
  const examples = [
    { title: 'All feed', src: '/embed/all?theme=light&accent=sage&font=menlo', height: 520 },
    { title: 'Hot feed', src: '/embed/hot?accent=purple&font=consolas', height: 520 },
    ...(handle
      ? [{ title: `User feed · @${handle}`,
        src: `/embed/user/${encodeURIComponent(handle)}?theme=dracula&accent=cyan&font=jetbrains`, height: 520 }]
      : []),
    ...(tag
      ? [{ title: `Tag feed · #${tag}`, src: `/embed/tag/${encodeURIComponent(tag)}?theme=sepia&accent=amber`,
        height: 520 }]
      : []),
    ...(postId
      ? [{ title: `Single post · ${postId}`, src: `/embed/post/${postId}?theme=system&accent=blue`, height: 240 }]
      : []),
  ]
  return (
    <Layout user={user} title="embed examples">
      <article className="static-page api-docs embed-examples">
        <p className="eyebrow">developers</p>
        <h1>Live embed examples</h1>
        <p>
          These are the same cross-domain iframes you can place on another website, shown with different themes and
          accents. See the <a href="/api#embeds">embed documentation</a> for copy-paste code and every option.
        </p>
        <div className="embed-example-grid">
          {examples.map(example => (
            <section className="embed-example" key={example.src}>
              <h2>{example.title}</h2>
              <iframe src={example.src} title={`${example.title} on ${name}`} width="100%" height={example.height}
                loading="lazy" />
              <code>{example.src}</code>
            </section>
          ))}
        </div>
        {(!handle || !tag || !postId) && (
          <p className="quiet">User, tag, and single-post examples appear as soon as the site has a public note.</p>
        )}
      </article>
    </Layout>
  )
}
