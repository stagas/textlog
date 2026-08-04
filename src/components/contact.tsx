import { type User } from '../db'
import { Layout } from './layout'

export function Contact({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="contact">
      <article className="static-page">
        <p className="eyebrow">contact</p>
        <h1>Say hello.</h1>
        <p>
          Questions, ideas, or just want to say hi? Send a note and we’ll get back to you as soon as we can.
        </p>

        <h2>Email</h2>
        <p><a href="mailto:hello@root.mx">hello@root.mx</a></p>

        <h2>Post</h2>
        <p>
          root.mx<br />
          42 Quiet Street<br />
          Athens 105 58, Greece
        </p>

        <h2>Hours</h2>
        <p>Monday–Friday, 10:00–17:00 EEST</p>
      </article>
    </Layout>
  )
}
