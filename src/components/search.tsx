import type { User } from '../db'
import { db } from '../db'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import { searchPeople, searchPosts, searchTags, searchTerms } from '../search'
import { Layout } from './layout'
import { ConnectionPeople, Pagination, TagPeopleList } from './page-shared'
import { Post } from './post'

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
        placeholder={placeholder ?? `search ${tab}`} autoFocus={autoFocus} />
      <button className="button">search</button>
    </form>
  )
}

export function SearchResults({ user, query, page, tab = 'notes' }: {
  user: User | null
  query: string
  page: number
  tab?: SearchTab
}) {
  const viewerId = user?.id ?? -1
  const results = {
    notes: searchPosts(db, query, viewerId, tab === 'notes' ? page : 1),
    tags: searchTags(db, query, viewerId, tab === 'tags' ? page : 1),
    people: searchPeople(db, query, viewerId, tab === 'people' ? page : 1),
  }
  const result = results[tab]
  const posts = tab === 'notes' ? enrichPosts(db, result.rows as ReturnType<typeof searchPosts>['rows'], viewerId) : []
  const people = tab === 'people' ? result.rows as ReturnType<typeof searchPeople>['rows'] : []
  const tags = tab === 'tags' ? result.rows as ReturnType<typeof searchTags>['rows'] : []
  const highlights = searchTerms(query)
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const queryParameter = query ? `?q=${encodeURIComponent(query)}` : ''
  const tabPath = (value: SearchTab) => `/search${queryParameter}${queryParameter ? '&' : '?'}tab=${value}`
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
            {results[value].total} {value}
          </a>
        ))}
      </nav>
      {posts.map(post => (
        <Post key={post.id} p={post} user={user} showReplyCount highlightTerms={highlights}
          returnPath={searchPostReturnPath(query, page, post.id)} />
      ))}
      {!!tags.length && (
        <TagPeopleList user={user} tags={tags} followingKey="viewerFollowing" highlightTerms={highlights} />
      )}
      {!!people.length && (
        <ConnectionPeople user={user} people={people} className="search-people" highlightTerms={highlights}
          returnPath={person => searchPersonReturnPath(query, page, person.id)} />
      )}
      {query && !result.rows.length && <div className="empty">No matching {tab}.</div>}
      <Pagination page={page} totalPages={totalPages}
        path={`/search?q=${encodeURIComponent(query)}${tab === 'notes' ? '' : `&tab=${tab}`}`} />
    </Layout>
  )
}
