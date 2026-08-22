import type { DensityChoice, PageSizeChoice } from './request-preferences'
import type { ApiKeyView, ApiPost, BioReferenceData, DashboardStats, DraftView, EmbedData, ExploreData, FeedKeyView, LinkPreview,
  PersonalizedFeedData, PersonView, PostFeedPage, PostView, ProfileOverviewData, SearchResultsData, SessionView,
  TagPageData, User } from './types'
import type { AdminActionView, AdminReportView, IllegalActivityReportView, PostRow, ProfileRow } from './types'

export type DatabaseHealthResult = {
  writeLockLatencyMs: number
  walBytes: number
  busyTimeoutMs: number
}

export type SerializedDomainResponse = {
  status: number
  headers: [string, string][]
  body: string
}

export type DatabaseDomainOperations = {
  'system.health': { input: { databasePath: string }; output: DatabaseHealthResult }
  'system.blockedIps': { input: { day: string }; output: string[] }
  'system.consumeAuthAttempt': {
    input: { scope: string; identity: string; attempts: number; windowSeconds: number; now: number }
    output: { retryAfter: number } | null
  }
  'system.consumeBucketedAttempt': {
    input: { scope: string; identity: string; attempts: number; bucketSeconds: number; now: number }
    output: { retryAfter: number } | null
  }
  'maintenance.flushVisitors': {
    input: { visits: Array<{ day: string; hash: string; anonymousLastSeenAt: number | null }> }
    output: number
  }
  'maintenance.flushIpRequests': { input: { entries: Array<{ day: string; hash: string; requests: number }> };
    output: number }
  'maintenance.cleanup': { input: { now: number }; output: Record<string, number> }
  'maintenance.bootBackup': { input: { directory: string }; output: string }
  'maintenance.automatedBackup': { input: { directory: string; now: string }; output: unknown }
  'maintenance.publicArchive': { input: { path: string; now: string }; output: unknown | null }
  'maintenance.recapPreview': { input: { requestUrl: string }; output: string }
  'blog.recapPosts': { input: { viewerId: number }; output: PostView[] }
  'auth.sessionUser': { input: { token: string | null }; output: User | null }
  'auth.apiUser': { input: { token: string | null; now: number }; output: User | null }
  'auth.resolve': {
    input: { sessionToken: string | null; bearerToken: string | null; deviceId: string | null; now: number }
    output: { sessionUser: User | null; apiUser: User | null;
      preferences: { pageSize: PageSizeChoice; density: DensityChoice } }
  }
  'auth.renewSession': { input: { token: string; now: number }; output: boolean }
  'auth.storeMagicLink': {
    input: { tokenHash: string; codeHash: string; email: string; userId: number | null; nextPath: string;
      expiresAt: number; now: number }
    output: null
  }
  'auth.deleteMagicLink': { input: { tokenHash: string }; output: null }
  'auth.consumeMagicLink': {
    input: { selector: { tokenHash: string } | { email: string; codeHash: string }; userAgent: string; now: number;
      currentUserId?: number }
    output: { status: 'invalid' } | { status: 'unavailable' } | { status: 'ready'; session: string;
      destination: string }
  }
  'auth.preparePasswordReset': {
    input: { identifier: string; isEmail: boolean; tokenHash: string; expiresAt: number; now: number }
    output: { email: string } | null
  }
  'auth.deletePasswordReset': { input: { tokenHash: string }; output: null }
  'auth.passwordResetValid': { input: { tokenHash: string; now: number }; output: boolean }
  'auth.consumePasswordReset': { input: { tokenHash: string; passwordHash: string; now: number }; output: boolean }
  'auth.logout': { input: { tokenHash: string }; output: null }
  'auth.accountForIdentifier': { input: { identifier: string; isEmail: boolean }; output: {
    id: number
    email: string
    handle: string
    password: string
    handleChosenAt: string | null
  } | null }
  'auth.completePasswordLogin': {
    input: { userId: number; replacementPasswordHash: string | null; userAgent: string; now: number }
    output: { session: string }
  }
  'auth.passwordLoginChallenge': { input: { address: string; now: number; forceCaptcha?: boolean }; output: {
    nonce: string
    captcha?: { token: string; image: string }
  } }
  'auth.validatePasswordLoginForm': {
    input: { address: string; nonce: string; captchaToken: string; captchaAnswer: string; now: number }
    output: { status: 'ready' | 'invalid_nonce' | 'invalid_captcha' }
  }
  'auth.recordFailedPassword': { input: { now: number }; output: boolean }
  'auth.claimInitialHandle': { input: { userId: number; handle: string };
    output: { status: 'ready' } | { status: 'monthly_limit' } | { status: 'unavailable' } }
  'account.timezone': { input: { userId: number }; output: string | null }
  'account.choices': { input: { userId: number }; output: Array<{
    id: number
    handle: string
    handle_chosen_at: string | null
    primary: boolean
    selected: boolean
  }> }
  'account.select': { input: { userId: number; targetId: number; sessionHash: string };
    output: { status: 'not_found' } | { status: 'ready'; handleChosen: boolean } }
  'account.createLinked': { input: { userId: number; sessionHash: string }; output: boolean }
  'account.pushPreferences': { input: { userId: number; endpoint: string; includeSignups: boolean };
    output: Record<string, number> | null }
  'account.savePushSubscription': {
    input: { userId: number; endpoint: string; p256dh: string; auth: string; deviceId: string; userAgent: string | null;
      preferencesProvided: boolean; preferences: Record<string, number | null> }
    output: null
  }
  'account.removePushSubscription': { input: { userId: number; endpoint: string; userAgent: string | null };
    output: { active: boolean } }
  'account.passwordHash': { input: { userId: number }; output: string | null }
  'account.storePasswordEnableToken': {
    input: { userId: number; email: string; tokenHash: string; expiresAt: number; now: number }
    output: boolean
  }
  'account.passwordEnableTokenValid': { input: { tokenHash: string; now: number }; output: boolean }
  'account.deletePasswordEnableToken': { input: { tokenHash: string }; output: null }
  'account.consumePasswordEnableToken': { input: { tokenHash: string; passwordHash: string; now: number };
    output: boolean }
  'account.changePassword': { input: { userId: number; passwordHash: string; currentSessionHash: string | null };
    output: null }
  'account.updateProfile': { input: { userId: number; handle: string; bio: string; timezone: string };
    output: { status: 'ready' | 'unavailable' } }
  'account.export': { input: { userId: number; currentSession: string | null }; output: unknown }
  'account.emailChangeReadiness': { input: { userId: number; email: string };
    output: { status: 'unavailable' } | { status: 'ready'; passwordHash: string } }
  'account.storeEmailChangeAuthorization': {
    input: { userId: number; currentEmail: string; newEmail: string; tokenHash: string; expiresAt: number; now: number }
    output: null
  }
  'account.emailChangeAuthorization': { input: { tokenHash: string; now: number };
    output: { userId: number; newEmail: string } | null }
  'account.deleteEmailChangeAuthorization': { input: { userId: number }; output: null }
  'account.emailToken': { input: { tokenHash: string; now: number };
    output: { userId: number; kind: 'verify' | 'change'; email: string } | null }
  'account.confirmEmailToken': { input: { value: string; now: number };
    output: { ok: true; kind: 'verify' | 'change' } | { ok: false; reason: 'invalid' | 'email_unavailable' } }
  'account.deletionInfo': { input: { selector: { userId: number } | { tokenHash: string }; now: number };
    output: { id: number; handle: string; email: string; passwordHash: string; primary: boolean } | null }
  'account.storeDeletionToken': {
    input: { userId: number; email: string; tokenHash: string; expiresAt: number; now: number }
    output: null
  }
  'account.deleteDeletionToken': { input: { tokenHash: string }; output: null }
  'account.delete': { input: { userId: number }; output: { imageKeys: string[] } }
  'admin.dashboard': { input: { status: 'open' | 'resolved' | 'dismissed'; page: number }; output: {
    stats: DashboardStats
    total: number
    reports: AdminReportView[]
    actions: AdminActionView[]
    suspended: ProfileRow[]
    illegalReports: IllegalActivityReportView[]
    ipRequests: Array<{ hash: string; obfuscated: string; requests: number; blocked: boolean }>
  } }
  'admin.blockIp': { input: { day: string; hash: string; actorId: number }; output: boolean }
  'admin.decideIllegalReport': { input: { id: number; decision: 'resolve' | 'dismiss'; reasons: string };
    output: { status: 'not_open' } | { status: 'ready'; reference: string; reporterEmail: string | null } }
  'admin.decideReport': { input: { id: number; decision: 'resolve' | 'dismiss'; actorId: number; note: string };
    output: boolean }
  'admin.post': { input: { id: number }; output: (PostRow & { handle: string }) | null }
  'admin.deletePost': { input: { id: number; actorId: number; note: string };
    output: { status: 'not_found' } | { status: 'ready'; imageKeys: string[] } }
  'admin.user': { input: { id: number }; output: ProfileRow | null }
  'admin.moderateUser': {
    input: { id: number; actorId: number; action: 'suspend' | 'restore' | 'delete';
      note: string }
    output: { status: 'not_found' | 'already_suspended' | 'not_suspended' } | { status: 'ready';
      imageKeys: string[] }
  }
  'account.securityData': { input: { userId: number; currentSessionHash: string | null; now: number }; output: {
    sessions: SessionView[]
    apiKeys: ApiKeyView[]
    feedKeys: FeedKeyView[]
    passwordEnabled: boolean
  } }
  'account.issueKey': {
    input: { kind: 'api' | 'feed'; userId: number; name: string; expiresAt: number | null; now: number }
    output: { value: string } | null
  }
  'account.revokeKey': { input: { kind: 'api' | 'feed'; userId: number; id: number }; output: null }
  'account.revokeSession': { input: { userId: number; tokenHash: string; currentSessionHash: string | null };
    output: null }
  'account.revokeOtherSessions': { input: { userId: number; currentSessionHash: string | null }; output: null }
  'account.storeEmailToken': {
    input: { tokenHash: string; userId: number; kind: 'change'; email: string; expiresAt: number }
    output: null
  }
  'account.deleteEmailToken': { input: { tokenHash: string }; output: null }
  'account.saveAppearancePreferences': {
    input: { userId: number; deviceId: string; pageSize: PageSizeChoice; density: DensityChoice;
      showLinkPreviews: boolean }
    output: null
  }
  'account.updateProfileFlags': { input: { userId: number; timezone: string }; output: null }
  'account.editSettings': { input: { userId: number }; output: {
    timezone: string
    recapEmails: number
  } | null }
  'account.recapStatus': { input: { userId?: number; token?: string }; output: {
    id: number
    subscribed: boolean
  } | null }
  'account.setRecapPreference': { input: { userId?: number; token?: string; subscribed: boolean }; output: boolean }
  'stats.dashboard': { input: Record<string, never>; output: DashboardStats }
  'seo.sitemapIndex': { input: { requestUrl: string; appUrl?: string | null }; output: SerializedDomainResponse }
  'seo.sitemapSection': { input: { requestUrl: string; file: string; appUrl?: string | null };
    output: SerializedDomainResponse | null }
  'posts.threadReplies': { input: { parentId: number; viewerId: number }; output: PostView[] }
  'posts.detail': { input: { id: number; viewerId: number };
    output: { status: 'not_found' } | { status: 'ready'; post: PostView; conversationRootId: number | null } }
  'posts.editData': { input: { id: number; userId: number };
    output: { status: 'not_found' } | { status: 'forbidden' } | { status: 'ready'; post: PostView;
      parent: PostView | null } }
  'posts.replyParent': { input: { id: number; userId: number };
    output: { status: 'not_found' } | { status: 'forbidden' } | { status: 'ready'; post: PostView } }
  'posts.ogData': { input: { id: number }; output: { body: string; handle: string } | null }
  'posts.suggestions': { input: { kind: 'hashtags' | 'mentions'; query: string; viewerId: number };
    output: { results: string[]; truncated: boolean } }
  'drafts.list': { input: { userId: number }; output: DraftView[] }
  'drafts.get': { input: { id: number; userId: number }; output: DraftView | null }
  'drafts.save': { input: { id: number | null; userId: number; parentId: number | null; body: string };
    output: { status: 'ready'; id: number } | { status: 'not_found' } }
  'drafts.delete': { input: { id: number; userId: number }; output: boolean }
  'posts.votePoll': { input: { postId: number; optionId: number; userId: number };
    output: 'ready' | 'already_voted' | 'expired' | 'not_found' }
  'profiles.bioReferences': { input: { bio: string; profileId: number; viewerId: number }; output: BioReferenceData }
  'profiles.overview': { input: { profileId: number; viewerId: number }; output: ProfileOverviewData | null }
  'profiles.blockedPage': { input: { profileId: number; page: number }; output: {
    people: PersonView[]
    tags: { tag: string; count: number; viewerFollowing: boolean }[]
  } }
  'profiles.connectionsPage': {
    input: { profileId: number; viewerId: number; page: number; tagsPage: number; kind: 'following' | 'followers';
      sort: 'abc' | 'recent' }
    output: { people: PersonView[]; tags: { tag: string; count: number; viewerFollowing: boolean }[]; total: number }
  }
  'profiles.postsPage': {
    input: { profileId: number; viewerId: number; page: number; pageSize: PageSizeChoice; kind: 'notes' | 'replies' }
    output: PostFeedPage
  }
  'syndication.load': {
    input: { kind: 'latest' | 'hot' | 'user' | 'tag' | 'personalized'; origin: string; identifier?: string }
    output: { status: 'not_found' } | { status: 'redirect'; handle: string } | { status: 'ready'; handle?: string;
      posts: ApiPost[]; viewerHandle?: string; activities: Array<
        { id: string; title: string; url: string; created_at: string; author: { handle: string; url: string } }
      >; postTitlePrefixes: Record<number, string> }
  }
  'api.publicRead': { input:
    | { kind: 'collection'; origin: string; limit: number; before: number | null;
      handle?: string; tag?: string; repliesOnly?: boolean; topLevelOnly?: boolean }
    | { kind: 'hot'; origin: string; limit: number;
      cursor: { asOf: string; score: number; latestActivityAt: string; createdAt: string; id: number;
        direction: 'next' | 'previous' } | null }
    | { kind: 'search'; origin: string; query: string; limit: number; offset: number }
    | { kind: 'post'; origin: string; id: number }
    | { kind: 'replies'; origin: string; id: number; limit: number; before: number | null; depth: number };
    output: { status: 'ready'; value: unknown } | { status: 'not_found' } }
  'api.activities': {
    input: { user: User; origin: string; limit: number; cursor: { createdAt: string; key: string } | null;
      toMe: boolean }
    output: unknown
  }
  'api.markActivitiesRead': { input: { userId: number; activityIds: string[]; toMe: boolean }; output: number }
  'api.markAllActivitiesRead': { input: { userId: number; toMe: boolean }; output: null }
  'api.profile': { input: { handle: string; viewerId: number | null; origin: string };
    output: { status: 'not_found' } | { status: 'redirect'; handle: string } | { status: 'ready'; value: unknown;
      private: boolean } }
  'api.tagDetails': { input: { tag: string; origin: string };
    output: { status: 'not_found' } | { status: 'ready'; value: unknown } }
  'api.relationships': {
    input: { kind: 'blocks' | 'following' | 'followers' | 'followingTags' | 'tagFollowers'; handle?: string;
      tag?: string; viewerId?: number; origin: string; limit: number; before: number | null }
    output: { status: 'not_found' } | { status: 'redirect'; handle: string } | { status: 'forbidden' } | {
      status: 'ready'
      value: unknown
    }
  }
  'api.embedExample': { input: Record<string, never>; output: { postId: number | null; tag: string | null } }
  'api.relationshipMutation': {
    input: { userId: number; handle: string; action: 'follow' | 'unfollow' | 'block' | 'unblock' }
    output: { status: 'not_found' | 'self' | 'blocked' } | { status: 'ready'; changed: boolean; targetId: number;
      targetHandle: string }
  }
  'api.createPost': { input: { userId: number; body: string; parentId: number | null; origin: string };
    output: { status: 'not_found' } | { status: 'rate_limited'; retryAfter: number } | { status: 'ready'; id: number;
      duplicate: boolean; post: ApiPost } }
  'api.updatePost': { input: { userId: number; id: number; body: string; origin: string };
    output: { status: 'not_found' | 'forbidden' } | { status: 'ready'; post: ApiPost } }
  'api.deletePost': { input: { userId: number; id: number };
    output: { status: 'not_found' | 'forbidden' } | { status: 'ready'; imageKeys: string[]; parentId: number | null } }
  'api.persistPostPreviews': {
    input: { postId: number; mode: 'save' | 'replace'; previews: Array<{ url: string } & LinkPreview> }
    output: { obsoleteImageKeys: string[] }
  }
  'api.updateBio': { input: { userId: number; bio: string }; output: null }
  'api.persistBioPreviews': { input: { userId: number; previews: Array<{ url: string } & LinkPreview> };
    output: { obsoleteImageKeys: string[] } }
  'api.requestSignIn': { input: { email: string; origin: string; now: number };
    output: { email: string; handle: string; url: string; code: string } | null }
  'api.verifySignIn': { input: { email: string; code: string; userAgent: string; now: number };
    output: { status: 'invalid' } | { status: 'ready'; token: string; expiresAt: number; user: User } }
  'push.postDelivery': { input: { postId: number; actorId: number }; output: { post: {
    body: string
    parentId: number | null
    parentHandle: string | null
  } | null; subscriptions: Array<{
    endpoint: string
    p256dh: string
    auth: string
    userId: number
    recipientHandle: string
    isReply: number
    isMention: number
    notifyReplies: number
    notifyMentions: number
  }> } }
  'push.followDelivery': { input: { followedId: number }; output: Array<{
    endpoint: string
    p256dh: string
    auth: string
    recipientHandle: string
  }> }
  'push.userFollowDelivery': { input: { actorId: number; targetId: number }; output: Array<{
    endpoint: string
    p256dh: string
    auth: string
  }> }
  'push.removeEndpoint': { input: { endpoint: string }; output: null }
  'push.userDelivery': { input: { userId: number }; output: Array<{ endpoint: string; p256dh: string; auth: string }> }
  'push.tagFollowDelivery': { input: { actorId: number; tag: string };
    output: Array<{ endpoint: string; p256dh: string; auth: string }> }
  'push.signupDelivery': { input: { administratorEmails: string[] };
    output: Array<{ endpoint: string; p256dh: string; auth: string }> }
  'profiles.resolve': { input: { handle: string }; output: { id: number; handle: string; alias: boolean } | null }
  'profiles.ogData': { input: { handle: string }; output: { canonicalHandle?: string; profile?: {
    handle: string
    bio: string
    notes: number
    following: number
    followingTags: number
    followers: number
  } } | null }
  'feeds.aboutTopPosts': { input: Record<string, never>; output: PostView[] }
  'feeds.latestPage': { input: { viewerId: number; page: number; pageSize: PageSizeChoice; markRead?: boolean };
    output: PostFeedPage }
  'feeds.hotPage': { input: { viewerId: number; page: number; pageSize: PageSizeChoice }; output: PostFeedPage }
  'feeds.personalizedPage': {
    input: { user: User; page: number; pageSize: PageSizeChoice; toMe: boolean; path: string; markRead?: boolean }
    output: PersonalizedFeedData
  }
  'feeds.bannerState': { input: { userId: number; userAgent: string | null }; output: {
    inviteHandled: boolean
    notificationsEnabled: boolean
    improvementDismissed: boolean
    notificationsHandled: boolean
    appearanceHandled: boolean
    donationDismissed: boolean
  } }
  'feeds.recordBanner': {
    input: { userId: number; userAgent: string | null;
      action: 'notifications-dismissed' | 'notification-improvements-dismissed' | 'appearance-dismissed'
        | 'appearance-seen' | 'invite-dismissed' | 'donation-dismissed' }
    output: null
  }
  'feeds.markRead': { input: { userId: number; toMe: boolean }; output: null }
  'feeds.markLatestRead': { input: { userId: number }; output: null }
  'cache.materializedFeedGet': {
    input: { kind: 'latest' | 'hot' | 'for-you' | 'to-me' | 'about'; viewerId: number; variant: string }
    output: { html: string | null; generation: number }
  }
  'cache.materializedFeedPut': {
    input: { kind: 'latest' | 'hot' | 'for-you' | 'to-me' | 'about'; viewerId: number; variant: string;
      generation: number; html: string }
    output: null
  }
  'cache.recentFeedVisitorPut': {
    input: { userId: number; requestUrl: string; cookie: string; pageSize: PageSizeChoice; density: DensityChoice }
    output: null
  }
  'cache.recentFeedVisitors': { input: Record<string, never>; output: Array<
    { user: User; requestUrl: string; cookie: string; pageSize: PageSizeChoice; density: DensityChoice }
  > }
  'search.results': {
    input: { query: string; viewerId: number; page: number; pageSize: PageSizeChoice; tab: 'notes' | 'tags' | 'people' }
    output: SearchResultsData
  }
  'explore.page': { input: { viewerId: number; peopleIds?: number[]; tagsPage: number; peoplePage: number };
    output: ExploreData }
  'tags.count': { input: { tag: string }; output: number }
  'tags.page': {
    input: { tag: string; viewerId: number; page: number; pageSize: PageSizeChoice; tab: 'notes' | 'followers' }
    output: TagPageData
  }
  'embeds.load': {
    input: { kind: 'latest' | 'hot' } | { kind: 'user'; handle: string } | { kind: 'tag'; tag: string } | {
      kind: 'post'
      id: number
    }
    output: EmbedData | null
  }
  'reports.createIllegalActivity': {
    input: { postId: number; contentUrl: string; details: string; reporterEmail: string | null; reference: string;
      category: string; reporterName: string | null }
    output: boolean
  }
  'interactions.toggleFollow': { input: { userId: number; handle: string };
    output: { targetId: number; targetHandle: string; followed: boolean } | null }
  'interactions.toggleBlock': { input: { userId: number; handle: string };
    output: { targetHandle: string; blocked: boolean } | null }
  'interactions.reportPost': { input: { userId: number; postId: number; reason: string | null };
    output: { status: 'not_found' | 'own_post' | 'ready' | 'reported'; post?: PostView } }
  'interactions.toggleTagFollow': { input: { userId: number; tag: string }; output: { followed: boolean } }
  'interactions.toggleTagBlock': { input: { userId: number; tag: string }; output: { blocked: boolean } }
}

export type DatabaseDomainOperation = keyof DatabaseDomainOperations
export type DatabaseDomainInput<K extends DatabaseDomainOperation> = DatabaseDomainOperations[K]['input']
export type DatabaseDomainOutput<K extends DatabaseDomainOperation> = DatabaseDomainOperations[K]['output']
