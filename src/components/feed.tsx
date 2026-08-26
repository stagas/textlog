import type { PersonalizedFeedData, PersonalizedTimelineRow, User } from '../types'
import { activityAnchor } from '../activity-anchor'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { MetaRow } from './meta'
import { ActionPair, FeedTabs, Pagination } from './page-shared'
import { BioReferenceForms, FeedThreads, Post, TagReference, UserReference } from './post'

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
      : `${row.actor_id}:${row.activity_kind}:${row.target_is_viewer}`
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
  notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
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
  const displayTimeline = toMe ? data.timeline : data.timeline.filter(row => !row.parent_id || row.unread)
  const timelinePosts = displayTimeline.filter(row => ['post', 'reply', 'mention'].includes(row.activity_kind))
  const unreadPostIds = new Set(timelinePosts.filter(row => row.unread).map(row => row.id))
  const directedUnreadPostIds = new Set(timelinePosts.filter(row => row.unread && row.targeted_to_viewer)
    .map(row => row.id))
  const conversationRootId = (row: PersonalizedTimelineRow) => {
    let rootId = row.id
    let parent = row.renderedPost?.parent
    while (parent) {
      rootId = parent.id
      parent = parent.parent
    }
    return rootId
  }
  const threadPosts = (row: PersonalizedTimelineRow) => {
    const rootId = conversationRootId(row)
    return timelinePosts.filter(candidate => conversationRootId(candidate) === rootId)
      .map(candidate => candidate.renderedPost!)
  }
  const timelinePositions = new Map(displayTimeline.map((row, index) => [row.event_key, index]))
  const timelinePostPositions = new Map(displayTimeline.map((row, index) => [row.id, index]))
  const visibleTimeline = displayTimeline.filter((row, index) => {
    if (!['post', 'reply', 'mention'].includes(row.activity_kind)) return true
    return displayTimeline.findIndex(candidate => ['post', 'reply', 'mention'].includes(candidate.activity_kind)
      && conversationRootId(candidate) === conversationRootId(row)) === index
  })
    .sort((a, b) => {
      const position = (row: PersonalizedTimelineRow) => ['post', 'reply', 'mention'].includes(row.activity_kind)
        ? Math.min(...threadPosts(row).map(post => timelinePostPositions.get(post.id)!))
        : timelinePositions.get(row.event_key)!
      return position(a) - position(b)
    })
  const renderTimelineRow = (row: PersonalizedTimelineRow) => {
    const anchor = activityAnchor(row.event_key)
    const activityReturnPath = `${returnPath}#${anchor}`
    const fromQuery = `?from=${encodeURIComponent(activityReturnPath)}`
    return ['post', 'reply', 'mention'].includes(row.activity_kind)
      ? (
        <div
          className={`for-you-item for-you-author-${row.actor_id}${
            flat && row.unread && row.targeted_to_viewer ? ' activity-item-directed-unread' : ''
          }`}
          key={row.event_key}
        >
          {flat
            ? <Post p={row.renderedPost!} user={user} showReplyCount tappable contextUnread={!!row.unread}
              returnPath={`${returnPath}#post-${row.id}`} />
            : <FeedThreads posts={threadPosts(row)} user={user} returnPath={returnPath}
              promoteAncestors={!toMe}
              contextUnreadPostIds={unreadPostIds} contextDirectedUnreadPostIds={directedUnreadPostIds} />}
        </div>
      )
      : (
        <article className={`activity-follow${
          row.unread && row.targeted_to_viewer
            ? ' activity-item-directed-unread'
            : ''
        }`} key={row.event_key} id={anchor}>
          <div className="activity-follow-content">
            <MetaRow className="activity-follow-main" unread={!!row.unread}>
              <UserReference handle={row.actor_handle} bio={row.actor_bio} noteCount={row.actorProfileStats?.notes || 0}
                stats={row.actorProfileStats} following={!!row.following} followsViewer={row.actorFollowsViewer}
                user={user} href={`/u/${row.actor_handle}${fromQuery}`} navigationQuery={fromQuery}
                referenceData={row.actorBioReferences} showPopover={row.activity_kind !== 'signup'} />
              <span className="activity-context">
                {row.activity_kind === 'signup' ? 'signed up.' : row.target_is_viewer ? 'followed you:' : 'followed'}
              </span>
              {!row.target_is_viewer && row.activity_kind === 'user_follow'
                ? (
                  <UserReference handle={row.target_handle!} bio={row.target_bio || ''} noteCount={row.posts || 0}
                    stats={row.targetProfileStats} following={!!row.following} user={user}
                    followsViewer={row.targetFollowsViewer} href={`/u/${row.target_handle}${fromQuery}`}
                    navigationQuery={fromQuery} referenceData={row.targetBioReferences} showPopover={false} />
                )
                : row.activity_kind === 'tag_follow'
                ? (
                  <TagReference tag={row.target_tag!} noteCount={row.posts || 0}
                    followerCount={row.tagFollowerCount || 0} following={!!row.following} user={user}
                    href={`/tag/${encodeURIComponent(row.target_tag!)}${fromQuery}`} navigationQuery={fromQuery}
                    showPopover={false} />
                )
                : null}
              {!row.target_is_viewer && (row.activity_kind === 'user_follow' || row.activity_kind === 'tag_follow')
                && <span className="activity-follow-full-stop">.</span>}
            </MetaRow>
            {(row.activity_kind === 'user_follow' || row.activity_kind === 'signup') && row.target_bio?.trim() && (() => {
              const references = row.activity_kind === 'signup' || row.target_is_viewer
                ? row.actorBioReferences
                : row.targetBioReferences
              const prefix = `activity-${anchor}-bio`
              return <>
                <p className="profile-bio" dangerouslySetInnerHTML={{
                  __html: linkify(displayBio(row.target_bio), references?.mentionBios, [], undefined, undefined,
                    fromQuery, references?.hashtagCounts, references?.mentionNoteCounts, {
                      signedIn: true,
                      currentHandle: user.handle,
                      formPrefix: prefix,
                      mentionFollowing: references?.mentionFollowing,
                      mentionFollowsViewer: references?.mentionFollowsViewer,
                      mentionProfileStats: references?.mentionProfileStats,
                      hashtagFollowing: references?.hashtagFollowing,
                      hashtagFollowerCounts: references?.hashtagFollowerCounts,
                      linkPreviews: references?.linkPreviews,
                    }),
                }} />
                <BioReferenceForms data={references} prefix={prefix} user={user} />
              </>
            })()}
          </div>
          {row.actor_id !== user.id && row.activity_kind !== 'signup' && (
            <form method="post" action={row.target_is_viewer
              ? `/follow/${row.actor_handle}`
              : row.activity_kind === 'user_follow'
              ? `/follow/${row.target_handle}`
              : `/tag-follow/${row.target_tag}`}
            >
              <input type="hidden" name="from" value={activityReturnPath} />
              {(!row.target_is_viewer && (row.activity_kind === 'user_follow'
                ? row.targetFollowsViewer
                : false)) && <span className="follows-you">follows you</span>}
              <button className={`button${row.following ? ' button-muted' : ''}`}>
                {row.following ? 'unfollow' : row.target_is_viewer || (row.activity_kind === 'user_follow'
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
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner} mobileWriteAction>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user}
        forYouReadStatus={data.timeline.length
          ? hasUnread && unreadPage !== null && unreadPage > data.page
          : undefined}
        toMe={toMe} toMeCount={data.toMeCount} forYouCount={data.forYouCount} unreadHref={data.unreadHref}
        lastUnreadHref={data.lastUnreadHref} forYouUnread={data.forYouUnread} toMeUnread={data.toMeUnread}
        latestCount={data.latestCount} viewMode={toMe ? (flat ? 'flat' : 'tree') : undefined}
        viewHref={toMe ? viewHref : undefined} />
      {showTopPagination && <Pagination page={data.page} totalPages={data.totalPages} path={feedPath} top />}
      {displayTimeline.length
        ? groupSimilarActivities(flat ? displayTimeline : visibleTimeline).map((group, groupIndex) =>
            group.rows.length > 1 && group.collapsible
              ? (
                <div className="activity-group" key={group.rows[0].event_key}>
                  {renderTimelineRow(group.rows[0])}
                  <div className="activity-more">
                    <input className="activity-more-input" type="checkbox" id={`activity-more-${groupIndex}`} />
                    <label className="activity-more-summary" htmlFor={`activity-more-${groupIndex}`}>
                      and {group.rows.length - 1} more
                    </label>
                    <div className="activity-more-content">
                      <div className="activity-more-content-inner">
                        {group.rows.slice(1).map(renderTimelineRow)}
                      </div>
                    </div>
                  </div>
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
