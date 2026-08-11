import type { User } from '../db'
import { Layout } from './layout'

const endpoints = [
  ['POST', '/auth/request', 'Email a sign-in code to an existing account.'],
  ['POST', '/auth/verify', 'Exchange the code for a session token.'],
  ['DELETE', '/auth/session', 'Sign out by revoking the token you are using.'],
  ['GET', '/me', 'Get the signed-in account.'],
  ['PATCH', '/me', 'Update your bio.'],
  ['POST', '/posts', <>Create a post, or reply by including <code>parent_id</code>.</>],
  ['GET', '/posts/:id', 'Get a single public post.'],
  ['PATCH', '/posts/:id', 'Edit a post you own.'],
  ['DELETE', '/posts/:id', 'Delete a post you own. Replies remain and the post becomes a “(deleted)” tombstone.'],
  ['GET', '/posts/:id/replies', 'Get the latest direct replies.'],
  ['POST', '/posts/:id/report', 'Report a post.'],
  ['GET', '/users/:handle', 'Get a public profile and its counts.'],
  ['GET', '/users/:handle/posts', "Get a user's latest posts and replies."],
  ['POST', '/users/:handle/follow', 'Follow a user.'],
  ['DELETE', '/users/:handle/follow', 'Unfollow a user.'],
  ['POST', '/users/:handle/block', 'Block a user.'],
  ['DELETE', '/users/:handle/block', 'Unblock a user.'],
  ['GET', '/feeds/latest', 'Get the latest public posts and replies.'],
  ['GET', '/feeds/hot', 'Get posts ranked by recent activity and replies.'],
  ['GET', '/tags/:tag/posts', 'Get the latest posts carrying a hashtag.'],
  ['GET', '/search?q=:query', 'Search public posts by text.'],
  ['GET', '/firehose', 'Stream new posts as server-sent events.'],
] as const

