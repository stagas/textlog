import type { Hono } from 'hono'
import { SearchResults } from '../components/search'
import { databaseService } from '../database-service'
import { resolvedPageSize } from '../request-preferences'
import { normalizeSearchQuery } from '../search'
import { currentUser } from '../utils'
import { currentPage, page, redirect } from './shared'

export function registerSearchRoutes(app: Hono) {
  app.get('/search', async c => {
    const query = normalizeSearchQuery(c.req.query('q'))
    const requestedTab = c.req.query('tab')
    const tab = requestedTab === 'tags' || requestedTab === 'people' ? requestedTab : 'notes'
    const searchPage = currentPage(c.req.query('page'))
    if (!query && c.req.query('page')) return redirect('/search')
    const user = currentUser(c.req.raw)
    const results = await databaseService().call('search.results', { query, viewerId: user?.id ?? -1, page: searchPage,
      pageSize: resolvedPageSize(c.req.raw), tab })
    return page(<SearchResults user={user} query={query} page={searchPage} tab={tab} results={results} />)
  })
}
