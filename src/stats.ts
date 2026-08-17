import type { Database } from 'bun:sqlite'
import { onlineUserCount } from './sessions'
import type { DashboardStats } from './types'
import { anonymousOnlineCount, visitorStats } from './visitors'

export function dashboardStats(database: Database): DashboardStats {
  const stats = database.query(`SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL) users,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND suspended_at IS NOT NULL) suspendedUsers,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL) activePosts,
    (SELECT coalesce(avg(note_count),0) FROM (
      SELECT count(p.id) note_count,row_number() OVER (ORDER BY count(p.id)) position,count(*) OVER () total
      FROM users u LEFT JOIN posts p ON p.user_id=u.id AND p.deleted_at IS NULL
      WHERE u.deleted_at IS NULL GROUP BY u.id
    ) WHERE position IN ((total+1)/2,(total+2)/2)) notesPerUser,
    (SELECT coalesce(count(p.id)*1.0/nullif(count(DISTINCT u.id),0),0)
      FROM users u LEFT JOIN posts p ON p.user_id=u.id AND p.deleted_at IS NULL
      WHERE u.deleted_at IS NULL) averageNotesPerUser,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND parent_id IS NOT NULL) replies,
    (SELECT count(*) FROM reports WHERE status='open') openReports,
    (SELECT count(DISTINCT activity.user_id) FROM (
      SELECT user_id,created_at FROM posts
      UNION ALL SELECT follower_id,created_at FROM follows
      UNION ALL SELECT blocker_id,created_at FROM blocks
      UNION ALL SELECT reporter_id,created_at FROM reports
    ) activity JOIN users ON users.id=activity.user_id
      WHERE users.deleted_at IS NULL
        AND activity.created_at>=datetime('now','start of day','-1 day')
        AND activity.created_at<datetime('now','start of day')) activeUsersYesterday,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL
      AND created_at>=datetime('now','start of day','-1 day')
      AND created_at<datetime('now','start of day')) usersYesterday,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) users24h,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) users7d,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL
      AND created_at>=datetime('now','start of day','-1 day')
      AND created_at<datetime('now','start of day')) postsYesterday,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) posts24h,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) posts7d`)

  return {
    ...(stats.get() as Omit<DashboardStats,
      'visitorsToday' | 'visitorsYesterday' | 'visitors7d' | 'usersOnline' | 'anonymousOnline'>),
    usersOnline: onlineUserCount(database),
    anonymousOnline: anonymousOnlineCount(database),
    ...visitorStats(database),
  }
}
