export type PostRow = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  created_at: string
  deleted_at: string | null
}

export type ParentPost = Pick<PostRow, 'id' | 'body' | 'created_at' | 'deleted_at'> & {
  handle: string
  reply_count: number
}

export type PostView = PostRow & {
  handle: string
  reply_count?: number
  parent?: ParentPost | null
}

export type ProfileRow = {
  id: number
  handle: string
  email: string
  bio: string
  suspended_at?: string | null
  deleted_at?: string | null
  email_verified_at?: string | null
}

export type SessionView = { token: string; created_at: number; expires_at: number; user_agent: string; current: boolean }

export type DashboardStats = {
  users: number
  suspendedUsers: number
  activePosts: number
  replies: number
  openReports: number
  users24h: number
  users7d: number
  posts24h: number
  posts7d: number
  visitorsToday: number
  visitors7d: number
}

export type AdminReportView = {
  id: number
  reason: string
  status: 'open' | 'resolved' | 'dismissed'
  created_at: string
  resolved_at: string | null
  post_id: number
  post_body: string
  post_deleted_at: string | null
  author_id: number
  author_handle: string
  reporter_handle: string
  resolver_handle: string | null
}

export type AdminActionView = {
  id: number
  action: string
  note: string
  created_at: string
  actor_handle: string
  target_user_id: number | null
  target_handle: string | null
  target_post_id: number | null
}

export type IllegalActivityReportView = {
  id: number; post_id: number; content_url: string; details: string; reporter_email: string | null;
  reporter_name: string | null; reference: string; category: string; status: string;
  resolution_note: string | null; created_at: string; resolved_at: string | null
}
export type PersonView = ProfileRow & {
  posts: number
  following?: boolean
  viewerFollowing?: boolean
}

export type TagView = {
  tag: string
  count: number
  following?: boolean
  viewerFollowing?: boolean
}
