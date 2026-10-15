import type { Database } from 'bun:sqlite'

export function canPublishPosts(user: { email_verified_at?: string | null }, environment = Bun.env.NODE_ENV) {
  const effectiveEnvironment = environment || (Bun.env.DEV_RELOAD === 'true' ? 'development' : 'production')
  return effectiveEnvironment === 'development' || Boolean(user.email_verified_at)
}

export const linkPostingValidationMessage = 'Create three notes without links before posting links'

function hasAuthoredLink(body: string) {
  return /(?:https?:\/\/|www\.|[A-Za-z0-9-]+\.[A-Za-z]{2,}|\[[^\]\r\n]+\]\()/u.test(body)
}

/** Links are unlocked by three top-level notes that do not contain links. */
export function canPostLinks(database: Database, userId: number, body: string) {
  // Tags, mentions, and internal post references are rendered as links too, but
  // this onboarding gate is for authored web/Markdown links.
  if (!hasAuthoredLink(body)) return true
  const notes = database.query('SELECT body FROM posts WHERE user_id=? AND parent_id IS NULL')
    .all(userId) as { body: string }[]
  return notes.filter(note => !hasAuthoredLink(note.body)).length >= 3
}
