import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isAdmin } from '../admin'
import { containsAsciiArt, containsSpoilerTag, extractHashtags, extractMentions } from '../content'
import { parsePoll, pollDisplayBody } from '../polls'
import { parseTodo, todoDisplayBody } from '../todos'
import type { User } from '../types'
import type { BioReferenceData, PostView, UserProfileStats } from '../types'
import { displayBio, displayPostBody, linkify, referenceFormId } from '../utils'
import { enterHref } from './auth-links'
import { MetaRow } from './meta'

function ContentWarning({ p, controlId, showImmediately = false, children }: {
  p: Pick<PostView, 'moderation_category' | 'moderation_score'>
  controlId: string
  showImmediately?: boolean
  children: React.ReactNode
}) {
  if (!p.moderation_category || showImmediately) return <>{children}</>
  return (
    <div className="content-warning">
      <input className="content-warning-toggle" id={controlId} type="checkbox"
        aria-label={`Reveal post that might contain ${p.moderation_category}`} />
      <label className="content-warning-overlay" htmlFor={controlId}>
        <span><span className="content-warning-label">warning:</span> possible {p.moderation_category} content<br />
          <span className="content-warning-action">click to view anyway</span>
        </span>
      </label>
      <div className="content-warning-body">{children}</div>
    </div>
  )
}

function Poll({ p, returnPath }: { p: PostView | NonNullable<PostView['parent']>; returnPath?: string }) {
  if (!p.poll) return null
  const kind = p.poll.kind || 'poll'
  const showResults = p.poll.expired || p.poll.viewerVoted
  const explanationHtml = p.poll.explanation
    ? linkify(displayPostBody(p.poll.explanation), p.mention_bios, [], undefined, renderFlags(p),
      returnPath ? '?from=' + encodeURIComponent(returnPath) : '', p.hashtag_counts, p.mention_note_counts)
    : ''
  return (
    <div className={`poll ${kind}${showResults ? ' poll-results' : ''}`} aria-label={kind === 'quiz' ? 'Quiz' : 'Poll'}>
      {p.poll.options.map(option => {
        const percent = p.poll!.totalVotes ? Math.round(option.votes / p.poll!.totalVotes * 100) : 0
        return showResults
          ? (
            <div
              className={`poll-result${option.selected ? ' poll-selected' : ''}${
                option.correct ? ' quiz-correct' : ''
              }${option.selected && !option.correct && kind === 'quiz' ? ' quiz-incorrect' : ''}`}
              key={option.id}
            >
              <span className="poll-result-fill" style={{ width: `${percent}%` }} />
              <span className="poll-option-label">
                {option.label}
                {kind === 'quiz' && option.correct
                  ? <span className="quiz-mark quiz-mark-correct" aria-label="correct">✓</span>
                  : kind === 'quiz' && option.selected
                  ? <span className="quiz-mark quiz-mark-incorrect" aria-label="incorrect">✗</span>
                  : null}
              </span>
              <span className="poll-option-count">{percent}%</span>
            </div>
          )
          : (
            <form method="post" action={`/post/${p.id}/poll`} className="poll-option" key={option.id}>
              <input type="hidden" name="option" value={option.id} />
              <input type="hidden" name="from" value={returnPath || `/post/${p.id}`} />
              <button type="submit">{option.label}</button>
            </form>
          )
      })}
      {showResults && explanationHtml && (
        <div className="quiz-explanation" dangerouslySetInnerHTML={{ __html: explanationHtml }} />
      )}
      {p.poll.expired && <span className="poll-meta">{p.poll.totalVotes} voted</span>}
    </div>
  )
}

function renderedPollBody(body: string) {
  return todoDisplayBody(pollDisplayBody(body))
}

