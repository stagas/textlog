export type LinkPreview = { imageUrl: string; imageKey?: string; title?: string; description?: string;
  siteName?: string; imageWidth?: number; imageHeight?: number; mimeType?: string; linkedPostId?: number;
  renderedPostHtml?: string; linkedPostReturnPath?: string;
  linkedPost?: Pick<PostView,
    'id' | 'user_id' | 'parent_id' | 'body' | 'handle' | 'reply_count' | 'thread_locked' | 'poll' | 'execution_output'
      | 'moderation_category' | 'moderation_score'> & {
    parent?: { user_id: number; handle: string } | null
  } }

export type LocationView = { query: string; latitude: number; longitude: number; displayName: string; url: string;
  preview: LinkPreview }

export type PostRow = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  translation?: string | null
  created_at: string
  deleted_at: string | null
  moderation_category?: string | null
  moderation_score?: number | null
  has_latex?: number | null
  has_links?: number | null
  has_code?: number | null
  execution_output?: string | null
  link_previews?: Record<string, LinkPreview>
  location?: LocationView
}

export type PollView = {
  options: Array<{ id: number; label: string; votes: number; selected: boolean; correct?: boolean }>
  kind?: 'poll' | 'quiz'
  totalVotes: number
  expired: boolean
  expiresAt: number | null
  viewerVoted: boolean
  explanation?: string
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
  hashtagTargets?: Record<string, string>
  mentionBios: Record<string, string>
  mentionNoteCounts: Record<string, number>
  mentionProfileStats: Record<string, UserProfileStats>
  mentionFollowing: Record<string, boolean>
  mentionFollowsViewer?: Record<string, boolean>
  linkPreviews: Record<string, LinkPreview>
}

export type ParentPost = Pick<PostRow,
  'id' | 'body' | 'translation' | 'created_at' | 'deleted_at' | 'has_latex' | 'has_links' | 'has_code'
    | 'execution_output' | 'moderation_category' | 'moderation_score'> & {
  handle: string
  mood?: string
  unavailable?: boolean
  parent_id?: number | null
  user_id?: number
  bio?: string
  note_count?: number
  profile_stats?: UserProfileStats
  viewer_following?: boolean
  follows_viewer?: boolean
  blocked_viewer?: boolean
  mention_bios?: Record<string, string>
  mention_note_counts?: Record<string, number>
  mention_profile_stats?: Record<string, UserProfileStats>
  mention_following?: Record<string, boolean>
  mention_follows_viewer?: Record<string, boolean>
  hashtag_counts?: Record<string, number>
  hashtag_follower_counts?: Record<string, number>
  hashtag_following?: Record<string, boolean>
  hashtag_targets?: Record<string, string>
  link_previews?: Record<string, LinkPreview>
  location?: LocationView
  poll?: PollView
  viewer_mentioned?: boolean
  parent?: ParentPost | null
  bio_reference?: BioReferenceData
  reply_count: number
  direct_reply_count?: number
  top_id?: number | null
  thread_locked?: boolean
}

export type PostView = PostRow & {
  handle: string
  mood?: string
  profile_pinned?: number | boolean
  viewer_context?: 'reply' | 'mention'
  viewer_mentioned?: boolean
  bio?: string
  note_count?: number
  profile_stats?: UserProfileStats
  viewer_following?: boolean
  follows_viewer?: boolean
  blocked_viewer?: boolean
  mention_bios?: Record<string, string>
  mention_note_counts?: Record<string, number>
  mention_profile_stats?: Record<string, UserProfileStats>
  mention_following?: Record<string, boolean>
  mention_follows_viewer?: Record<string, boolean>
  hashtag_counts?: Record<string, number>
  hashtag_follower_counts?: Record<string, number>
  hashtag_following?: Record<string, boolean>
  hashtag_targets?: Record<string, string>
  bio_reference?: BioReferenceData
  poll?: PollView
  reply_count?: number
  direct_reply_count?: number
  parent?: ParentPost | null
  thread_locked?: boolean
  feed_ancestor_gap?: boolean
  feed_branch_root?: boolean
  feed_collapsed_preview?: boolean
  viewer_bookmarked?: boolean
  /** This post gates its replies until the viewer participates in the thread. */
  replies_hidden?: boolean
  /** This post is a reply concealed by an ancestor's #HiddenReplies gate. */
  hidden_by_reply_gate?: boolean
}

