import React from 'react'
import type { BookmarksData, User } from '../types'
import { Layout } from './layout'
import { Pagination } from './page-shared'
import { Post } from './post'

export function Bookmarks({ user, query, page, data }: {
  user: User
  query: string
  page: number
  data: BookmarksData
}) {
  const path = `/bookmarks${query ? `?q=${encodeURIComponent(query)}` : ''}`
  const returnPath = `${path}${page > 1 ? `${query ? '&' : '?'}page=${page}` : ''}`
  return (
    <Layout user={user} title="bookmarks">
      <section className="search-header bookmarks-header">
        <h1>Bookmarks</h1>
        <form className="search-form" method="get" action="/bookmarks" role="search">
          <label className="visually-hidden" htmlFor="bookmark-search-query">Search bookmarks</label>
          <input id="bookmark-search-query" type="search" name="q" maxLength={100} defaultValue={query}
            placeholder="search bookmarks" autoFocus={false} autoComplete="off" inputMode="search"
            enterKeyHint="search" />
          <button className="button">search</button>
        </form>
      </section>
      <Pagination page={page} totalPages={data.totalPages} path={path} top />
      <div className="bookmarks-list">
        {data.posts.map(post => (
          <Post key={post.id} p={post} user={user} showReplyAction={false} showReadAction={false} tappable
            returnPath={returnPath} highlightTerms={data.highlights} />
        ))}
      </div>
      {!data.posts.length && <div className="empty">{query ? 'No matching bookmarks.' : 'No bookmarks yet.'}</div>}
      <Pagination page={page} totalPages={data.totalPages} path={path} />
    </Layout>
  )
}
