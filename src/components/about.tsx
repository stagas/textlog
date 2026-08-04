import { type User } from '../db'
import { Layout } from './layout'

export function About({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="about">
      <article className="static-page">
        <p className="eyebrow">about</p>
        <h1>A quieter place for your thoughts.</h1>
        <p>
          root.mx is a simple social text log: write short notes, follow people and hashtags, and join conversations
          without turning every thought into a performance.
        </p>
        <p>
          Posts are limited to 280 characters. That constraint is intentional—it keeps the site quick to read and
          encourages people to say one thing at a time.
        </p>
        <h2>Read with RSS or Atom</h2>
        <p>
          The hot and latest feeds, user notes, and hashtag pages are available as RSS and Atom. Add <code>.rss</code>
          {' '}or <code>.atom</code> to the end of the page URL, then enter the resulting address in your feed reader.
        </p>
        <h2>Be a good neighbour</h2>
        <p>
          Share what is yours to share, treat other people with respect, and don’t use the service for harassment,
          abuse, spam, impersonation, or anything unlawful. We may moderate or remove content that puts the community or
          the service at risk.
        </p>
      </article>
    </Layout>
  )
}
