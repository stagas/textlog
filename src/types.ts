export type LinkPreview = { imageUrl: string; imageKey?: string; title?: string; description?: string; siteName?: string;
  imageWidth?: number; imageHeight?: number }

export type PostRow = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  created_at: string
  deleted_at: string | null
  has_latex?: number | null
  has_links?: number | null
  has_code?: number | null
  link_previews?: Record<string, LinkPreview>
}

export type UserProfileStats = {
  notes: number
  replies: number
  followers: number
  following: number
  followingTags: number
}

export type BioReferenceData = {
  hashtagCounts: Record<string, number>
  hashtagFollowerCounts: Record<string, number>
  hashtagFollowing: Record<string, boolean>
  mentionBios: Record<string, string>
  mentionNoteCounts: Record<string, number>
  mentionProfileStats: Record<string, UserProfileStats>
  mentionFollowing: Record<string, boolean>
  linkPreviews: Record<string, LinkPreview>
}

export type ParentPost = Pick<PostRow,
  'id' | 'body' | 'created_at' | 'deleted_at' | 'has_latex' | 'has_links' | 'has_code'> & {
  handle: string
  user_id?: number
  bio?: string
  note_count?: number
  profile_stats?: UserProfileStats
  viewer_following?: boolean
  mention_bios?: Record<string, string>
  mention_note_counts?: Record<string, number>
  mention_profile_stats?: Record<string, UserProfileStats>
  mention_following?: Record<string, boolean>
  hashtag_counts?: Record<string, number>
  hashtag_follower_counts?: Record<string, number>
  hashtag_following?: Record<string, boolean>
  link_previews?: Record<string, LinkPreview>
  bio_reference?: BioReferenceData
  reply_count: number
}

export type PostView = PostRow & {
  handle: string
  bio?: string
  note_count?: number
  profile_stats?: UserProfileStats
  viewer_following?: boolean
  mention_bios?: Record<string, string>
  mention_note_counts?: Record<string, number>
  mention_profile_stats?: Record<string, UserProfileStats>
  mention_following?: Record<string, boolean>
  hashtag_counts?: Record<string, number>
  hashtag_follower_counts?: Record<string, number>
  hashtag_following?: Record<string, boolean>
  bio_reference?: BioReferenceData
  reply_count?: number
  parent?: ParentPost | null
}

export type PostFeedPage = { posts: PostView[]; page: number; totalItems: number; totalPages: number;
  forYouUnread?: boolean; toMeUnread?: boolean }
export type ApiPost = {
  id: number; top_id: number | null; body: string; created_at: string; parent_id: number | null; reply_count: number
  tags: string[]; mentions: string[]; url: string; api_url: string
  author: { handle: string; url: string; api_url: string }
  parent?: ApiPost | null
}
export type SearchResultsData = {
  totals: { notes: number; tags: number; people: number }
  posts: PostView[]
  tags: TagView[]
  people: PersonView[]
  highlights: string[]
  totalPages: number
}
export type ExploreData = {
  people: PersonView[]
  tags: TagView[]
  peopleTotal: number
  tagsTotal: number
  profileStats: Record<number, UserProfileStats>
}
export type TagPageData = {
  following: boolean
  blocked: boolean
  posts: PostView[]
  total: number
  followerTotal: number
  people: PersonView[]
}
export type EmbedData = { posts: PostView[]; title: string; href: string; canonicalHandle?: string }
export type PersonalizedTimelineRow = PostView & {
  activity_kind: 'post' | 'reply' | 'mention' | 'user_follow' | 'tag_follow' | 'signup'
  event_key: string
  actor_id: number
  actor_handle: string
  actor_bio: string
  target_handle: string | null
  target_tag: string | null
  target_bio: string | null
  following: boolean
  target_is_viewer: boolean
  targeted_to_viewer: boolean
  posts: number | null
  unread: number
  renderedPost?: PostView
  actorProfileStats?: UserProfileStats
  targetProfileStats?: UserProfileStats
  tagFollowerCount?: number
}
export type PersonalizedFeedData = {
  timeline: PersonalizedTimelineRow[]
  page: number
  totalPages: number
  toMeCount: number
  forYouUnread: boolean
  toMeUnread: boolean
  unreadHref?: string
}

export type ProfileRow = {
  id: number
  handle: string
  email: string
  bio: string
  bio_link_previews?: Record<string, LinkPreview>
  suspended_at?: string | null
  deleted_at?: string | null
  email_verified_at?: string | null
  is_bot?: number
  bot_managed?: number
  timezone?: string | null
  recap_emails?: number
}

export type ProfileOverviewData = {
  profile: ProfileRow
  bioReference: BioReferenceData
  noteCount: number
  replyCount: number
  following: boolean
  blocked: boolean
  blockedByProfile: boolean
  followerCount: number
  followingCount: number
  followingTagCount: number
  blockedPeopleCount: number
  blockedTagCount: number
}

export type SessionView = { token: string; created_at: number; expires_at: number; user_agent: string;
  current: boolean }

export type ApiKeyView = { id: number; name: string; created_at: number; expires_at: number | null;
  last_used_at: number | null }
export type FeedKeyView = ApiKeyView

export type DashboardStats = {
  users: number
  usersOnline: number
  anonymousOnline: number
  suspendedUsers: number
  activePosts: number
  notesPerUser: number
  averageNotesPerUser: number
  replies: number
  openReports: number
  activeUsersYesterday: number
  activeUsers24h: number
  activatedNewUsersYesterday: number
  usersYesterday: number
  users24h: number
  users7d: number
  posts24h: number
  postsYesterday: number
  posts7d: number
  visitorsToday: number
  visitorsYesterday: number
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
  id: number
  post_id: number
  content_url: string
  details: string
  reporter_email: string | null
  reporter_name: string | null
  reference: string
  category: string
  status: string
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
}
export type PersonView = ProfileRow & {
  posts: number
  following?: boolean
  viewerFollowing?: boolean
  profileStats?: UserProfileStats
}

export type TagView = {
  tag: string
  count: number
  following?: boolean
  viewerFollowing?: boolean
  followerCount?: number
}
export type User = { id: number; handle: string; email: string; bio: string; suspended_at?: string | null;
  email_verified_at?: string | null; activity_read_at?: string | null; handle_chosen_at?: string | null;
  is_bot?: number; bot_managed?: number; timezone?: string | null; show_link_previews?: number; recap_emails?: number }
