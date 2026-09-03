import articleMarkdown from '../assets/building-textlog-without-javascript.md' with { type: 'text' }
import { appName } from '../brand'
import { sanitizedMarkdownHtml } from '../markdown'
import type { User } from '../types'
import { Layout } from './layout'
import { ActionPair } from './page-shared'

const title = 'Building textlog without JavaScript'
const description =
  'How textlog uses server-rendered React, plain HTML, forms and URLs to build a quiet social web app.'
const articleHtml = sanitizedMarkdownHtml(articleMarkdown, { highlightCode: true })

export function BlogBuildingWithoutJavascript({ user, pageUrl }: { user: User | null; pageUrl: string }) {
  const name = appName()
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} social={{
      title: `${title} · ${name}`,
      description,
      image: new URL('/og.png?v=2', pageUrl).href,
      url: pageUrl,
      type: 'article',
      imageAlt: name,
    }}>
      <article className="static-page blog-article">
        <div className="blog-article-copy" dangerouslySetInnerHTML={{ __html: articleHtml }} />
        {!user && (
          <>
            <h2>Curious how this looks?</h2>
            <ActionPair className="about-actions"
              primary={<a className="button" href="/enter" rel="nofollow">join the community</a>}
              secondary={<a href="/hot">browse notes</a>} />
          </>
        )}
      </article>
    </Layout>
  )
}