function Translation({ html }: { html?: string }) {
  return html
    ? (
      <div className="post-body post-translation">
        <div className="post-quote" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
    : null
}

function isDeletedHandle(handle: string) {
  return /^deleted-\d+$/.test(handle)
}

export function isProbablyNonEnglish(text: string) {
  let nonEnglishLetterCount = 0
  for (const character of text) {
    if (/\p{L}/u.test(character) && !/[A-Za-z]/.test(character) && ++nonEnglishLetterCount > 2) return true
  }
  return false
}

function PollPreview({ body }: { body: string }) {
  const poll = parsePoll(body)
  if (!poll) return null
  return (
    <div className={`poll ${poll.kind || 'poll'} poll-preview`}
      aria-label={poll.kind === 'quiz' ? 'Quiz preview' : 'Poll preview'}
    >
      {poll.options.map((option, index) => (
        <div className={`poll-option poll-preview-option${index === poll.correctIndex ? ' quiz-correct' : ''}`}
          key={option}
        >
          {option}
          {index === poll.correctIndex
            ? <span className="quiz-mark quiz-mark-correct" aria-label="correct">✓</span>
            : null}
        </div>
      ))}
      {poll.explanation && (
        <div className="quiz-explanation"
          dangerouslySetInnerHTML={{ __html: linkify(displayPostBody(poll.explanation)) }} />
      )}
    </div>
  )
}

function Todo(
  { p, user, preview, returnPath, formPrefix }: { p: PostView | NonNullable<PostView['parent']>; user: User | null;
    preview?: boolean; returnPath?: string; formPrefix: string },
) {
  const todo = parseTodo(p.body)
  if (!todo) return null
  const editable = !preview && user?.id === p.user_id
  const navigationQuery = preview ? '' : '?from=' + encodeURIComponent(returnPath || `/post/${p.id}#post-${p.id}`)
  const richText = (text: string) => ({
    __html: linkify(text, p.mention_bios, [], undefined, renderFlags(p), navigationQuery, p.hashtag_counts,
      p.mention_note_counts, { signedIn: !!user, currentHandle: user?.handle, formPrefix,
      mentionFollowing: p.mention_following, mentionFollowsViewer: p.mention_follows_viewer,
      mentionProfileStats: p.mention_profile_stats, hashtagFollowing: p.hashtag_following,
      hashtagFollowerCounts: p.hashtag_follower_counts, linkPreviews: p.link_previews,
      linkUnknownMentions: preview || p.id < 0 }, false),
  })
  const spoilerEntry = todo.entries.findIndex(entry =>
    entry.type === 'text'
    && containsSpoilerTag(entry.text)
  )
  const renderEntries = (entries: typeof todo.entries) =>
    entries.map(entry =>
      entry.type === 'text'
        ? entry.text
          ? <div className="todo-text" key={entry.line} dangerouslySetInnerHTML={richText(entry.text)} />
          : <div className="todo-text" key={entry.line}>{'\u00a0'}</div>
        : editable
        ? (
          <form method="post" action={`/post/${p.id}/todo`} className="todo-item" key={entry.item.line}>
            <input type="hidden" name="item" value={entry.itemIndex} />
            <input type="hidden" name="from" value={returnPath || `/post/${p.id}`} />
            <button type="submit"
              aria-label={`${entry.item.checked ? 'mark incomplete' : 'mark complete'}: ${entry.item.label}`}
            >
              <span className={`todo-check${entry.item.checked ? ' todo-check-checked' : ''}`} aria-hidden="true">
                [{entry.item.checked ? '✓' : ' '}]
              </span>
            </button>
            <span className={entry.item.checked ? 'todo-label todo-done' : 'todo-label'}
              dangerouslySetInnerHTML={richText(entry.item.label)} />
          </form>
        )
        : (
          <div className="todo-item todo-item-static" key={entry.item.line}>
            <span className={`todo-check${entry.item.checked ? ' todo-check-checked' : ''}`} aria-hidden="true">
              [{entry.item.checked ? '✓' : ' '}]
            </span>
            <span className={entry.item.checked ? 'todo-label todo-done' : 'todo-label'}
              dangerouslySetInnerHTML={richText(entry.item.label)} />
          </div>
        )
    )
  return (
    <div className={`todo${editable ? ' todo-editable' : ''}`} aria-label={preview ? 'Todo preview' : 'Todo list'}>
      {renderEntries(spoilerEntry < 0 ? todo.entries : todo.entries.slice(0, spoilerEntry + 1))}
      {spoilerEntry >= 0 && spoilerEntry < todo.entries.length - 1 && (
        <div className="post-spoiler todo-spoiler">
          <label className="post-spoiler-summary">
            <input className="post-spoiler-input" type="checkbox" />
            <span>reveal</span>
          </label>
          <div className="post-spoiler-content">
            <div className="post-spoiler-content-inner">{renderEntries(todo.entries.slice(spoilerEntry + 1))}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export function UserReference(
  { handle, bio, noteCount, following, followsViewer, user, href, rel, currentHandle, stats, navigationQuery = '',
    showFollowAction = true, showPopover = true, label, referenceData, extraAction }: {
      handle: string
      bio?: string
      noteCount: number
      following?: boolean
      followsViewer?: boolean
      user: User | null
      href?: string
      rel?: string
      currentHandle?: string
      stats?: UserProfileStats
      navigationQuery?: string
      showFollowAction?: boolean
      showPopover?: boolean
      label?: React.ReactNode
      referenceData?: BioReferenceData
      extraAction?: React.ReactNode
    },
) {
  const ownUser = (user?.handle || currentHandle)?.toLowerCase() === handle.toLowerCase()
  const followReturnPath = new URLSearchParams(navigationQuery.slice(1)).get('from') || undefined
  const bioTags = extractHashtags(bio || '')
  const bioTagCounts = referenceData?.hashtagCounts || {}
  const bioTagFollowerCounts = referenceData?.hashtagFollowerCounts || {}
  const bioMentionBios = referenceData?.mentionBios || {}
  const bioMentionProfileStats = referenceData?.mentionProfileStats || {}
  const bioMentionNoteCounts = referenceData?.mentionNoteCounts || {}
  const bioFormPrefix = `handle-${handle.toLowerCase()}-bio`
  return (
    <span className="reference-menu">
      {href
        ? <a className="reference-menu-trigger postauthor" href={href} rel={rel}>{label || <>@{handle}</>}</a>
        : <span className="reference-menu-trigger postauthor" tabIndex={0}>{label || <>@{handle}</>}</span>}
      {showPopover && (
        <span className="reference-menu-popover">
          {(bio?.trim() || ownUser) && (
            <span
              className={`reference-popover-bio${ownUser ? ' reference-popover-bio-own' : ''}${
                bio?.trim() ? '' : ' bio-empty'
              }`}
              dangerouslySetInnerHTML={{
                __html: bio?.trim()
                  ? linkify(displayBio(bio), bioMentionBios, [], undefined, undefined, navigationQuery, bioTagCounts,
                    bioMentionNoteCounts, {
                    signedIn: !!user,
                    currentHandle: user?.handle,
                    formPrefix: bioFormPrefix,
                    mentionFollowing: referenceData?.mentionFollowing,
                    mentionFollowsViewer: referenceData?.mentionFollowsViewer,
                    mentionProfileStats: bioMentionProfileStats,
                    hashtagFollowing: referenceData?.hashtagFollowing,
                    hashtagFollowerCounts: bioTagFollowerCounts,
                    linkPreviews: referenceData?.linkPreviews,
                  })
                  : 'No bio yet',
              }}
            />
          )}
          {showFollowAction && !ownUser && (user
            ? (
              <span className="reference-popover-actions">
                <form method="post" action={'/follow/' + handle}>
                  {followReturnPath && <input type="hidden" name="from" value={followReturnPath} />}
                  {!!followsViewer && <span className="follows-you">follows you</span>}
                  <button className={`button${following ? ' button-muted' : ''}`} type="submit">
                    {following ? 'unfollow' : followsViewer ? 'follow back' : 'follow'}
                  </button>
                </form>
                <form method="post" action={'/block/' + handle}>
                  <button className="quiet danger" type="submit">block</button>
                </form>
                {extraAction}
              </span>
            )
            : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>)}
        </span>
      )}
      {showPopover && user && bioTags.map(tag => (
        <React.Fragment key={tag}>
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'tag', tag)} method="post"
            action={'/tag-follow/' + encodeURIComponent(tag)} />
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'tag', tag, 'block')} method="post"
            action={'/tag-block/' + encodeURIComponent(tag)} />
        </React.Fragment>
      ))}
      {showPopover && user && Object.keys(bioMentionBios).map(bioHandle => (
        <React.Fragment key={`user-${bioHandle}`}>
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'user', bioHandle)} method="post"
            action={'/follow/' + encodeURIComponent(bioHandle)} />
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'user', bioHandle, 'block')}
            method="post" action={'/block/' + encodeURIComponent(bioHandle)} />
        </React.Fragment>
      ))}
    </span>
  )
}

export function TagReference(
  { tag, noteCount, followerCount, following, user, href, navigationQuery = '', showFollowAction = true,
    showPopover = true, label }: {
      tag: string
      noteCount: number
      followerCount: number
      following?: boolean
      user: User | null
      href?: string
      navigationQuery?: string
      showFollowAction?: boolean
      showPopover?: boolean
      label?: React.ReactNode
    },
) {
  const tagPath = `/tag/${encodeURIComponent(tag)}`
  const followReturnPath = new URLSearchParams(navigationQuery.slice(1)).get('from') || undefined
  return (
    <span className="reference-menu">
      <a className="reference-menu-trigger" href={href || tagPath + navigationQuery}>{label || <>#{tag}</>}</a>
      {showPopover && showFollowAction && (
        <span className="reference-menu-popover reference-menu-popover-tag">
          {user
            ? (
              <span className="reference-popover-actions">
                <form method="post" action={`/tag-follow/${encodeURIComponent(tag)}`}>
                  {followReturnPath && <input type="hidden" name="from" value={followReturnPath} />}
                  <button className={`button${following ? ' button-muted' : ''}`} type="submit">
                    {following ? 'unfollow' : 'follow'}
                  </button>
                </form>
                <form method="post" action={`/tag-block/${encodeURIComponent(tag)}`}>
                  <button className="quiet danger" type="submit">block</button>
                </form>
              </span>
            )
            : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>}
        </span>
      )}
    </span>
  )
}

export function BioReferenceForms({ data, prefix, user }: {
  data?: BioReferenceData
  prefix: string
  user: User | null
}) {
  if (!user || !data) return null
  return (
    <>
      {Object.keys(data.hashtagFollowing).map(tag => (
        <React.Fragment key={`tag-${tag}`}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag)} method="post"
            action={`/tag-follow/${encodeURIComponent(tag)}`} />
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag, 'block')} method="post"
            action={`/tag-block/${encodeURIComponent(tag)}`} />
        </React.Fragment>
      ))}
      {Object.keys(data.mentionBios).map(handle => (
        <React.Fragment key={`user-${handle}`}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle)} method="post"
            action={`/follow/${encodeURIComponent(handle)}`} />
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle, 'block')} method="post"
            action={`/block/${encodeURIComponent(handle)}`} />
        </React.Fragment>
      ))}
    </>
  )
}

