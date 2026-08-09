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

        <h2>Pagination</h2>
        <p>
          Collections accept <code>limit</code> from 1–100 (default 20). Pass the opaque{' '}
          <code>pagination.next_cursor</code> value back as <code>cursor</code> to fetch the next page.
        </p>
        <pre><code>{`curl 'https://textlog.cc/api/v1/feeds/latest?limit=10'`}</code></pre>

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
          setting is required.
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
          The returned token is an ordinary session. It is listed under account security and can be revoked there.
          Send it as a bearer token. Cookies are never accepted for writes.
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
