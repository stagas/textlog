import type { User } from '../types'
import type { SearchResultsData } from '../types'
import { Layout } from './layout'
import { ConnectionPeople, Pagination, TagChips } from './page-shared'
import { FeedThreads } from './post'

export type SearchTab = 'notes' | 'tags' | 'people'

export function searchPostReturnPath(query: string, page: number, postId: number) {
  const pageParameter = page > 1 ? `&page=${page}` : ''
  return `/search?q=${encodeURIComponent(query)}${pageParameter}#post-${postId}`
}

export function searchPersonReturnPath(query: string, page: number, personId: number) {
  const pageParameter = page > 1 ? `&page=${page}` : ''
  return `/search?q=${encodeURIComponent(query)}&tab=people${pageParameter}#person-${personId}`
}

export function SearchForm({ query = '', autoFocus = false, tab = 'notes', placeholder }: {
  query?: string
  autoFocus?: boolean
  tab?: SearchTab
  placeholder?: string
}) {
  return (
    <form className="search-form" method="get" action="/search" role="search">
      <label className="visually-hidden" htmlFor="search-query">Search {tab}</label>
      {tab !== 'notes' && <input type="hidden" name="tab" value={tab} />}
      <input id="search-query" type="search" name="q" maxLength={100} required defaultValue={query}
        placeholder={placeholder ?? `search ${tab}`} autoFocus={autoFocus} autoComplete="off" inputMode="search"
        enterKeyHint="search" />
      <button className="button">search</button>
    </form>
  )
}

export function SearchResults({ user, query, page, tab = 'notes', results }: {
  user: User | null
  query: string
  page: number
  tab?: SearchTab
  results: SearchResultsData
}) {
  const queryParameter = query ? `?q=${encodeURIComponent(query)}` : ''
  const tabPath = (value: SearchTab) => `/search${queryParameter}${queryParameter ? '&' : '?'}tab=${value}`
  const paginationPath = `/search?q=${encodeURIComponent(query)}${tab === 'notes' ? '' : `&tab=${tab}`}`
  return (
    <Layout user={user} title={query ? `search: ${query}` : 'search'}>
      <section className="search-header">
        <h1>Search {tab}</h1>
        <SearchForm query={query} autoFocus={!query} tab={tab} />
      </section>
      <nav className="feed-tabs search-tabs" aria-label="Search type">
        {(['notes', 'tags', 'people'] as SearchTab[]).map(value => (
          <a key={value} href={tabPath(value)} className={tab === value ? 'active' : ''}
            aria-current={tab === value ? 'page' : undefined}
          >
            {results.totals[value].toLocaleString()} {value}
          </a>
        ))}
      </nav>
      <Pagination page={page} totalPages={results.totalPages} path={paginationPath} top />
      <FeedThreads posts={results.posts} user={user}
        returnPath={`/search?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`}
        highlightTerms={results.highlights} />
      {!!results.tags.length && (
        <TagChips user={user} tags={results.tags} followingKey="viewerFollowing" highlightTerms={results.highlights}
          returnPath={`/search?q=${encodeURIComponent(query)}&tab=tags${page > 1 ? `&page=${page}` : ''}`} />
      )}
      {!!results.people.length && (
        <ConnectionPeople user={user} people={results.people} className="search-people"
          highlightTerms={results.highlights} returnPath={person => searchPersonReturnPath(query, page, person.id)} />
      )}
      {query && !results[tab === 'notes' ? 'posts' : tab].length && <div className="empty">No matching {tab}.</div>}
      <Pagination page={page} totalPages={results.totalPages} path={paginationPath} />
    </Layout>
  )
}