function ReferenceFollowForms(
  { post, prefix, user, returnPath }: { post: PostView | NonNullable<PostView['parent']>; prefix: string;
    user: User | null; returnPath: string },
) {
  if (!user) return null
  const handles = extractMentions(post.body).filter(handle => handle !== user.handle.toLowerCase())
  const tags = extractHashtags(post.body)
  return (
    <>
      {handles.map(handle => (
        <React.Fragment key={'user-' + handle}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle)} method="post"
            action={'/follow/' + handle}
          >
            <input type="hidden" name="from" value={returnPath} />
          </form>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle, 'block')} method="post"
            action={'/block/' + handle} />
        </React.Fragment>
      ))}
      {tags.map(tag => (
        <React.Fragment key={'tag-' + tag}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag)} method="post"
            action={'/tag-follow/' + encodeURIComponent(tag)}
          >
            <input type="hidden" name="from" value={returnPath} />
          </form>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag, 'block')} method="post"
            action={'/tag-block/' + encodeURIComponent(tag)} />
        </React.Fragment>
      ))}
    </>
  )
}

function renderFlags(post: PostView | NonNullable<PostView['parent']>) {
  return post.has_latex == null || post.has_links == null || post.has_code == null
    ? undefined
    : { has_latex: post.has_latex, has_links: post.has_links, has_code: post.has_code }
}

export const MAX_VISIBLE_REPLY_DEPTH = 5

export function replyAnchorReturnPath(threadRootId: number, replyId: number, returnPath?: string) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return `/post/${threadRootId}${returnQuery}#post-${replyId}`
}

export function postedReplyPath(parentId: number, replyId: number, returnPath?: string) {
  if (returnPath) {
    const target = new URL(returnPath, 'http://textlog.local')
    if (/^\/post\/[1-9]\d*$/.test(target.pathname)) {
      return `${target.pathname}${target.search}#post-${replyId}`
    }
  }
  return replyAnchorReturnPath(parentId, replyId, returnPath)
}

export function conversationTopPath(threadRootId: number, replyId: number, returnPath?: string) {
  const deepPostPath = `/post/${replyId}${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}#post-${replyId}`
  return `/post/${threadRootId}?from=${encodeURIComponent(deepPostPath)}#post-${threadRootId}`
}

type PostAgeWording = 'just' | 'earlier' | 'not long ago' | 'a while ago' | 'some time ago' | 'a long time ago'
type PostAge = { label: string; wording: PostAgeWording }

export function approximatePostAge(createdAt: string, now = Date.now()): PostAge {
  const timestamp = Date.parse(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (elapsedMinutes < 60) return { label: `${elapsedMinutes}mins`, wording: 'just' }
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedMinutes < 12 * 60) return { label: `${elapsedHours}h`, wording: 'earlier' }
  const elapsedDays = Math.max(1, Math.floor(elapsedMinutes / (24 * 60)))
  if (elapsedMinutes < 3 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'not long ago' }
  if (elapsedMinutes < 14 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'a while ago' }
  if (elapsedMinutes < 90 * 24 * 60) return { label: `${elapsedDays}d`, wording: 'some time ago' }
  return { label: 'older', wording: 'a long time ago' }
}

export function postAgeTitle(createdAt: string, now = Date.now()) {
  const date = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const elapsedMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000))
  const { wording } = approximatePostAge(createdAt, now)
  const relative = wording === 'just'
    ? 'just now'
    : elapsedMinutes < 24 * 60
    ? wording
    : elapsedMinutes >= 365 * 24 * 60
    ? `${Math.round(elapsedMinutes / (365 * 24 * 60))}y ago`
    : elapsedMinutes >= 30 * 24 * 60
    ? `${Math.round(elapsedMinutes / (30 * 24 * 60))}mo ago`
    : elapsedMinutes > 7 * 24 * 60
    ? `${Math.round(elapsedMinutes / (7 * 24 * 60))}w ago`
    : `${Math.round(elapsedMinutes / (24 * 60))}d ago`
  const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
  return `${monthYear}, ${relative}`
}

function ageContextLabel(label: string, wording: PostAge['wording']) {
  const plain = label.replace(/:$/, '')
  const mentionSuffix = ' and mentioned you'
  const hasMention = plain.endsWith(mentionSuffix)
  const attribution = hasMention ? plain.slice(0, -mentionSuffix.length) : plain
  const aged = wording === 'just' ? `just ${attribution}` : `${attribution} ${wording}`
  return aged + (hasMention ? mentionSuffix : '') + ':'
}

export function PreviewPost({ p }: { p: PostView }) {
  const formPrefix = `preview-post-${p.id}`
  return (
    <article className="post" id={`post-${p.id}`}>
      <MetaRow className="posttop preview-post-meta">
        <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats} user={null}
          currentHandle={p.handle} referenceData={p.bio_reference} />
        <span className="postdate">read</span>
      </MetaRow>
      <ContentWarning p={p} controlId={`${formPrefix}-content-warning`}>
        <div className={`post-body${containsAsciiArt(p.body) ? ' ascii-art' : ''}`} dangerouslySetInnerHTML={{
          __html: linkify(displayPostBody(renderedPollBody(p.body)), p.mention_bios, [], undefined, renderFlags(p), '',
            p.hashtag_counts, p.mention_note_counts, { signedIn: false, currentHandle: p.handle, formPrefix,
            hashtagFollowerCounts: p.hashtag_follower_counts, linkPreviews: p.link_previews }),
        }} />
        <PollPreview body={p.body} />
        <Todo p={p} user={null} preview formPrefix={formPrefix} />
      </ContentWarning>
      <MetaRow className="postfoot preview-post-meta">
        <span className="quiet preview-reply">reply</span>
      </MetaRow>
    </article>
  )
}

