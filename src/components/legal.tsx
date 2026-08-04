import { type User } from '../db'
import { Layout } from './layout'

export function Legal({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="legal">
      <article className="static-page">
        <p className="eyebrow">legal</p>
        <h1>Terms, privacy &amp; liability</h1>
        <p className="legal-updated">Last updated: August 4, 2026</p>

        <h2>Your content and conduct</h2>
        <p>
          You keep ownership of content you post. By posting, you give root.mx permission to host, display, and
          distribute that content as needed to operate the service. You are responsible for your account, your content,
          and ensuring that your use of the service follows applicable law and does not infringe anyone else’s rights.
        </p>

        <h2>Service availability</h2>
        <p>
          root.mx is provided “as is” and “as available,” without warranties of any kind. We do not promise that the
          service will always be available, secure, accurate, or free of errors. Features may change, and content or
          accounts may be suspended or removed when necessary to operate or protect the service.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, root.mx and its operators will not be liable for indirect, incidental,
          special, consequential, or punitive damages, or for lost data, profits, goodwill, or other losses resulting
          from your use of—or inability to use—the service or from content posted by others. Nothing here excludes
          liability that cannot legally be excluded.
        </p>

        <h2>Privacy</h2>
        <p>
          We process account details, posts, and basic technical information needed to provide, secure, and improve the
          service. Public posts, handles, and profiles can be seen by anyone. Do not post sensitive information you want
          to keep private. We do not sell your personal information.
        </p>
        <p>
          For security and aggregate visitor counts, network addresses are converted immediately into keyed pseudonyms;
          raw addresses are not written to application HTTP logs or visitor-count storage. The key is combined with the
          UTC date so identifiers rotate daily, and separate keys are derived for logging and analytics. HTTP logs show
          only the first five characters of the daily pseudonym. Visitor-count records are kept for seven days. Application
          HTTP logs have a maximum retention of 14 days.
        </p>

        <h2>Changes</h2>
        <p>
          These terms may be updated as the service evolves. Continued use after an update means you accept the revised
          terms. If you do not agree with these terms, please stop using the service.
        </p>
      </article>
    </Layout>
  )
}
