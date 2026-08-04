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
