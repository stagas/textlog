import type { Database } from 'bun:sqlite'
import { sessionHash } from './sessions'

export function exportUserData(database: Database, userId: number, currentSession?: string | null) {
  const account = database.query(`SELECT id,handle,email,bio,timezone,recap_emails,interaction_emails,
    show_link_previews,show_moderated_content,hide_people_follow_activity,hide_hashtag_follow_activity,
    show_note_streak,show_timestamps,created_at,email_verified_at,suspended_at
    FROM users WHERE id=?`).get(userId)
  const posts = database.query(`SELECT id,parent_id,body,translation,execution_output,moderation_category,
    moderation_score,created_at,deleted_at
    FROM posts WHERE user_id=? ORDER BY created_at,id`).all(userId) as { id: number }[]
  const hashtags = database.query(`SELECT ph.post_id,ph.tag FROM post_hashtags ph
    JOIN posts p ON p.id=ph.post_id WHERE p.user_id=? ORDER BY ph.post_id,ph.tag`).all(userId) as { post_id: number;
    tag: string }[]
  const mentions = database.query(`SELECT pm.post_id,u.handle FROM post_mentions pm
    JOIN posts p ON p.id=pm.post_id JOIN users u ON u.id=pm.user_id
    WHERE p.user_id=? ORDER BY pm.post_id,u.handle`).all(userId) as { post_id: number; handle: string }[]
  const tagsByPost = new Map<number, string[]>()
  const mentionsByPost = new Map<number, string[]>()
  for (const row of hashtags) tagsByPost.set(row.post_id, [...(tagsByPost.get(row.post_id) || []), row.tag])
  for (const row of mentions) mentionsByPost.set(row.post_id, [...(mentionsByPost.get(row.post_id) || []), row.handle])

  const sessions = database.query(`SELECT token_hash,created_at,expires_at,user_agent FROM sessions
    WHERE user_id=? ORDER BY created_at`).all(userId) as { token_hash: string; created_at: number; expires_at: number;
    user_agent: string }[]
  const currentSessionHash = sessionHash(currentSession)

  return {
    exported_at: new Date().toISOString(),
    account,
    posts: posts.map(post => ({
      ...post,
      hashtags: tagsByPost.get(post.id) || [],
      mentions: mentionsByPost.get(post.id) || [],
    })),
    drafts: database.query(`SELECT id,parent_id,body,created_at,updated_at FROM drafts
      WHERE user_id=? ORDER BY created_at,id`).all(userId),
    bookmarks: database.query(`SELECT pb.post_id,pb.created_at AS bookmarked_at,u.handle AS author,p.body
      FROM post_bookmarks pb JOIN posts p ON p.id=pb.post_id JOIN users u ON u.id=p.user_id
      WHERE pb.user_id=? ORDER BY pb.rowid`).all(userId),
    poll_votes: database.query(`SELECT pv.post_id,pv.option_id,po.label,pv.created_at FROM poll_votes pv
      JOIN poll_options po ON po.id=pv.option_id WHERE pv.user_id=? ORDER BY pv.created_at,pv.post_id`).all(userId),
    post_locations: database.query(`SELECT pl.post_id,pl.query,pl.latitude,pl.longitude,pl.display_name
      FROM post_locations pl JOIN posts p ON p.id=pl.post_id WHERE p.user_id=? ORDER BY pl.post_id`).all(userId),
    following: database.query(`SELECT u.handle,f.created_at FROM follows f JOIN users u ON u.id=f.following_id
      WHERE f.follower_id=? ORDER BY u.handle`).all(userId),
    followers: database.query(`SELECT u.handle,f.created_at FROM follows f JOIN users u ON u.id=f.follower_id
      WHERE f.following_id=? ORDER BY u.handle`).all(userId),
    followed_hashtags: database.query('SELECT tag,created_at FROM hashtag_follows WHERE user_id=? ORDER BY tag')
      .all(userId),
    blocked_accounts: database.query(`SELECT u.handle,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=? ORDER BY u.handle`).all(userId),
    blocked_hashtags: database.query('SELECT tag,created_at FROM blocked_hashtags WHERE user_id=? ORDER BY tag')
      .all(userId),
    reports: database.query(`SELECT id,post_id,reason,status,created_at,resolved_at FROM reports
      WHERE reporter_id=? ORDER BY created_at,id`).all(userId),
    handle_history: database.query(`SELECT handle,created_at FROM handle_history
      WHERE user_id=? ORDER BY created_at,handle`).all(userId),
    api_keys: database.query(`SELECT id,name,created_at,expires_at,last_used_at FROM api_keys
      WHERE user_id=? ORDER BY created_at,id`).all(userId),
    feed_keys: database.query(`SELECT id,name,created_at,expires_at,last_used_at FROM feed_keys
      WHERE user_id=? ORDER BY created_at,id`).all(userId),
    notification_devices: database.query(`SELECT device_id,notify_latest,notify_replies,notify_mentions,
      notify_follows,notify_own_posts,notify_signups,notify_follow_activity,notify_following_notes,
      notify_following_only_to_me,notify_people_follow_activity,notify_hashtag_follow_activity,notify_broadcasts
      FROM push_subscriptions WHERE user_id=? ORDER BY device_id`).all(userId),
    notification_user_agents: database.query(`SELECT user_agent,status,updated_at FROM notification_user_agents
      WHERE user_id=? ORDER BY updated_at,user_agent`).all(userId),
    device_settings: database.query(`SELECT device_id,page_size,density,updated_at FROM device_settings
      WHERE user_id=? ORDER BY updated_at,device_id`).all(userId),
    sessions: sessions.map(({ token_hash, ...session }) => ({ ...session,
      current: token_hash === currentSessionHash })
    ),
  }
}
