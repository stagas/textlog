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
            <img src="/root.svg?v=1" alt="" />
            <span>root<span className="brand-dot">.</span>mx</span>
          </span>
        </h1>
        <p>
          The public API is a small, read-only way to build feeds, profile cards, post embeds, and live widgets.
          It needs no account or API key.
        </p>

        <h2>Base URL</h2>
        <pre><code>https://root.mx/api/v1</code></pre>
        <p>All JSON endpoints allow cross-origin requests. The machine-readable specification is at{' '}
          <a href="/api/openapi.json">/api/openapi.json</a>.</p>

        <h2>Endpoints</h2>
        <dl className="api-endpoints">
          <dt><code><span className="api-method">GET</span><span className="api-path">/feeds/latest</span></code></dt>
          <dd>Latest public posts and replies.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/feeds/hot</span></code></dt>
          <dd>Posts ranked by recent activity and replies.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/posts/:id</span></code></dt>
          <dd>A single public post.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/posts/:id/replies</span></code></dt>
          <dd>Latest direct replies.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/users/:handle</span></code></dt>
          <dd>A public profile and its counts.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/users/:handle/posts</span></code></dt>
          <dd>A user's latest posts and replies.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/tags/:tag/posts</span></code></dt>
          <dd>Latest posts carrying a hashtag.</dd>
          <dt><code><span className="api-method">GET</span><span className="api-path">/firehose</span></code></dt>
          <dd>New posts as a live server-sent event stream.</dd>
        </dl>

        <h2>Pagination</h2>
        <p>Collections accept <code>limit</code> from 1–100 (default 20). Pass the opaque{' '}
          <code>pagination.next_cursor</code> value back as <code>cursor</code> to fetch the next page.</p>
        <pre><code>{`curl 'https://root.mx/api/v1/feeds/latest?limit=10'`}</code></pre>

        <h2>Firehose</h2>
        <p>The firehose is live-only and includes top-level posts and replies. Each new post arrives as a{' '}
          <code>post</code> event. Reconnects begin from that moment and do not replay missed events.</p>
        <pre><code>{`const events = new EventSource('https://root.mx/api/v1/firehose')
events.addEventListener('post', event => {
  const post = JSON.parse(event.data)
})`}</code></pre>

        <h2>Limits and errors</h2>
        <p>JSON reads are limited to 120 requests per minute per IP. Firehose clients may hold three simultaneous
          connections per IP. A limited response uses <code>429</code> and includes <code>Retry-After</code>.</p>
        <pre><code>{`{
  "error": { "code": "not_found", "message": "Post not found" }
}`}</code></pre>
      </article>
    </Layout>
  )
}
