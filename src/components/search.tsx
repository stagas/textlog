import type { User } from '../db'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import { searchPosts, searchTerms } from '../search'
import { db } from '../db'
import { Layout } from './layout'
import { Pagination } from './page-shared'
import { Post } from './post'

export function SearchForm({ query = '', autoFocus = false }: { query?: string; autoFocus?: boolean }) {
  return (
    <form className="search-form" method="get" action="/search" role="search">
      <label className="visually-hidden" htmlFor="search-notes">Search notes</label>
      <input id="search-notes" type="search" name="q" maxLength={100} required defaultValue={query}
        placeholder="search notes" autoFocus={autoFocus} />
      <button className="button">search</button>
    </form>
  )
}

export function SearchResults({ user, query, page }: { user: User | null; query: string; page: number }) {
  const result = searchPosts(db, query, user?.id ?? -1, page)
  const posts = enrichPosts(db, result.rows, user?.id ?? -1)
  const highlights = searchTerms(query)
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  return (
    <Layout user={user} title={query ? `search: ${query}` : 'search'}>
      <section className="search-header">
        <h1>Search notes</h1>
        <SearchForm query={query} autoFocus={!query} />
      </section>
      {query && (
        <p className="search-summary">{result.total} {result.total === 1 ? 'result' : 'results'} for “{query}”</p>
      )}
      {posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount highlightTerms={highlights} />)}
      {query && !posts.length && <div className="empty">No matching notes.</div>}
      <Pagination page={page} totalPages={totalPages} path={`/search?q=${encodeURIComponent(query)}`} />
    </Layout>
  )
}
