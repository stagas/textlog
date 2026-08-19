import type { Hono } from 'hono'
import { Stats } from '../components/pages'
import { databaseService } from '../database-service'
import { currentUser } from '../utils'
import { page } from './shared'

export function registerStatsRoutes(app: Hono) {
  app.get('/stats', async c =>
    page(
      <Stats user={currentUser(c.req.raw)} stats={await databaseService().call('stats.dashboard', {})} />,
    ))
}