export function Post({
  p,
  user,
  showReplyAction = true,
  showOwnerActions = false,
  showModerateAction = false,
  showParent = true,
  showReplyCount = false,
  replyHref,
  replyLabel,
  reportHref,
  foldControlId,
  highlightTerms = [],
  tappable = false,
  tappableParent = false,
  contextLabel,
  contextUnread = false,
  contextParentUnread = false,
  contextDirectedUnread = false,
  preview = false,
  returnPath,
  backHref,
  canonicalTimestamp = false,
  topHref,
  flatHref,
  treeHref,
  authorPopoverAction,
  continuationHref,
  continuationLabel = 'more',
  className,
  topActions,
  showReadAction = true,
  hideTopMeta = false,
  suppressContentWarning = false,
}: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean;
  showModerateAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string;
  reportHref?: string; foldControlId?: string; highlightTerms?: string[]; tappable?: boolean; tappableParent?: boolean;
  contextLabel?: React.ReactNode; contextUnread?: boolean; contextParentUnread?: boolean;
  contextDirectedUnread?: boolean; preview?: boolean; returnPath?: string; backHref?: string;
  canonicalTimestamp?: boolean; topHref?: string; flatHref?: string; treeHref?: string;
  authorPopoverAction?: React.ReactNode; continuationHref?: string; continuationLabel?: string; className?: string;
  topActions?: React.ReactNode; showReadAction?: boolean; hideTopMeta?: boolean; suppressContentWarning?: boolean })
{
  if (p.link_previews && Object.values(p.link_previews).some(preview => preview.linkedPost)) {
    const linkedPostReturnPath = returnPath || `/post/${p.id}#post-${p.id}`
    p = { ...p,
      link_previews: Object.fromEntries(Object.entries(p.link_previews).map(([url, preview]) => [url, preview.linkedPost
        ? { ...preview, renderedPostHtml: renderToStaticMarkup(
          <Post p={preview.linkedPost as PostView} user={user} showParent={false} showReplyCount tappable
            showReadAction={false} className="internal-post-card" returnPath={linkedPostReturnPath} />,
        ), linkedPostReturnPath }
        : preview]
      )) }
  }
  const parent = showParent ? p.parent : null
  const showApproximateAge = canonicalTimestamp || contextUnread
  const postPageAge = showApproximateAge ? approximatePostAge(p.created_at) : null
  const postPageAgeTitle = showApproximateAge ? postAgeTitle(p.created_at) : undefined
  const parentContinued = parent?.parent_id && parent.parent?.user_id === parent.user_id
  const parentContextTarget = parent?.parent_id && !parent.poll && !parentContinued
      && parent.parent?.user_id !== user?.id
    ? parent.parent
    : null
  const parentContextLabel = parent?.poll
    ? `created a ${parent.poll.kind || 'poll'}${parent.viewer_mentioned ? ' and mentioned you' : ''}:`
    : parentContinued
    ? `continued${parent?.viewer_mentioned ? ' and mentioned you' : ''}:`
    : parent?.parent_id
    ? parent.parent?.user_id === user?.id
      ? `replied to you${parent.viewer_mentioned ? ' and mentioned you' : ''}:`
      : parentContextTarget
      ? 'replied to'
      : undefined
    : `wrote${parent?.viewer_mentioned ? ' and mentioned you' : ''}:`
  const hasTappableParent = Boolean(parent && (tappable || tappableParent))
  const isAsciiArt = containsAsciiArt(p.body)
  const returnQuery = returnPath ? '&from=' + encodeURIComponent(returnPath) : ''
  const actionQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  const referenceQuery = preview
    ? actionQuery
    : '?from=' + encodeURIComponent(returnPath || `/post/${p.id}#post-${p.id}`)
  const continued = p.parent_id && p.parent?.user_id === p.user_id
  const canModerate = showModerateAction && isAdmin(user)
  const contextTarget = !p.poll && contextLabel == null && p.parent_id && !continued && p.viewer_context !== 'reply'
    ? p.parent
    : null
  contextLabel = p.poll
    ? `created a ${p.poll.kind || 'poll'}${p.viewer_mentioned ? ' and mentioned you' : ''}:`
    : contextLabel ?? (p.parent_id
      ? continued
        ? `continued${p.viewer_mentioned ? ' and mentioned you' : ''}:`
        : p.viewer_context === 'reply'
        ? `replied to you${p.viewer_mentioned ? ' and mentioned you' : ''}:`
        : contextTarget
        ? 'replied to'
        : undefined
      : `wrote${p.viewer_mentioned ? ' and mentioned you' : ''}:`)
  if (postPageAge && !contextTarget && typeof contextLabel === 'string') {
    contextLabel = ageContextLabel(contextLabel, postPageAge.wording)
  }
  if (p.viewer_mentioned && !contextTarget && typeof contextLabel === 'string'
    && !contextLabel.includes('mentioned you'))
  {
    contextLabel = contextLabel.replace(/:$/, '') + ' and mentioned you:'
  }
  const detailPath = '/post/' + p.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
  const resolvedContinuationHref = continuationHref
    ?? (showReplyCount && (p.reply_count || 0) > 0 ? detailPath : undefined)
  const parentDetailPath = parent
    ? '/post/' + parent.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
    : ''
  const parentReplyPath = parent ? '/post/' + parent.id + '?reply=1' + returnQuery : ''
  const defaultReplyPath = '/post/' + p.id + '?reply=1' + returnQuery
  const navigationRel = returnPath ? 'nofollow' : undefined
  const formPrefix = `post-${p.id}`
  const resolvedReplyHref = replyHref
    ?? (user ? defaultReplyPath : '/enter?next=' + encodeURIComponent(defaultReplyPath))
  const resolvedReplyLabel = replyLabel ?? (user
    ? user.id === p.user_id ? 'continue' : 'reply'
    : 'enter to reply')
  const translationHtml = p.translation
    ? linkify(displayPostBody(p.translation), p.mention_bios, highlightTerms, undefined, renderFlags(p), referenceQuery,
      p.hashtag_counts, p.mention_note_counts, { signedIn: !!user, currentHandle: user?.handle,
      formPrefix: `${formPrefix}-translation`, mentionFollowing: p.mention_following,
      mentionFollowsViewer: p.mention_follows_viewer, mentionProfileStats: p.mention_profile_stats,
      hashtagFollowing: p.hashtag_following, hashtagFollowerCounts: p.hashtag_follower_counts,
      linkPreviews: p.link_previews, linkUnknownMentions: preview || p.id < 0 })
    : undefined
  if (p.deleted_at) {
    return (
      <article className="post deleted-post" id={`post-${p.id}`}>
        <a href={detailPath} rel={navigationRel}>
          (deleted post)
        </a>
      </article>
    )
  }
  return (
    <article
      className={`post${className ? ` ${className}` : ''}${hideTopMeta ? ' post-without-top-meta' : ''}${
        tappable || hasTappableParent ? ' tappable-post' : ''
      }${contextDirectedUnread ? ' activity-item-directed-unread' : ''}`}
      id={`post-${p.id}`}
    >
      {tappable && (
        <a className="post-hit-area" href={detailPath} rel={navigationRel} aria-label={`open post by @${p.handle}`} />
      )}
      {!hideTopMeta && (
        <MetaRow className={`posttop${contextLabel ? ' posttop-context' : ''}${preview ? ' preview-post-meta' : ''}`}
          unread={contextUnread}
        >
          {user?.id === p.user_id
            ? (
              <span className={preview ? 'post-context post-context-author' : 'postauthor post-context-author'}>
                you
              </span>
            )
            : preview
            ? (
              <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
                following={p.viewer_following} followsViewer={p.follows_viewer} user={user}
                referenceData={p.bio_reference} extraAction={authorPopoverAction} />
            )
            : (
              <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
                following={p.viewer_following} followsViewer={p.follows_viewer} user={user}
                href={'/u/' + p.handle + referenceQuery} rel={navigationRel} navigationQuery={referenceQuery}
                referenceData={p.bio_reference} extraAction={authorPopoverAction} />
            )}
          {p.blocked_viewer && <span className="post-context">(user has blocked you)</span>}
          {contextLabel && (canonicalTimestamp
            ? (
              <>
                <a className="post-context" href={`/post/${p.id}`} title={postPageAgeTitle}>
                  {typeof contextLabel === 'string'
                    ? (contextTarget && postPageAge?.wording === 'just' ? 'just ' : '')
                      + contextLabel.replace(/:$/, '')
                    : contextLabel}
                </a>
                {!contextTarget && <span className="post-context post-context-punctuation">:</span>}
              </>
            )
            : <span className="post-context" title={postPageAgeTitle}>{contextLabel}</span>)}
          {contextTarget && (
            <>
              {isDeletedHandle(contextTarget.handle)
                ? <span className="post-context deleted-context">(deleted account)</span>
                : preview
                ? <span className="preview-context-target">@{contextTarget.handle}</span>
                : (
                  <UserReference handle={contextTarget.handle} bio={contextTarget.bio}
                    noteCount={contextTarget.note_count || 0} stats={contextTarget.profile_stats}
                    following={contextTarget.viewer_following} followsViewer={contextTarget.follows_viewer} user={user}
                    href={`/u/${contextTarget.handle}${referenceQuery}`} rel={navigationRel}
                    navigationQuery={referenceQuery} referenceData={contextTarget.bio_reference} />
                )}
              <span
                className={`post-context post-context-punctuation${
                  p.viewer_mentioned ? ' post-context-mention-suffix' : ''
                }`}
                title={postPageAgeTitle}
              >
                {p.viewer_mentioned
                  ? `${
                    postPageAge && postPageAge.wording !== 'just' ? `\u00a0${postPageAge.wording} ` : ' '
                  }and mentioned you:`
                  : postPageAge && postPageAge.wording !== 'just'
                  ? `\u00a0${postPageAge.wording}:`
                  : ':'}
              </span>
            </>
          )}
          {showReadAction && !preview && !tappable && !canonicalTimestamp && (
            <a className="postdate" href={canonicalTimestamp ? `/post/${p.id}` : detailPath}
              rel={canonicalTimestamp ? undefined : navigationRel}
            >
              {canonicalTimestamp ? 'permalink' : 'read'}
            </a>
          )}
          {foldControlId && (
            <label className="quiet thread-fold" htmlFor={foldControlId} title="fold or unfold replies">
              <span className="visually-hidden">fold or unfold replies</span>
            </label>
          )}
          {tappable && parent && (
            <a className="quiet post-top-link"
              href={replyAnchorReturnPath(parent.top_id || parent.id, parent.top_id || parent.id, returnPath)}
            >
              top
            </a>
          )}
          {(flatHref || treeHref || showOwnerActions && (user?.id === p.user_id || canModerate) || topHref || backHref
            || topActions) && (
            <div className="post-navigation-actions">
              {topActions}
              {showOwnerActions && (user?.id === p.user_id || canModerate) && (
                <div className="post-actions">
                  <a className="quiet" href={'/post/' + p.id + '/edit' + actionQuery} aria-label="edit this post">
                    edit
                  </a>
                </div>
              )}
              {flatHref && <a className="quiet post-top-link" href={flatHref}>flat</a>}
              {treeHref && <a className="quiet post-top-link" href={treeHref}>tree</a>}
              {topHref && <a className="quiet post-top-link" href={topHref}>top</a>}
              {backHref && <a className="quiet post-back-link" href={backHref}>back</a>}
            </div>
          )}
        </MetaRow>
      )}
      <ContentWarning p={p} controlId={`${formPrefix}-content-warning`}
        showImmediately={user?.show_moderated_content === 1 || suppressContentWarning}>
        <div className={`post-body${isAsciiArt ? ' ascii-art' : ''}`} dangerouslySetInnerHTML={{
          __html: linkify(displayPostBody(renderedPollBody(p.body)), p.mention_bios, highlightTerms, undefined,
            renderFlags(p), referenceQuery, p.hashtag_counts, p.mention_note_counts, { signedIn: !!user,
            currentHandle: user?.handle, formPrefix, mentionFollowing: p.mention_following,
            mentionFollowsViewer: p.mention_follows_viewer, mentionProfileStats: p.mention_profile_stats,
            hashtagFollowing: p.hashtag_following, hashtagFollowerCounts: p.hashtag_follower_counts,
            linkPreviews: p.link_previews, linkUnknownMentions: preview || p.id < 0 }),
        }} />
        {!preview && <Translation html={translationHtml} />}
        {preview ? <PollPreview body={p.body} /> : <Poll p={p} returnPath={returnPath} />}
        <Todo p={p} user={user} preview={preview} returnPath={returnPath} formPrefix={formPrefix} />
      </ContentWarning>
      {!parent && (showReplyAction && !p.thread_locked || resolvedContinuationHref || canModerate || reportHref) && (
        <MetaRow className={`postfoot${preview ? ' preview-post-meta' : ''}`}>
          {!parent && showReplyAction && !p.thread_locked && (preview
            ? <span className="quiet preview-reply">{resolvedReplyLabel}</span>
            : (
              <a className="quiet post-reply-link" href={resolvedReplyHref} rel="nofollow"
                aria-label={`${resolvedReplyLabel} to @${p.handle}`}
              >
                {resolvedReplyLabel}
              </a>
            ))}
          {resolvedContinuationHref && (
            <a className="quiet post-continuation-link" href={resolvedContinuationHref} rel="nofollow">
              {continuationLabel}
            </a>
          )}
          {(canModerate || reportHref) && (
            <span className="post-actions">
              {canModerate && (
                <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
                  moderate
                </a>
              )}
              {reportHref && (
                <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
              )}
            </span>
          )}
        </MetaRow>
      )}
      <ReferenceFollowForms post={p} prefix={formPrefix} user={user}
        returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
      {parent && (
        <blockquote className={'parent-quote' + (containsAsciiArt(parent.body) ? ' ascii-art' : '')
          + (parent.deleted_at || parent.unavailable ? ' deleted-parent' : '')
          + (hasTappableParent && !parent.unavailable ? ' tappable-parent' : '')}
        >
          {hasTappableParent && !parent.unavailable && (
            <a className="parent-hit-area" href={parentDetailPath} rel={navigationRel}
              aria-label={`open quoted post by @${parent.handle}`} />
          )}
          {parent.unavailable
            ? <span>(unavailable post)</span>
            : parent.deleted_at
            ? <a href={parentDetailPath} rel={navigationRel}>(deleted post)</a>
            : (
              <>
                <MetaRow className="parent-quote-top" unread={contextParentUnread}>
                  {user?.id === parent.user_id
                    ? <span className="postauthor post-context-author">you</span>
                    : (
                      <UserReference handle={parent.handle} bio={parent.bio} noteCount={parent.note_count || 0}
                        stats={parent.profile_stats} following={parent.viewer_following}
                        followsViewer={parent.follows_viewer} user={user} href={'/u/' + parent.handle + referenceQuery}
                        rel={navigationRel} navigationQuery={referenceQuery} referenceData={parent.bio_reference} />
                    )}
                  {parentContextLabel && (
                    <span className="post-context"
                      title={contextParentUnread ? postAgeTitle(parent.created_at) : undefined}
                    >
                      {contextParentUnread
                        ? ageContextLabel(parentContextLabel, approximatePostAge(parent.created_at).wording)
                        : parentContextLabel}
                    </span>
                  )}
                  {parentContextTarget && (
                    <>
                      {isDeletedHandle(parentContextTarget.handle)
                        ? <span className="post-context deleted-context">(deleted account)</span>
                        : (
                          <UserReference handle={parentContextTarget.handle} bio={parentContextTarget.bio}
                            noteCount={parentContextTarget.note_count || 0} stats={parentContextTarget.profile_stats}
                            following={parentContextTarget.viewer_following}
                            followsViewer={parentContextTarget.follows_viewer} user={user}
                            href={`/u/${parentContextTarget.handle}${referenceQuery}`} rel={navigationRel}
                            navigationQuery={referenceQuery} referenceData={parentContextTarget.bio_reference} />
                        )}
                      <span className="post-context post-context-punctuation">
                        {parent.viewer_mentioned ? ' and mentioned you:' : ':'}
                      </span>
                    </>
                  )}
                  {!hasTappableParent && <a className="postdate" href={parentDetailPath} rel={navigationRel}>read</a>}
                </MetaRow>
                <ContentWarning p={parent} controlId={`${formPrefix}-parent-${parent.id}-content-warning`}
                  showImmediately={user?.show_moderated_content === 1 || suppressContentWarning}>
                  <div className={`post-body${containsAsciiArt(parent.body) ? ' ascii-art' : ''}`}
                    dangerouslySetInnerHTML={{
                    __html: linkify(displayPostBody(renderedPollBody(parent.body)), parent.mention_bios, [], undefined,
                      renderFlags(parent), referenceQuery, parent.hashtag_counts, parent.mention_note_counts, {
                      signedIn: !!user,
                      currentHandle: user?.handle,
                      formPrefix: `${formPrefix}-parent-${parent.id}`,
                      mentionFollowing: parent.mention_following,
                      mentionFollowsViewer: parent.mention_follows_viewer,
                      mentionProfileStats: parent.mention_profile_stats,
                      hashtagFollowing: parent.hashtag_following,
                      hashtagFollowerCounts: parent.hashtag_follower_counts,
                      linkPreviews: parent.link_previews,
                    }),
                    }} />
                  <Translation html={parent.translation
                    ? linkify(displayPostBody(parent.translation), parent.mention_bios, [], undefined,
                    renderFlags(parent), referenceQuery, parent.hashtag_counts, parent.mention_note_counts, {
                    signedIn: !!user,
                    currentHandle: user?.handle,
                    formPrefix: `${formPrefix}-parent-${parent.id}-translation`,
                    mentionFollowing: parent.mention_following,
                    mentionFollowsViewer: parent.mention_follows_viewer,
                    mentionProfileStats: parent.mention_profile_stats,
                    hashtagFollowing: parent.hashtag_following,
                    hashtagFollowerCounts: parent.hashtag_follower_counts,
                    linkPreviews: parent.link_previews,
                  })
                    : undefined} />
                  <Poll p={parent} returnPath={returnPath} />
                  <Todo p={parent} user={user} preview={preview} returnPath={returnPath}
                    formPrefix={`${formPrefix}-parent-${parent.id}`} />
                </ContentWarning>
                {!parent.thread_locked && (
                  <div className="parent-quote-foot">
                    <a className="quiet" href={user
                      ? parentReplyPath
                      : '/enter?next=' + encodeURIComponent(parentReplyPath)} rel="nofollow"
                      aria-label={`${user && user.id === parent.user_id ? 'continue' : 'reply to'} @${parent.handle}`}
                    >
                      {user ? user.id === parent.user_id ? 'continue' : 'reply' : 'enter to reply'}
                    </a>
                  </div>
                )}
                <ReferenceFollowForms post={parent} prefix={`${formPrefix}-parent-${parent.id}`} user={user}
                  returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
              </>
            )}
        </blockquote>
      )}
      {parent && (showReplyAction && !p.thread_locked || resolvedContinuationHref || canModerate || reportHref) && (
        <MetaRow className={`postfoot postfoot-after-quote${preview ? ' preview-post-meta' : ''}`}>
          {showReplyAction && !p.thread_locked && (preview
            ? <span className="quiet preview-reply">{resolvedReplyLabel}</span>
            : (
              <a className="quiet post-reply-link" href={resolvedReplyHref} rel="nofollow"
                aria-label={`${resolvedReplyLabel} to @${p.handle}`}
              >
                {resolvedReplyLabel}
              </a>
            ))}
          {resolvedContinuationHref && (
            <a className="quiet post-continuation-link" href={resolvedContinuationHref} rel="nofollow">
              {continuationLabel}
            </a>
          )}
          {(canModerate || reportHref) && (
            <span className="post-actions">
              {canModerate && (
                <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
                  moderate
                </a>
              )}
              {reportHref && (
                <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
              )}
            </span>
          )}
        </MetaRow>
      )}
    </article>
  )
}

