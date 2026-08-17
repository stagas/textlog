import { instance } from '../../instance.config'
import { appName } from '../brand'
import { type User } from '../db'
import { Layout } from './layout'

export function Legal({ user }: { user: User | null }) {
  const name = appName()
  return (
    <Layout user={user} title="legal">
      <article className="static-page legal-page">
        <p className="eyebrow">legal</p>
        <h1 id="terms">Terms, privacy &amp; liability</h1>
        <p className="legal-updated">Last updated: August 17, 2026</p>

        <h2>Your content and conduct</h2>
        <p>
          You keep ownership of content you post. By posting, you give {name}{' '}
          permission to host, display, and distribute that content as needed to operate the service. You are responsible
          for your account, your content, and ensuring that your use of the service follows applicable law and does not
          infringe anyone else’s rights.
        </p>

        <h2>Age requirement</h2>
        <p>
          You must be at least 13 years old to create or use an account. If we learn that an account belongs to someone
          under 13, we may suspend it and delete the associated personal information. A parent or guardian can contact
          us using the <a href="/contact">contact details</a>.
        </p>

        <h2>Service availability</h2>
        <p>
          {name}{' '}
          is provided “as is” and “as available,” without warranties of any kind. We do not promise that the service
          will always be available, secure, accurate, or free of errors. Features may change, and content or accounts
          may be suspended or removed when necessary to operate or protect the service.
        </p>

        <h2>Service communications</h2>
        <p>
          We send essential account, security, and legally required messages. We may also occasionally email account
          holders a recap of new {name} features and popular public notes. Recap emails are optional: you can
          unsubscribe at any time using the link in any recap email or the Recap emails control in account settings,
          and you can subscribe again later.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, {name}{' '}
          and its operators will not be liable for indirect, incidental, special, consequential, or punitive damages, or
          for lost data, profits, goodwill, or other losses resulting from your use of—or inability to use—the service
          or from content posted by others. Nothing here excludes liability that cannot legally be excluded.
        </p>

        <h2 id="privacy">Privacy</h2>
        <h3>Controller and contact</h3>
        <p>
          {instance.operator.name} is the controller and contact for {name}. Contact: {instance.operator.email
            ? <a href={`mailto:${instance.operator.email}`}>{instance.operator.email}</a>
            : 'email not configured'}
          {instance.operator.phone && (
            <>
              , <a href={instance.operator.phone.url}>{instance.operator.phone.display}</a>
            </>
          )}
          {instance.operator.address && <>, {instance.operator.address}</>}.
        </p>

        <h3>Our privacy commitment</h3>
        <p>
          We use your personal information only as reasonably necessary to provide, maintain, secure and support
          {name}, respond to actions or requests you make, and meet our legal obligations. We do not sell or rent your
          personal information, share it for targeted advertising, or use it to build advertising profiles. We do not
          send advertising or third-party promotions. We email you for essential account and security messages,
          actions you request, notices we are required to send, and occasional optional recaps about {name} features
          and popular public notes. Every recap includes an unsubscribe link.
        </p>

        <h3>Data, purposes and legal bases</h3>
        <ul>
          <li>
            Account email, handle, bio, email-verification status and, when enabled, a one-way password hash: to create
            and perform your account contract, authenticate you and provide requested account features. We never store
            your password in readable form.
          </li>
          <li>
            Sign-in sessions, browser information, and short-lived password-reset, email-change and magic-link records
            (including hashed app entry codes): to authenticate you, let you manage signed-in devices and protect your
            account. Secret links, session tokens and app entry codes are stored as hashes rather than in readable form.
          </li>
          <li>
            Theme, accent and font choices: to remember your appearance settings. These are stored only in appearance
            cookies on your device and are not tied to your account in our database. Your page-size and density choices
            are stored with your account and an opaque device identifier so they can apply separately to each device.
          </li>
          <li>
            Posts, replies, follows, followed hashtags, blocks and other activity: to publish and distribute content at
            your request, personalize what you see, provide safety controls and perform the service contract. Public
            content and public connections can be copied or indexed by others; blocks are not public.
          </li>
          <li>
            Reports, moderation records and limited security events: legitimate interests in protecting users and the
            service, and compliance with legal obligations. We balance those interests against affected people’s rights.
          </li>
          <li>
            Daily rotating network-address pseudonyms: legitimate interests in abuse prevention, service security and
            aggregate audience measurement. We do not use them for advertising or cross-day tracking.
          </li>
          <li>
            Email communications and preferences: performance of the service or steps you request, legal obligations
            where a notice requires receipt or decision communication, and our legitimate interest in occasionally
            informing account holders about service features and public community activity. You may object by
            unsubscribing from recap emails at any time without affecting essential account or legal messages.
          </li>
        </ul>

        <h3>Recipients, moderation and transfers</h3>
        <p>
          Authorized operators and infrastructure providers can access data where needed to run and secure the service.
          Our configured email delivery provider processes email addresses and message content to deliver transactional
          email. OpenAI processes text submitted for automated content-safety classification; the classification can
          block publication, but moderation and moderation decisions are not made solely by automated means. These
          providers may process data outside the EEA. Transfers must be covered by an applicable adequacy decision or
          safeguards such as the European Commission’s Standard Contractual Clauses.
        </p>

        <h3>Retention</h3>
        <p>
          Session records expire after 365 days of inactivity; password-reset, magic-link and email-change records after
          one hour; appearance cookies after one year; daily visitor pseudonyms after seven days; and application HTTP
          logs after at most 14 days. Recap-email preferences, unsubscribe tokens, and campaign delivery records are
          retained as needed to honor opt-outs and prevent duplicate delivery. Public account and content data,
          connections, followed hashtags and blocks are
          held until you remove them or delete your account. Deletion anonymizes the account and content, while limited
          moderation, resolved report and audit records are retained for three years where needed to document decisions,
          establish legal claims and protect users. Open reports remain until reviewed. Backups follow the configured
          backup-retention period (14 days by default), after which deleted data ages out.
        </p>

        <h3>Your rights</h3>
        <p>
          Depending on the circumstances, you may request access, correction, erasure, restriction, portability, or
          object to processing based on legitimate interests. Where processing relies on consent, you may withdraw it
          without affecting earlier processing. In account settings you can correct your handle and bio, change your
          email, manage your password and sessions, subscribe or unsubscribe from recap emails, download a JSON copy of
          your account data, and delete your account.
          {instance.operator.email && (
            <>
              You can also email <a href={`mailto:${instance.operator.email}`}>{instance.operator.email}</a>.
            </>
          )}We may need to verify your identity and may retain data where law permits or requires it.
        </p>

        <h3>Complaints</h3>
        <p>
          You may complain to {instance.privacyAuthority
            ? (
              <>
                <a href={instance.privacyAuthority.url} target="_blank" rel="noopener noreferrer">
                  {instance.privacyAuthority.name}
                </a>
                {instance.privacyAuthority.address && <>, {instance.privacyAuthority.address}</>}
              </>
            )
            : 'a competent supervisory authority'}, or another competent supervisory authority, particularly where you
          live or work.
        </p>

        <h3>Required and optional data</h3>
        <p>
          Email is required to create an account, and a handle is required before participating; without them we cannot
          provide those features. Profile text and public activity are optional. Data normally comes from you; public
          interactions and reports about your content come from other users. For privacy questions or content notices,
          use the{' '}
          <a href="/contact">
            contact details
          </a>. We do not sell personal information.
        </p>
        <p>
          For security and aggregate visitor counts, network addresses are converted immediately into keyed pseudonyms;
          raw addresses are not written to application HTTP logs or visitor-count storage. The key is combined with the
          UTC date so identifiers rotate daily, and separate keys are derived for logging and analytics. HTTP logs show
          only the first five characters of the daily pseudonym. Visitor-count records are kept for seven days.
          Application HTTP logs have a maximum retention of 14 days.
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
