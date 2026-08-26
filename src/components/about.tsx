import { instance } from '../../instance.config'
import { appName } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'
import { ActionPair } from './page-shared'

export function AboutContent({ user, embedded = false }: { user: User | null; embedded?: boolean }) {
  const name = appName()
  return (
    <article className={`static-page about-page${embedded ? ' feed-about' : ''}`}>
      <p className="eyebrow">about</p>
      <h1>A quieter place for your thoughts.</h1>
      <p>
        {name}{' '}
        is a simple social text log: write short notes, follow people and hashtags, and join conversations without
        turning every thought into a performance.
      </p>
      <p>
        Notes are limited to 500 characters. The constraint keeps them quick to write and read, making room for one
        thought at a time.
      </p>
      <h2>Small by design</h2>
      <p>
        {name}{' '}
        is built around words: notes, people, hashtags, and conversations. It is intentionally small, straightforward,
        and easy to follow. There are no engagement tricks or pressure to build an audience.
      </p>
      <p>
        Your profile and notes are public. Joining is free, and you can download or delete your account data whenever
        you like. {instance.links.donate && (
          <>
            If you feel like it, you can also{' '}
            <a href={instance.links.donate} target="_blank" rel="noopener noreferrer">donate</a> to support the service.
          </>
        )}
      </p>
      {instance.fiscalHost && (
        <p>
          <a href="https://opencollective.com/textlog" target="_blank" rel="noopener noreferrer">
            {instance.operator.name}
          </a>{' '}
          is fiscally hosted by{' '}
          <a href={instance.fiscalHost.url} target="_blank" rel="noopener noreferrer">
            {instance.fiscalHost.name}
          </a>. Our finances and contributions are publicly visible on{' '}
          <a href="https://opencollective.com" target="_blank" rel="noopener noreferrer">Open Collective</a>.
        </p>
      )}
      <h2>Be a good neighbour</h2>
      <p>
        Share what is yours to share, treat other people with respect, and don’t use the service for harassment, abuse,
        spam, impersonation, or anything unlawful. We may moderate or remove content that puts the community or the
        service at risk.
      </p>
      {!user && (
        <>
          <h2>What's next?</h2>
          <ActionPair className="about-actions"
            primary={<a className="button" href="/enter" rel="nofollow">join the community</a>}
            secondary={<a href={embedded ? '#feed-tabs' : '/hot'}>browse notes</a>} />
        </>
      )}
    </article>
  )
}

export function About({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="about">
      <AboutContent user={user} />
    </Layout>
  )
}