type FeedPostProps = React.ComponentProps<typeof Post>
type FeedPostFragment = { className: string; id: string; innerHtml: string }
const feedPostFragments = new Map<string, FeedPostFragment>()
const MAX_FEED_POST_FRAGMENTS = 1_024
const FEED_POST_FRAGMENT_VERSION = 1

function FeedPost(props: FeedPostProps) {
  const key = JSON.stringify([FEED_POST_FRAGMENT_VERSION, props])
  let fragment = feedPostFragments.get(key)
  if (fragment) {
    feedPostFragments.delete(key)
    feedPostFragments.set(key, fragment)
  }
  else {
    const rendered = renderToStaticMarkup(<Post {...props} />)
    const match = rendered.match(/^<article class="([^"]*)" id="([^"]*)">([\s\S]*)<\/article>$/)
    if (!match) return <Post {...props} />
    fragment = { className: match[1], id: match[2], innerHtml: match[3] }
    feedPostFragments.set(key, fragment)
    while (feedPostFragments.size > MAX_FEED_POST_FRAGMENTS) {
      feedPostFragments.delete(feedPostFragments.keys().next().value!)
    }
  }
  return <article className={fragment.className} id={fragment.id}
    dangerouslySetInnerHTML={{ __html: fragment.innerHtml }} />
}

