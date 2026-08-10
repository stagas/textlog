import type { Hono } from 'hono'
import { Stats } from '../components/pages'
import { db } from '../db'
import { dashboardStats } from '../stats'
import { currentUser } from '../utils'
import { page } from './shared'

export function registerStatsRoutes(app: Hono) {
  app.get('/stats', c => page(<Stats user={currentUser(c.req.raw)} stats={dashboardStats(db)} />))
}
