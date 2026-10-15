import { postContentFlags } from './content'
import type { Database } from 'bun:sqlite'

export function canPublishPosts(user: { email_verified_at?: string | null }, environment = Bun.env.NODE_ENV) {
  const effectiveEnvironment = environment || (Bun.env.DEV_RELOAD === 'true' ? 'development' : 'production')
  return effectiveEnvironment === 'development' || Boolean(user.email_verified_at)
}

export const linkPostingValidationMessage = 'Create three notes without links before posting links'

/** Links are unlocked by three top-level notes that do not contain links. */
export function canPostLinks(database: Database, userId: number, body: string) {
  if (!postContentFlags(body).has_links) return true
  const completed = database.query(`SELECT count(*) count FROM posts
    WHERE user_id=? AND parent_id IS NULL AND has_links=0`).get(userId) as { count: number }
  return completed.count >= 3
}
