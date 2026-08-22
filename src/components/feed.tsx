import type { PersonalizedFeedData, PersonalizedTimelineRow, User } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { MetaRow } from './meta'
import { ActionPair, FeedTabs, Pagination } from './page-shared'
import { FeedThreads, Post, TagReference, UserReference } from './post'

export type ForYouCursor = { createdAt: string; key: string; direction: 'next' | 'previous' }

export function decodeForYouCursor(value?: string): ForYouCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 1
      || typeof decoded[1] !== 'string' || !decoded[1] || typeof decoded[2] !== 'string' || !decoded[2]
      || !['next', 'previous'].includes(decoded[3])) return null
    return { createdAt: decoded[1], key: decoded[2], direction: decoded[3] }
  }
  catch {
    return null
  }
}

export function encodeForYouCursor(cursor: ForYouCursor) {
  return Buffer.from(JSON.stringify([1, cursor.createdAt, cursor.key, cursor.direction])).toString('base64url')
}

type TimelineGroup = { rows: PersonalizedTimelineRow[]; collapsible: boolean }

export function groupSimilarActivities(timeline: PersonalizedTimelineRow[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  const similarityKey = (row: PersonalizedTimelineRow) =>
    ['post', 'reply', 'mention'].includes(row.activity_kind)
      ? null
      : `${row.activity_kind}:${row.target_is_viewer}`
  for (const row of timeline) {
    const key = similarityKey(row)
    const previous = groups.at(-1)
    if (key && previous && similarityKey(previous.rows[0]) === key) previous.rows.push(row)
    else groups.push({ rows: [row], collapsible: key !== null })
  }
  return groups
}

export function Feed({ user, data, title, path = '/for-you', pageUrl, notificationBanner = false, toMe = false,
  flat = false }: {
  user: User
  data: PersonalizedFeedData
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'notification-update' | 'donate'
  toMe?: boolean
  flat?: boolean
}) {
  const feedPath = flat ? `${path}?view=flat` : path
  const returnPath = feedPath + (data.page > 1 ? `${flat ? '&' : '?'}page=${data.page}` : '')
  const viewHref = flat
    ? path + (data.page > 1 ? `?page=${data.page}` : '')
    : `${path}?view=flat${data.page > 1 ? `&page=${data.page}` : ''}`
  const hasUnread = toMe ? data.toMeUnread : data.forYouUnread
  const unreadPage = data.unreadHref
    ? Number(new URL(data.unreadHref, 'http://localhost').searchParams.get('page') || 1)
    : null
  const showTopPagination = data.page > 1 || (data.page === 1 && unreadPage !== null && unreadPage > 1)
  const timelinePosts = data.timeline.filter(row => ['post', 'reply', 'mention'].includes(row.activity_kind))
  const timelinePostIds = new Set(timelinePosts.map(row => row.id))
  const unreadPostIds = new Set(timelinePosts.filter(row => row.unread).map(row => row.id))
  const threadPosts = (rootId: number) => {
    const root = timelinePosts.find(row => row.id === rootId)
    const sharedOrphanSiblings = root?.parent_id && !timelinePostIds.has(root.parent_id)
      ? timelinePosts.filter(row => row.parent_id === root.parent_id)
      : []
    const included = new Set(sharedOrphanSiblings.length > 1 ? sharedOrphanSiblings.map(row => row.id) : [rootId])
    let changed = true
    while (changed) {
      changed = false
      for (const row of timelinePosts) {
        if (row.parent_id && included.has(row.parent_id) && !included.has(row.id)) {
          included.add(row.id)
          changed = true
        }
      }
    }
    return timelinePosts.filter(row => included.has(row.id)).map(row => row.renderedPost!)
  }
  const timelinePositions = new Map(data.timeline.map((row, index) => [row.event_key, index]))
  const timelinePostPositions = new Map(data.timeline.map((row, index) => [row.id, index]))
  const visibleTimeline = data.timeline.filter((row, index) => {
    if (!['post', 'reply', 'mention'].includes(row.activity_kind)) return true
    if (row.parent_id && timelinePostIds.has(row.parent_id)) return false
    if (!row.parent_id) return true
    return data.timeline.findIndex(candidate => ['post', 'reply', 'mention'].includes(candidate.activity_kind)
      && candidate.parent_id === row.parent_id) === index
  })
    .sort((a, b) => {
      const position = (row: PersonalizedTimelineRow) => ['post', 'reply', 'mention'].includes(row.activity_kind)
        ? Math.min(...threadPosts(row.id).map(post => timelinePostPositions.get(post.id)!))
        : timelinePositions.get(row.event_key)!
      return position(a) - position(b)
    })
  const renderTimelineRow = (row: PersonalizedTimelineRow) => {
    const activityAnchor = `activity-${row.event_key.replace(/[^a-z0-9_-]+/gi, '-')}`
    const activityReturnPath = `${returnPath}#${activityAnchor}`
    const fromQuery = `?from=${encodeURIComponent(activityReturnPath)}`
    return ['post', 'reply', 'mention'].includes(row.activity_kind)
      ? (
        <div
          className={`for-you-item for-you-author-${row.actor_id}${
            row.unread && row.targeted_to_viewer ? ' activity-item-directed-unread' : ''
          }`}
          key={row.event_key}
        >
          {flat
            ? <Post p={row.renderedPost!} user={user} showReplyCount tappable contextUnread={!!row.unread}
              returnPath={`${returnPath}#post-${row.id}`} />
            : <FeedThreads posts={threadPosts(row.id)} user={user} returnPath={returnPath}
              contextUnreadPostIds={unreadPostIds} />}
        </div>
      )
      : (
        <article className={`activity-follow${
          row.unread && row.targeted_to_viewer
            ? ' activity-item-directed-unread'
            : ''
        }`} key={row.event_key} id={activityAnchor}>
          <div className="activity-follow-content">
            <MetaRow className="activity-follow-main" unread={!!row.unread}>
              <UserReference handle={row.actor_handle} bio={row.actor_bio} noteCount={row.actorProfileStats?.notes || 0}
                stats={row.actorProfileStats} following={!!row.following} followsViewer={row.actorFollowsViewer}
                user={user} href={row.activity_kind === 'signup'
                ? `/admin/users/${row.actor_id}`
                : `/u/${row.actor_handle}${fromQuery}`} navigationQuery={fromQuery} />
              <span className="activity-context">
                {row.activity_kind === 'signup' ? 'signed up:' : row.target_is_viewer ? 'followed you:' : 'followed'}
              </span>
              {!row.target_is_viewer && row.activity_kind === 'user_follow'
                ? (
                  <UserReference handle={row.target_handle!} bio={row.target_bio || ''} noteCount={row.posts || 0}
                    stats={row.targetProfileStats} following={!!row.following} user={user}
                    followsViewer={row.targetFollowsViewer} href={`/u/${row.target_handle}${fromQuery}`}
                    navigationQuery={fromQuery} />
                )
                : row.activity_kind === 'tag_follow'
                ? (
                  <TagReference tag={row.target_tag!} noteCount={row.posts || 0}
                    followerCount={row.tagFollowerCount || 0} following={!!row.following} user={user}
                    href={`/tag/${encodeURIComponent(row.target_tag!)}${fromQuery}`} navigationQuery={fromQuery} />
                )
                : null}
              {!row.target_is_viewer && (row.activity_kind === 'user_follow' || row.activity_kind === 'tag_follow')
                && <span className="activity-follow-full-stop">.</span>}
            </MetaRow>
            {(row.activity_kind === 'user_follow' || row.activity_kind === 'signup') && (
              <p className="profile-bio" dangerouslySetInnerHTML={{ __html: linkify(displayBio(row.target_bio)) }} />
            )}
          </div>
          {row.actor_id !== user.id && (
            <form method="post" action={row.target_is_viewer || row.activity_kind === 'signup'
              ? `/follow/${row.actor_handle}`
              : row.activity_kind === 'user_follow'
              ? `/follow/${row.target_handle}`
              : `/tag-follow/${row.target_tag}`}
            >
              <input type="hidden" name="from" value={activityReturnPath} />
              {(!row.target_is_viewer && (row.activity_kind === 'signup'
                ? row.actorFollowsViewer
                : row.activity_kind === 'user_follow'
                ? row.targetFollowsViewer
                : false)) && <span className="follows-you">follows you</span>}
              <button className={`button${row.following ? ' button-muted' : ''}`}>
                {row.following ? 'unfollow' : row.target_is_viewer || (row.activity_kind === 'signup'
                    ? row.actorFollowsViewer
                    : row.activity_kind === 'user_follow'
                    ? row.targetFollowsViewer
                    : false)
                  ? 'follow back'
                  : 'follow'}
                {row.activity_kind === 'user_follow' && !row.target_is_viewer && ` @${row.target_handle}`}
                {row.activity_kind === 'tag_follow' && ` #${row.target_tag}`}
              </button>
            </form>
          )}
        </article>
      )
  }
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user} forYouReadStatus={data.timeline.length ? hasUnread : undefined}
        toMe={toMe} toMeCount={toMe ? 0 : data.toMeCount} forYouCount={data.forYouCount} unreadHref={data.unreadHref}
        lastUnreadHref={data.lastUnreadHref} forYouUnread={data.forYouUnread} toMeUnread={data.toMeUnread}
        viewMode={flat ? 'flat' : 'tree'} viewHref={viewHref} />
      {showTopPagination && <Pagination page={data.page} totalPages={data.totalPages} path={feedPath} top />}
      {data.timeline.length
        ? groupSimilarActivities(flat ? data.timeline : visibleTimeline).map(group =>
            group.rows.length > 1 && group.collapsible
              ? (
                <div className="activity-group" key={group.rows[0].event_key}>
                  {renderTimelineRow(group.rows[0])}
                  <details className="activity-more">
                    <summary>and {group.rows.length - 1} more</summary>
                    {group.rows.slice(1).map(renderTimelineRow)}
                  </details>
                </div>
              )
              : renderTimelineRow(group.rows[0])
          )
        : data.page === 1
        ? (
          <div className="empty empty-actions">
            <p>
              {toMe
                ? 'No replies, mentions, or new followers yet.'
                : 'Your timeline is empty. Follow people or hashtags to shape it.'}
            </p>
            <ActionPair primary={<a className="button" href="/explore">explore tags &amp; people</a>} secondary={
              <>
                <a href="/">browse notes</a>
                <span className="action-separator">or</span>
                <a href="/write">write your first note</a>
              </>
            } />
          </div>
        )
        : (
          <div className="empty">
            No activity on this page. <a href="/for-you">Return to the first page</a>.
          </div>
        )}
      <Pagination page={data.page} totalPages={data.totalPages} path={feedPath} />
    </Layout>
  )
}