export function ThreadReplies(
  { parentId, replies, user, returnPath, excludePostId, flat = false, showMissingContinuations = false,
    continuationLabel = 'more', continuationReturnPath, contextUnreadPostIds, contextDirectedUnreadPostIds,
    highlightTerms = [], hideTopMeta = false, collapsedPreviewPostIds = [] }: {
      parentId: number
      replies: PostView[]
      user: User | null
      returnPath?: string
      excludePostId?: number
      flat?: boolean
      showMissingContinuations?: boolean
      continuationLabel?: string
      continuationReturnPath?: string
      contextUnreadPostIds?: ReadonlySet<number>
      contextDirectedUnreadPostIds?: ReadonlySet<number>
      highlightTerms?: string[]
      hideTopMeta?: boolean
      collapsedPreviewPostIds?: number[]
    },
) {
  if (!replies.length) return null
  const children = new Map<number, PostView[]>()
  for (const reply of replies) {
    const siblings = children.get(reply.parent_id!) || []
    siblings.push(reply)
    children.set(reply.parent_id!, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
  }
  const byId = new Map(replies.map(reply => [reply.id, reply]))
  const collapsedPreviewPosts = new Set(collapsedPreviewPostIds)
  const collapsedPreviewPath = new Set<number>()
  if (collapsedPreviewPostIds.length) {
    for (const previewPostId of collapsedPreviewPostIds) {
      let current = byId.get(previewPostId)
      while (current && current.id !== parentId) {
        collapsedPreviewPath.add(current.id)
        current = current.parent_id ? byId.get(current.parent_id) : undefined
      }
    }
  }
  const collapsedPreviewGapPosts = new Set<number>()
  if (collapsedPreviewPostIds.length) {
    let hiddenPostAbove = false
    const visit = (id: number) => {
      for (const reply of children.get(id) || []) {
        if (!reply.deleted_at) {
          if (collapsedPreviewPosts.has(reply.id)) {
            const parent = byId.get(reply.parent_id!)
            const loadedSiblings = (children.get(reply.parent_id!) || []).filter(sibling => !sibling.deleted_at).length
            const hasOmittedSiblings = parent?.direct_reply_count != null
              && parent.direct_reply_count > loadedSiblings
            if (hiddenPostAbove || hasOmittedSiblings) collapsedPreviewGapPosts.add(reply.id)
            hiddenPostAbove = false
          }
          else hiddenPostAbove = true
        }
        visit(reply.id)
      }
    }
    visit(parentId)
  }
  const descendantCounts = new Map<number, number>()
  const visibleDescendantCount = (id: number): number => {
    const cached = descendantCounts.get(id)
    if (cached !== undefined) return cached
    const count = (children.get(id) || [])
      .reduce((total, reply) => total + (reply.deleted_at ? 0 : 1) + visibleDescendantCount(reply.id), 0)
    descendantCounts.set(id, count)
    return count
  }
  const renderReply = (reply: PostView, childBranch?: React.ReactNode, continuesElsewhere = false) => {
    const anchoredReturnPath = replyAnchorReturnPath(parentId, reply.id, returnPath)
    const postReturnPath = continuationReturnPath
      ? `${continuationReturnPath}#post-${reply.id}`
      : anchoredReturnPath
    const foldControlId = childBranch ? `thread-fold-${reply.id}` : undefined
    const continuationHref = continuesElsewhere
      ? '/post/' + reply.id + '?from=' + encodeURIComponent(
        continuationReturnPath ? `${continuationReturnPath}#post-${reply.id}` : anchoredReturnPath,
      )
      : undefined
    return (
      <div
        className={`reply-node${collapsedPreviewPath.has(reply.id) ? ' collapsed-preview-path' : ''}${
          collapsedPreviewPosts.has(reply.id) ? ' collapsed-preview-post' : ''
        }`}
        key={reply.id}
      >
        {collapsedPreviewGapPosts.has(reply.id) && (
          <div className="quiet thread-ancestor-gap collapsed-preview-gap" aria-label="Earlier replies hidden">…</div>
        )}
        {reply.feed_ancestor_gap && !collapsedPreviewPostIds.length && (
          <div className="quiet thread-ancestor-gap" aria-label="Earlier replies omitted">…</div>
        )}
        {foldControlId && <input className="thread-fold-input" type="checkbox" id={foldControlId} />}
        <FeedPost p={reply} user={user} showParent={false} foldControlId={foldControlId} returnPath={postReturnPath}
          contextUnread={contextUnreadPostIds?.has(reply.id)}
          contextDirectedUnread={contextDirectedUnreadPostIds?.has(reply.id)} highlightTerms={highlightTerms}
          replyHref={user ? undefined : '/enter?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1'
            + '&from=' + encodeURIComponent(postReturnPath))} replyLabel={user ? undefined : 'enter to reply'}
          continuationHref={continuationHref} continuationLabel={continuationLabel} tappable
          hideTopMeta={hideTopMeta} />
        {childBranch}
      </div>
    )
  }
  if (flat) {
    const flattened: PostView[] = []
    const visit = (id: number) => {
      for (const reply of children.get(id) || []) {
        if (!reply.deleted_at && reply.id !== excludePostId) flattened.push(reply)
        visit(reply.id)
      }
    }
    visit(parentId)
    return flattened.length
      ? (
        <div className="reply-branch reply-branch-flat">
          <div className="thread-branch-content">{flattened.map(reply => renderReply(reply))}</div>
        </div>
      )
      : null
  }
  const renderBranch = (id: number, depth: number): React.ReactNode => {
    const branch = children.get(id) || []
    if (!branch.length) return null
    return (
      <div className={`reply-branch${collapsedPreviewPostIds.length ? ' feed-thread-collapsed-branch' : ''}`}>
        <div className="thread-branch-content">
          {branch.map(reply => {
            const descendantCount = visibleDescendantCount(reply.id)
            const truncatedByDepth = !reply.deleted_at && depth >= MAX_VISIBLE_REPLY_DEPTH && descendantCount > 0
            const hasMissingDescendants = !reply.deleted_at && showMissingContinuations
              && (reply.reply_count || 0) > descendantCount
            const continuesElsewhere = truncatedByDepth || hasMissingDescendants
            const childBranch = truncatedByDepth ? null : renderBranch(reply.id, depth + 1)
            if (reply.deleted_at) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
            if (reply.id === excludePostId) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
            return renderReply(reply, childBranch, continuesElsewhere)
          })}
        </div>
      </div>
    )
  }
  return renderBranch(parentId, 1)
}

