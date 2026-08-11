import type { Hono } from 'hono'
import { SearchResults } from '../components/search'
import { normalizeSearchQuery } from '../search'
import { currentUser } from '../utils'
import { currentPage, page, redirect } from './shared'

export function registerSearchRoutes(app: Hono) {
  app.get('/search', c => {
    const query = normalizeSearchQuery(c.req.query('q'))
    const requestedTab = c.req.query('tab')
    const tab = requestedTab === 'tags' || requestedTab === 'people' ? requestedTab : 'notes'
    const searchPage = currentPage(c.req.query('page'))
    if (!query && c.req.query('page')) return redirect('/search')
    return page(<SearchResults user={currentUser(c.req.raw)} query={query} page={searchPage} tab={tab} />)
  })
}