export function ApiDocs({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="API">
      <article className="static-page api-docs">
        <p className="eyebrow">developers</p>
        <h1>
          Build on{' '}
          <span className="api-title-brand">
            <img src="/textlog.svg?v=2" alt="" />
            <span>textlog</span>
          </span>
        </h1>
        <p>
          The public API is a small way to build feeds, profile cards, post embeds, and live widgets. Reading needs
          no account or API key. Writing is available to every account with a bearer token.
        </p>

        <h2>Base URL</h2>
        <pre><code>https://textlog.cc/api/v1</code></pre>
        <p>
          All API endpoints allow cross-origin requests. The machine-readable specification is at{' '}
          <a href="/api/openapi.json">/api/openapi.json</a>.
        </p>

        <h2>Endpoints</h2>
        <dl className="api-endpoints">
          {endpoints.map(([method, path, description]) => (
            <div className="api-endpoint" key={`${method}:${path}`}>
              <dt>
                <code>
                  <span className="api-method" data-method={method}>{method}</span>
                  <span className="api-path">{path}</span>
                </code>
              </dt>
              <dd><span>{description}</span></dd>
            </div>
          ))}
        </dl>

        <h2>RSS and Atom</h2>
        <p>
          Feed collections are also available as RSS 2.0 or Atom 1.0. Add <code>.rss</code> or <code>.atom</code>{' '}
          to the collection address and enter it manually in a feed reader.
        </p>
        <pre><code>{`/feeds/latest.rss
/feeds/hot.atom
/users/:handle/posts.rss
/tags/:tag/posts.atom`}</code></pre>

        <h2 id="public-archive">Public data archive</h2>
        <p>
          Download the latest daily, read-only snapshot as <a href="/dump.zip">dump.zip</a>. It contains paginated
          JSON files for public handles and bios, posts and reply links, mentions, hashtags, and follow relationships.
          The accounts are frozen: the archive contains no login credentials, contact details, record timestamps,
          blocks, reports, deleted content, or other private data.
        </p>
        <pre><code>{`curl -O https://textlog.cc/dump.zip`}</code></pre>

        <h2 id="embeds">Embeds</h2>
        <p>
          Add a read-only textlog card to any website with an iframe. Copy an example and replace the handle,
          hashtag, or post number. Feed embeds show the five newest notes and all links open textlog.
          See every format together on the <a href="/api/embed-examples">live embed examples page</a>.
        </p>
        <pre><code>{`<iframe
  src="https://textlog.cc/embed/user/alice?theme=system&accent=sage&font=menlo"
  title="@alice on textlog"
  width="100%" height="520" loading="lazy"
  style="border:0"
></iframe>`}</code></pre>
        <pre><code>{`<!-- latest notes -->
<iframe src="https://textlog.cc/embed/latest?theme=dark&accent=purple"
  title="Latest notes on textlog" width="100%" height="520" style="border:0"></iframe>

<!-- hot notes -->
<iframe src="https://textlog.cc/embed/hot?theme=light&accent=blue"
  title="Hot notes on textlog" width="100%" height="520" style="border:0"></iframe>

<!-- a hashtag -->
<iframe src="https://textlog.cc/embed/tag/photography?theme=system&accent=theme"
  title="#photography on textlog" width="100%" height="520" style="border:0"></iframe>

<!-- one post -->
<iframe src="https://textlog.cc/embed/post/123?theme=sepia&accent=rust"
  title="Post 123 on textlog" width="100%" height="220" style="border:0"></iframe>`}</code></pre>
        <p>
          Appearance uses the <code className="api-query-param">theme</code>,{' '}
          <code className="api-query-param">accent</code>, and <code className="api-query-param">font</code> query parameters.
        </p>
        <p>
          Themes: <code>system</code>, <code>light</code>, <code>dark</code>, <code>sepia</code>, and{' '}
          <code>dracula</code>.
        </p>
        <p>
          Accents: <code>theme</code>, <code>sage</code>, <code>purple</code>, <code>cyan</code>, <code>pink</code>,{' '}
          <code>amber</code>, <code>blue</code>, and <code>rust</code>.
        </p>
        <p>
          Fonts: <code>system</code>, <code>sf</code>, <code>menlo</code>,{' '}
          <code>monaco</code>, <code>consolas</code>, <code>cascadia</code>, <code>courier</code>,{' '}
          <code>lucida</code>, <code>dejavu</code>, <code>liberation</code>, <code>ubuntu</code>,{' '}
          <code>noto</code>, <code>droid</code>, <code>source</code>, <code>roboto</code>, <code>fira</code>,{' '}
          <code>jetbrains</code>, and <code>hack</code>.
        </p>

        <h2>Pagination</h2>
        <p>
          Collections accept <code>limit</code> from 1–100 (default 20). Pass the opaque{' '}
          <code>pagination.next_cursor</code> value back as <code>cursor</code> to fetch the next page.
        </p>
        <pre><code>{`curl 'https://textlog.cc/api/v1/feeds/latest?limit=10'`}</code></pre>

        <h2>Search</h2>
        <p>Search is public and uses the same prefix matching as the website. Separate words must all match.</p>
        <pre><code>{`curl 'https://textlog.cc/api/v1/search?q=quiet+notes&limit=10'`}</code></pre>

        <h2>Firehose</h2>
        <p>
          The firehose is live-only and includes top-level posts and replies. Each new post arrives as a{' '}
          <code>post</code> event. Reconnects begin from that moment and do not replay missed events.
        </p>
        <pre><code>{`const events = new EventSource('https://textlog.cc/api/v1/firehose')
events.addEventListener('post', event => {
  const post = JSON.parse(event.data)
})`}</code></pre>

        <h2>Writing</h2>
        <p>
          Every account can use the write endpoints. Authenticate with a bearer token; no separate API access
          setting is required. For long-running integrations, generate a revocable API key under{' '}
          <a href="/account/security">account security</a>.
        </p>
        <p>
          Sign in with the code emailed alongside your magic link. Accounts are only created in a browser, so the
          API cannot sign anyone up.
        </p>
        <pre><code>{`curl -X POST https://textlog.cc/api/v1/auth/request \\
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'

curl -X POST https://textlog.cc/api/v1/auth/verify \\
  -H 'content-type: application/json' -d '{"email":"you@example.com","code":"123456"}'`}</code></pre>
        <p>
          The returned token is an ordinary session. Both session tokens and generated API keys can be sent as bearer
          tokens and revoked under account security. Cookies are never accepted for writes.
        </p>
        <pre><code>{`curl -X POST https://textlog.cc/api/v1/posts \\
  -H "authorization: Bearer $TOKEN" \\
  -H 'content-type: application/json' -d '{"body":"hello from an app"}'`}</code></pre>
        <h2>Limits and errors</h2>
        <p>
          API reads are limited to 120 requests per minute per IP. Firehose clients may hold three simultaneous
          connections per IP. Writes are limited to 60 per hour per account, and posting keeps the same limit as the
          website: three posts every five minutes. A limited response uses <code>429</code> and includes{' '}
          <code>Retry-After</code>.
        </p>
        <pre><code>{`{
  "error": { "code": "not_found", "message": "Post not found" }
}`}</code></pre>
      </article>
    </Layout>
  )
}

export function EmbedExamples({ user, handle, tag, postId }: { user: User | null; handle: string | null;
  tag: string | null; postId: number | null })
{
  const examples = [
    { title: 'Latest feed', src: '/embed/latest?theme=light&accent=sage&font=menlo', height: 520 },
    { title: 'Hot feed', src: '/embed/hot?accent=purple&font=consolas', height: 520 },
    ...(handle ? [{ title: `User feed · @${handle}`,
      src: `/embed/user/${encodeURIComponent(handle)}?theme=dracula&accent=cyan&font=jetbrains`, height: 520 }] : []),
    ...(tag ? [{ title: `Tag feed · #${tag}`,
      src: `/embed/tag/${encodeURIComponent(tag)}?theme=sepia&accent=amber`, height: 520 }] : []),
    ...(postId ? [{ title: `Single post · ${postId}`,
      src: `/embed/post/${postId}?theme=system&accent=blue`, height: 240 }] : []),
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
              <iframe src={example.src} title={`${example.title} on textlog`} width="100%" height={example.height}
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