export type PostFeedPage = { posts: PostView[]; page: number; totalItems: number; totalPages: number;
  forYouUnread?: boolean; toMeUnread?: boolean; forYouCount?: number; toMeCount?: number; latestUnread?: boolean;
  latestCount?: number; unreadPostIds?: number[]; directedUnreadPostIds?: number[]; unreadHref?: string;
  lastUnreadHref?: string; randomSampleSeed?: number }
export type ApiPost = {
  id: number
  top_id: number | null
  body: string
  translation?: string | null
  execution_output?: string | null
  created_at: string
  parent_id: number | null
  reply_count: number
  tags: string[]
  mentions: string[]
  url: string
  api_url: string
  author: { handle: string; url: string; api_url: string }
  link_previews?: Record<string, LinkPreview>
  location?: LocationView | null
  poll?: {
    options: Array<{ id: number; label: string; votes: number | null; selected: boolean; correct?: boolean | null }>
    kind: 'poll' | 'quiz'
    explanation?: string | null
    total_votes: number | null
    expired: boolean
    expires_at: string | null
    viewer_voted: boolean
  } | null
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
export type BookmarksData = { posts: PostView[]; total: number; totalPages: number; highlights: string[] }
export type ExploreData = {
  people: PersonView[]
  tags: TagView[]
  peopleTotal: number
  tagsTotal: number
  profileStats: Record<number, UserProfileStats>
}
export type TagPageData = {
  aliases: Array<{ tag: string; displayName: string | null }>
  displayName: string | null
  following: boolean
  followsViewer: boolean
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
  actorBioReferences?: BioReferenceData
  targetBioReferences?: BioReferenceData
  actorFollowsViewer?: boolean
  targetFollowsViewer?: boolean
  tagFollowerCount?: number
}
export type PersonalizedFeedData = {
  timeline: PersonalizedTimelineRow[]
  page: number
  totalPages: number
  toMeCount: number
  forYouCount: number
  latestCount?: number
  forYouUnread: boolean
  toMeUnread: boolean
  unreadHref?: string
  lastUnreadHref?: string
}

export type ProfileRow = {
  id: number
  handle: string
  email: string
  bio: string
  mood?: string
  created_at?: string
  bio_link_previews?: Record<string, LinkPreview>
  suspended_at?: string | null
  deleted_at?: string | null
  email_verified_at?: string | null
  timezone?: string | null
  recap_emails?: number
  interaction_emails?: number
  show_note_streak?: number
}

export type ProfileOverviewData = {
  profile: ProfileRow
  bioReference: BioReferenceData
  noteCount: number
  replyCount: number
  following: boolean
  followsViewer: boolean
  blocked: boolean
  blockedByProfile: boolean
  followerCount: number
  followingCount: number
  followingTagCount: number
  blockedPeopleCount: number
  blockedTagCount: number
  noteStreakDates: string[]
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
  posts: number
  notesPerUser: number
  averageNotesPerUser: number
  replies: number
  openReports: number
  activeUsersYesterday: number
  dau: number
  mau: number
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
  redditVisitors: number
  redditNewUsers: number
  fourChanVisitors: number
  fourChanNewUsers: number
  hnVisitors: number
  hnNewUsers: number
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
  followsViewer?: boolean
  profileStats?: UserProfileStats
  bioLinkPreviews?: Record<string, LinkPreview>
  bioReference?: BioReferenceData
}

export type TagView = {
  tag: string
  displayName?: string
  count: number
  following?: boolean
  viewerFollowing?: boolean
  followerCount?: number
}
export type User = { id: number; handle: string; email: string; bio: string; suspended_at?: string | null;
  mood?: string; mood_prompt_dismissed_at?: string | null; tag_prompt_completed_at?: string | null;
  people_prompt_completed_at?: string | null; email_verified_at?: string | null; activity_read_at?: string | null;
  handle_chosen_at?: string | null; timezone?: string | null; show_link_previews?: number; recap_emails?: number;
  interaction_emails?: number; show_moderated_content?: number; hide_people_follow_activity?: number;
  hide_hashtag_follow_activity?: number; show_note_streak?: number; show_timestamps?: number; draft_count?: number;
  linked_accounts?: Array<
    { id: number; handle: string; mood?: string | null; handle_chosen_at: string | null; has_unread?: boolean }
  > }

export type DraftView = { id: number; public_id: string; body: string; parent_id: number | null; created_at: string;
  updated_at: string; parent_handle?: string | null; parent?: ParentPost | null }
