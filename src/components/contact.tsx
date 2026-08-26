import { instance } from '../../instance.config'
import { appName } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'

export function Contact({ user }: { user: User | null }) {
  const name = appName()
  return (
    <Layout user={user} title="contact">
      <article className="static-page">
        <p className="eyebrow">contact</p>
        <h1>Say hello.</h1>
        <p>
          Questions, ideas, or just want to say hi? Send a note and we’ll get back to you as soon as we can.
        </p>

        <h2>Collective</h2>
        <p>
          {name} is operated by the {instance.operator.url
            ? (
              <a href={instance.operator.url} target="_blank" rel="noopener noreferrer">
                {instance.operator.name}
              </a>
            )
            : instance.operator.name}, fiscally hosted by {instance.fiscalHost
            ? <a href={instance.fiscalHost.url} target="_blank" rel="noopener noreferrer">{instance.fiscalHost.name}</a>
            : 'our fiscal host'}.
        </p>

        <h2>Email</h2>
        <p>
          {instance.operator.email
            ? <a href={`mailto:${instance.operator.email}`}>{instance.operator.email}</a>
            : 'Contact email is not configured.'}
        </p>

        {instance.operator.phone && (
          <>
            <h2>Phone</h2>
            <p>
              <a href={instance.operator.phone.url}>{instance.operator.phone.display}</a>
            </p>
          </>
        )}

        {instance.operator.address && (
          <>
            <h2>Post</h2>
            <p>
              {instance.operator.name} · {name}
              <br />
              {instance.operator.address}
            </p>
          </>
        )}

        {instance.fiscalHost && (
          <>
            <h2>Legal and financial correspondence</h2>
            <p>
              {instance.fiscalHost.legalName}
              <br />
              Fiscal host of the{' '}
              <a href="https://opencollective.com/textlog" target="_blank" rel="noopener noreferrer">
                {name} collective
              </a>
              <br />
              {instance.fiscalHost.address}
            </p>
          </>
        )}

        {instance.operator.hours && (
          <>
            <h2>Hours</h2>
            <p>{instance.operator.hours}</p>
          </>
        )}

        <h2>Safety</h2>
        <p>
          <a href="/report-illegal-activity">Report illegal activity</a> involving a {name}{' '}
          post. Copyright owners can also review the <a href="/dmca">DMCA notice and counter-notice process</a>.
        </p>
      </article>
    </Layout>
  )
}
