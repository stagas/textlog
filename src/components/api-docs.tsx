import type { User } from '../db'
import { Layout } from './layout'

export function ApiDocs({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="API">
      <article className="static-page api-docs">
        <p className="eyebrow">developers</p>
        <h1>
          Build on{' '}
          <span className="api-title-brand">
            <img src="/textlog.svg?v=1" alt="" />
            <span>textlog</span>
          </span>
        </h1>
        <p>
          The public API is a small way to build feeds, profile cards, post embeds, and live widgets. Reading needs
          no account or API key. Writing needs a token and has to be turned on for your account first.
        </p>

        <h2>Base URL</h2>
        <pre><code>https://textlog.cc/api/v1</code></pre>
        <p>
          All API endpoints allow cross-origin requests. The machine-readable specification is at{' '}
          <a href="/api/openapi.json">/api/openapi.json</a>.
        </p>

        <h2>Endpoints</h2>
        <dl className="api-endpoints">
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/feeds/latest</span>
            </code>
          </dt>
          <dd>Latest public posts and replies.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/feeds/hot</span>
            </code>
          </dt>
          <dd>Posts ranked by recent activity and replies.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/posts/:id</span>
            </code>
          </dt>
          <dd>A single public post.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/posts/:id/replies</span>
            </code>
          </dt>
          <dd>Latest direct replies.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/users/:handle</span>
            </code>
          </dt>
          <dd>A public profile and its counts.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/users/:handle/posts</span>
            </code>
          </dt>
          <dd>A user's latest posts and replies.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/tags/:tag/posts</span>
            </code>
          </dt>
          <dd>Latest posts carrying a hashtag.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/firehose</span>
            </code>
          </dt>
          <dd>New posts as a live server-sent event stream.</dd>
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
          Writing is off until you turn on API access under{' '}
          <a href="/account/security">account security</a>. Until then write endpoints answer{' '}
          <code>403 api_writes_disabled</code>.
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
        <dl className="api-endpoints">
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/auth/request</span>
            </code>
          </dt>
          <dd>Email a sign-in code to an existing account.</dd>
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/auth/verify</span>
            </code>
          </dt>
          <dd>Exchange the code for a session token.</dd>
          <dt>
            <code>
              <span className="api-method">DELETE</span>
              <span className="api-path">/auth/session</span>
            </code>
          </dt>
          <dd>Revoke the token you are using.</dd>
          <dt>
            <code>
              <span className="api-method">GET</span>
              <span className="api-path">/me</span>
            </code>
          </dt>
          <dd>The signed-in account.</dd>
          <dt>
            <code>
              <span className="api-method">PATCH</span>
              <span className="api-path">/me</span>
            </code>
          </dt>
          <dd>Update your bio.</dd>
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/posts</span>
            </code>
          </dt>
          <dd>Post, or reply with <code>parent_id</code>.</dd>
          <dt>
            <code>
              <span className="api-method">PATCH</span>
              <span className="api-path">/posts/:id</span>
            </code>
          </dt>
          <dd>Edit your own post.</dd>
          <dt>
            <code>
              <span className="api-method">DELETE</span>
              <span className="api-path">/posts/:id</span>
            </code>
          </dt>
          <dd>Delete your own post.</dd>
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/posts/:id/report</span>
            </code>
          </dt>
          <dd>Report a post.</dd>
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/users/:handle/follow</span>
            </code>
          </dt>
          <dd>Follow. <code>DELETE</code> unfollows.</dd>
          <dt>
            <code>
              <span className="api-method">POST</span>
              <span className="api-path">/users/:handle/block</span>
            </code>
          </dt>
          <dd>Block. <code>DELETE</code> unblocks.</dd>
        </dl>

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
