import type { Database } from 'bun:sqlite'
import type { User } from './db'
import { removeHotActivity } from './hot'

export const ADMIN_EMAILS = new Set([
  'gstagas@gmail.com',
])

export type AdminActionType = 'delete_post' | 'suspend_user' | 'restore_user' | 'delete_user' | 'resolve_report'
  | 'dismiss_report'

export function isAdmin(user: Pick<User, 'email'> | null | undefined) {
  return !!user && ADMIN_EMAILS.has(user.email.trim().toLowerCase())
}

export function isAdminEmail(email: string) {
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}

export function recordAdminAction(database: Database, actorId: number, action: AdminActionType,
  targetUserId: number | null, targetPostId: number | null, note: string)
{
  database.query(`INSERT INTO admin_actions(actor_id,action,target_user_id,target_post_id,note)
    VALUES(?,?,?,?,?)`).run(actorId, action, targetUserId, targetPostId, note.trim().slice(0, 500))
}

export function softDeletePost(database: Database, postId: number) {
  database.query('UPDATE posts SET body=\'(deleted)\',deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL')
    .run(postId)
  removeHotActivity(database, postId)
  database.query('DELETE FROM post_hashtags WHERE post_id=?').run(postId)
  database.query('DELETE FROM post_mentions WHERE post_id=?').run(postId)
}

export function resolvePostReports(database: Database, postId: number, actorId: number) {
  database.query(`UPDATE reports SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by=?
    WHERE post_id=? AND status='open'`).run(actorId, postId)
}

export function anonymizeUser(database: Database, userId: number, actorId?: number) {
  const account = database.query('SELECT handle FROM users WHERE id=?').get(userId) as { handle: string } | null
  const postIds = database.query('SELECT id FROM posts WHERE user_id=?').all(userId) as { id: number }[]
  for (const post of postIds) softDeletePost(database, post.id)
  database.query('DELETE FROM post_hashtags WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)').run(userId)
  database.query('DELETE FROM post_mentions WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)').run(userId)
  database.query('DELETE FROM post_mentions WHERE user_id=?').run(userId)
  database.query('DELETE FROM follows WHERE follower_id=? OR following_id=?').run(userId, userId)
  database.query('DELETE FROM hashtag_follows WHERE user_id=?').run(userId)
  database.query('DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?').run(userId, userId)
  if (actorId) {
    for (const post of postIds) resolvePostReports(database, post.id, actorId)
  }
  database.query('DELETE FROM reports WHERE reporter_id=?').run(userId)
  database.query('DELETE FROM password_resets WHERE user_id=?').run(userId)
  if (database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'email_tokens\'').get()) {
    database.query('DELETE FROM email_tokens WHERE user_id=?').run(userId)
  }
  if (account && database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'handle_history\'').get()) {
    database.query('INSERT OR IGNORE INTO handle_history(handle,user_id) VALUES(?,?)')
      .run(account.handle.toLowerCase(), userId)
  }
  database.query('DELETE FROM sessions WHERE user_id=?').run(userId)
  database.query(`UPDATE users SET handle=?,email=?,bio='',password='!',suspended_at=NULL,deleted_at=CURRENT_TIMESTAMP
    WHERE id=?`).run(`deleted-${userId}`, `deleted-${userId}@textlog.cc`, userId)
}
