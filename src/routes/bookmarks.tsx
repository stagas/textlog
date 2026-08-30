import type { Hono } from 'hono'
import { Bookmarks } from '../components/bookmarks'
import { databaseService } from '../database-service'
import { resolvedPageSize } from '../request-preferences'
import { normalizeSearchQuery } from '../search'
import { currentUser } from '../utils'
import { currentPage, page, redirect } from './shared'

export function registerBookmarksRoutes(app: Hono) {
  app.get('/bookmarks', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/bookmarks'))
    const query = normalizeSearchQuery(c.req.query('q'))
    const bookmarksPage = currentPage(c.req.query('page'))
    const data = await databaseService().call('bookmarks.page', {
      userId: user.id,
      query,
      page: bookmarksPage,
      pageSize: resolvedPageSize(c.req.raw),
    })
    return page(<Bookmarks user={user} query={query} page={bookmarksPage} data={data} />)
  })
}