/** Render feed posts as conversations, filling in any available ancestor context. */
export function FeedThreads(
  { posts, user, returnPath, contextUnreadPostIds, contextDirectedUnreadPostIds, highlightTerms = [],
    hideTopMeta = false, promoteAncestors = false, expandedRootId }: { posts: PostView[]; user: User | null;
      returnPath: string; contextUnreadPostIds?: ReadonlySet<number>;
      contextDirectedUnreadPostIds?: ReadonlySet<number>; highlightTerms?: string[]; hideTopMeta?: boolean;
      promoteAncestors?: boolean | 'all'; expandedRootId?: number },
) {
  if (!posts.length) return null
  const treePosts = [...posts]
  const ids = new Set(posts.map(post => post.id))
  const externalChildren = new Map<number, PostView[]>()
  for (const post of posts) {
    if (!post.parent_id || ids.has(post.parent_id)) continue
    externalChildren.set(post.parent_id, [...(externalChildren.get(post.parent_id) || []), post])
  }
  for (const [parentId, children] of externalChildren) {
    if (!promoteAncestors && children.length < 2) continue
    const parent = children.find(child => child.parent?.id === parentId)?.parent
    if (!parent || ids.has(parent.id)) continue
    treePosts.push({ ...parent, user_id: parent.user_id ?? -1,
      parent_id: parent.parent_id ?? null, reply_count: parent.reply_count || 0,
      ...(promoteAncestors && promoteAncestors !== 'all' && parent.parent_id != null
        ? { feed_ancestor_gap: true }
        : {}) })
    ids.add(parent.id)
  }
  if (promoteAncestors) {
    for (const post of posts) {
      const immediateParent = post.parent
      if (!immediateParent) continue
      if (!ids.has(immediateParent.id)) {
        treePosts.push({ ...immediateParent, user_id: immediateParent.user_id ?? -1,
          parent_id: immediateParent.parent_id ?? null, reply_count: immediateParent.reply_count || 0,
          feed_ancestor_gap: promoteAncestors !== 'all' && immediateParent.parent_id != null })
        ids.add(immediateParent.id)
      }
      if (promoteAncestors === 'all') {
        let ancestor = immediateParent.parent
        while (ancestor) {
          if (!ids.has(ancestor.id)) {
            treePosts.push({ ...ancestor, user_id: ancestor.user_id ?? -1,
              parent_id: ancestor.parent_id ?? null, reply_count: ancestor.reply_count || 0 })
            ids.add(ancestor.id)
          }
          ancestor = ancestor.parent
        }
        continue
      }
      let rootAncestor = immediateParent
      while (rootAncestor.parent) rootAncestor = rootAncestor.parent
      if (contextUnreadPostIds?.has(post.id)
        && rootAncestor.id !== immediateParent.id && !ids.has(rootAncestor.id))
      {
        treePosts.push({ ...rootAncestor, user_id: rootAncestor.user_id ?? -1,
          parent_id: rootAncestor.parent_id ?? null, reply_count: rootAncestor.reply_count || 0 })
        ids.add(rootAncestor.id)
      }
    }
    if (promoteAncestors !== 'all') {
      let promotedSharedParent = true
      while (promotedSharedParent) {
        promotedSharedParent = false
        const sharedAncestors = new Map<number, PostView[]>()
        for (const post of treePosts) {
          if (!post.parent_id || ids.has(post.parent_id)) continue
          sharedAncestors.set(post.parent_id, [...(sharedAncestors.get(post.parent_id) || []), post])
        }
        for (const [parentId, children] of sharedAncestors) {
          if (children.length < 2) continue
          const parent = children.find(child => child.parent?.id === parentId)?.parent
          if (!parent || ids.has(parent.id)) continue
          treePosts.push({ ...parent, user_id: parent.user_id ?? -1,
            parent_id: parent.parent_id ?? null, reply_count: parent.reply_count || 0 })
          ids.add(parent.id)
          promotedSharedParent = true
        }
      }
    }
    for (let index = 0; index < treePosts.length; index++) {
      const post = treePosts[index]
      if (!post.parent_id || ids.has(post.parent_id)) continue
      let ancestor = post.parent
      while (ancestor && !ids.has(ancestor.id)) ancestor = ancestor.parent
      treePosts[index] = { ...post, parent_id: ancestor?.id ?? null,
        ...(contextUnreadPostIds?.has(post.id) ? { parent: ancestor } : {}),
        feed_ancestor_gap: post.feed_ancestor_gap || !!ancestor }
    }
  }
  const positions = new Map(treePosts.map((post, index) => [post.id, index]))
  const children = new Map<number, PostView[]>()
  for (const post of treePosts) {
    if (!post.parent_id || !ids.has(post.parent_id)) continue
    children.set(post.parent_id, [...(children.get(post.parent_id) || []), post])
  }
  const conversationPosition = (root: PostView) => {
    let position = positions.get(root.id)!
    const visit = (parentId: number) => {
      for (const child of children.get(parentId) || []) {
        position = Math.min(position, positions.get(child.id)!)
        visit(child.id)
      }
    }
    visit(root.id)
    return position
  }
  const visibleReplyCount = (root: PostView) => {
    let count = 0
    const visit = (parentId: number) => {
      for (const child of children.get(parentId) || []) {
        if (!child.deleted_at) count++
        visit(child.id)
      }
    }
    visit(root.id)
    return count
  }
  const isLinearConversation = (root: PostView) => {
    let linear = true
    const visit = (parentId: number) => {
      const replies = children.get(parentId) || []
      if (replies.length > 1) linear = false
      for (const reply of replies) visit(reply.id)
    }
    visit(root.id)
    return linear
  }
  const collapsedPreviewPosts = (root: PostView) => {
    const selected: PostView[] = []
    const visit = (parentId: number) => {
      for (const child of children.get(parentId) || []) {
        if (!child.deleted_at) selected.push(child)
        visit(child.id)
      }
    }
    visit(root.id)
    selected.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    if (selected.length > 1
      && Date.parse(`${selected[0].created_at.replace(' ', 'T')}Z`)
        - Date.parse(`${selected[1].created_at.replace(' ', 'T')}Z`) < 48 * 60 * 60_000) return selected.slice(0, 2)
    return selected.slice(0, 1)
  }
  const roots = treePosts.filter(post => !post.parent_id || !ids.has(post.parent_id))
    .sort((a, b) => conversationPosition(a) - conversationPosition(b))
  return (
    <>
      {roots.map(post => {
        const anchoredReturnPath = `${returnPath}#post-${post.id}`
        const visibleReplies = visibleReplyCount(post)
        const collapsedPreview = visibleReplies > 0 ? collapsedPreviewPosts(post) : []
        const canCollapse = visibleReplies > collapsedPreview.length
        const continuesElsewhere = (post.reply_count || 0) > visibleReplies
        const foldControlId = visibleReplies > 0 ? `feed-thread-fold-${post.id}` : undefined
        const reconstructedLinearHotThread = promoteAncestors === 'all' && isLinearConversation(post)
        const collapsed = canCollapse && !reconstructedLinearHotThread && expandedRootId !== post.id
        const expandedReturnPath = (() => {
          const target = new URL(returnPath, 'http://textlog.local')
          target.searchParams.set('expand', String(post.id))
          return target.pathname + target.search
        })()
        return (
          <div className="post-page-thread feed-thread" key={post.id}>
            {foldControlId && (
              <input className="thread-fold-input" type="checkbox" id={foldControlId} defaultChecked={collapsed} />
            )}
            <div className={`thread-root${post.profile_pinned ? ' profile-pinned-surround' : ''}`}>
              <FeedPost p={post} user={user} tappable returnPath={anchoredReturnPath} highlightTerms={highlightTerms}
                hideTopMeta={hideTopMeta} contextUnread={contextUnreadPostIds?.has(post.id)}
                foldControlId={foldControlId}
                contextParentUnread={!!post.parent && contextUnreadPostIds?.has(post.parent.id)}
                contextDirectedUnread={contextDirectedUnreadPostIds?.has(post.id)} continuationHref={continuesElsewhere
                ? `/post/${post.id}?from=${encodeURIComponent(anchoredReturnPath)}`
                : undefined} />
            </div>
            <ThreadReplies parentId={post.id} replies={treePosts} user={user} returnPath={anchoredReturnPath}
              showMissingContinuations continuationLabel="more"
              continuationReturnPath={collapsed ? expandedReturnPath : returnPath}
              contextUnreadPostIds={contextUnreadPostIds} contextDirectedUnreadPostIds={contextDirectedUnreadPostIds}
              highlightTerms={highlightTerms} hideTopMeta={hideTopMeta}
              collapsedPreviewPostIds={canCollapse ? collapsedPreview.map(reply => reply.id) : []} />
          </div>
        )
      })}
    </>
  )
}
