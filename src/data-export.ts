import type { Database } from 'bun:sqlite'

export function exportUserData(database: Database, userId: number, currentSession?: string | null) {
  const account = database.query(`SELECT id,handle,email,bio,created_at,email_verified_at,suspended_at
    FROM users WHERE id=?`).get(userId)
  const posts = database.query(`SELECT id,parent_id,body,created_at,deleted_at
    FROM posts WHERE user_id=? ORDER BY created_at,id`).all(userId) as { id: number }[]
  const hashtags = database.query(`SELECT ph.post_id,ph.tag FROM post_hashtags ph
    JOIN posts p ON p.id=ph.post_id WHERE p.user_id=? ORDER BY ph.post_id,ph.tag`).all(userId) as
    { post_id: number; tag: string }[]
  const mentions = database.query(`SELECT pm.post_id,u.handle FROM post_mentions pm
    JOIN posts p ON p.id=pm.post_id JOIN users u ON u.id=pm.user_id
    WHERE p.user_id=? ORDER BY pm.post_id,u.handle`).all(userId) as { post_id: number; handle: string }[]
  const tagsByPost = new Map<number, string[]>()
  const mentionsByPost = new Map<number, string[]>()
  for (const row of hashtags) tagsByPost.set(row.post_id, [...(tagsByPost.get(row.post_id) || []), row.tag])
  for (const row of mentions) mentionsByPost.set(row.post_id, [...(mentionsByPost.get(row.post_id) || []), row.handle])

  const sessions = database.query(`SELECT token,created_at,expires_at,user_agent FROM sessions
    WHERE user_id=? ORDER BY created_at`).all(userId) as
    { token: string; created_at: number; expires_at: number; user_agent: string }[]

  return {
    exported_at: new Date().toISOString(),
    account,
    posts: posts.map(post => ({
      ...post,
      hashtags: tagsByPost.get(post.id) || [],
      mentions: mentionsByPost.get(post.id) || [],
    })),
    following: database.query(`SELECT u.handle,f.created_at FROM follows f JOIN users u ON u.id=f.following_id
      WHERE f.follower_id=? ORDER BY u.handle`).all(userId),
    followers: database.query(`SELECT u.handle,f.created_at FROM follows f JOIN users u ON u.id=f.follower_id
      WHERE f.following_id=? ORDER BY u.handle`).all(userId),
    followed_hashtags: database.query('SELECT tag FROM hashtag_follows WHERE user_id=? ORDER BY tag').all(userId),
    blocked_accounts: database.query(`SELECT u.handle,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY u.handle`).all(userId),
    reports: database.query(`SELECT id,post_id,reason,status,created_at,resolved_at FROM reports
      WHERE reporter_id=? ORDER BY created_at,id`).all(userId),
    sessions: sessions.map(({ token, ...session }) => ({ ...session, current: token === currentSession })),
  }
}
