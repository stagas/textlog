import type { User } from '../db'
import { Layout } from './layout'
import { ActionPair } from './page-shared'

type ErrorCopy = { eyebrow: string; title: string; message: string }

const errors: Record<number, ErrorCopy> = {
  400: { eyebrow: 'request error', title: 'We couldn\'t process that request.',
    message: 'Check what you entered and try again.' },
  404: { eyebrow: 'lost textlog', title: 'This page doesn\'t exist.',
    message: 'The link may be outdated, or the page may have moved.' },
  413: { eyebrow: 'request too large', title: 'That request was too large.', message: 'Try again with less content.' },
  415: { eyebrow: 'unsupported request', title: 'We couldn\'t read that request.',
    message: 'Try submitting it again from the original page.' },
  500: { eyebrow: 'server error', title: 'Something went wrong.',
    message: 'The problem is on our side. Please try again in a moment.' },
}

export function ErrorPage({ user, status }: { user: User | null; status: number }) {
  const error = errors[status] || errors[400]
  const displayStatus = status === 404 ? '404' : status >= 500 ? '5xx' : '4xx'
  return (
    <Layout user={user} title={status === 404 ? 'page not found' : error.eyebrow}>
      <section className="not-found status-page" aria-labelledby="status-page-title">
        <p className="not-found-code status-page-code" aria-hidden="true">{displayStatus}</p>
        <div className="not-found-copy status-page-copy">
          <p className="eyebrow">{error.eyebrow}</p>
          <h1 id="status-page-title">{error.title}</h1>
          <p>{error.message}</p>
          <ActionPair className="not-found-actions status-page-actions"
            primary={<a className="button" href="/">browse notes</a>} secondary={<a href="/explore">explore</a>} />
        </div>
      </section>
    </Layout>
  )
}
