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
        <p>
          <a href="mailto:hello@textlog.cc">hello@textlog.cc</a>
        </p>

        <h2>Phone</h2>
        <p>
          <a href="tel:+306946600152">+30 694 660 0152</a>
        </p>

        <h2>Post</h2>
        <p>
          Georgios Stagakis · textlog<br />
          Kallikratis, Crete, Greece 730 11
        </p>

        <h2>Hours</h2>
        <p>Monday–Friday, 10:00–17:00 EEST</p>

        <h2>Safety</h2>
        <p>
          <a href="/report-illegal-activity">Report illegal activity</a>{' '}
          involving a textlog post. Copyright owners can also review the{' '}
          <a href="/dmca">DMCA notice and counter-notice process</a>.
        </p>
      </article>
    </Layout>
  )
}
