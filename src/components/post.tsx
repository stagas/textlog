import React from 'react'
import { isAdmin } from '../admin'
import { db, type User } from '../db'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { fmt, fmtFull, linkify } from '../utils'

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
}: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean;
  showModerateAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string;
  reportHref?: string; foldControlId?: string })
{
  const parent = showParent ? p.parent : null
  const replyCount = p.reply_count || 0
  const defaultReplyPath = '/post/' + p.id + '?reply=1'
  const resolvedReplyHref = replyHref
    ?? (user ? defaultReplyPath : '/login?next=' + encodeURIComponent(defaultReplyPath))
  const resolvedReplyLabel = replyLabel ?? (user ? 'reply' : 'log in to reply')
  if (p.deleted_at) {
    return (
      <article className="post deleted-post">
        <a href={'/post/' + p.id}>
          (deleted){showReplyCount && replyCount > 0
            ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
            : ''}
        </a>
      </article>
    )
  }
  return (
    <article className="post">
      <div className="posttop">
        <a className="postauthor" href={'/u/' + p.handle}>@{p.handle}</a>
        <a className="postdate" href={'/post/' + p.id}>
          <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
          {showReplyCount && replyCount > 0 && <span>{' '}· {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>}
        </a>
        {showReplyAction && (
          <a className="quiet" href={resolvedReplyHref}
            aria-label={`${resolvedReplyLabel} to @${p.handle}`}
          >
            {resolvedReplyLabel}
          </a>
        )}
        {reportHref && (
          <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
        )}
        {showOwnerActions && user?.id === p.user_id && (
          <div className="post-actions">
            <a className="quiet" href={'/post/' + p.id + '/edit'} aria-label="edit this post">edit</a>
            <a className="quiet danger" href={'/post/' + p.id + '/delete'} aria-label="delete this post">delete</a>
          </div>
        )}
        {showModerateAction && isAdmin(user) && (
          <div className="post-actions admin-post-actions">
            <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
              moderate
            </a>
          </div>
        )}
        {foldControlId && (
          <label className="quiet thread-fold" htmlFor={foldControlId} title="fold or unfold replies">
            <span className="sr-only">fold or unfold replies</span>
          </label>
        )}
      </div>
      <p dangerouslySetInnerHTML={{ __html: linkify(p.body) }} />
      {parent && (
        <blockquote className={'parent-quote' + (parent.deleted_at ? ' deleted-parent' : '')}>
          {parent.deleted_at
            ? <a href={'/post/' + parent.id}>(deleted)</a>
            : (
              <>
                <div className="parent-quote-top">
                  <a className="postauthor" href={'/u/' + parent.handle}>@{parent.handle}</a>
                  <a className="postdate" href={'/post/' + parent.id}>
                    <time dateTime={parent.created_at} title={fmtFull(parent.created_at)}>
                      {fmt(parent.created_at)}
                    </time>
                    {parent.reply_count > 0 && (
                      <span>{' '}· {parent.reply_count} {parent.reply_count === 1 ? 'reply' : 'replies'}</span>
                    )}
                  </a>
                  <a className="quiet"
                    href={user
                      ? '/post/' + parent.id + '?reply=1'
                      : '/login?next=' + encodeURIComponent('/post/' + parent.id + '?reply=1')}
                    aria-label={`reply to @${parent.handle}`}
                  >
                    {user ? 'reply' : 'log in to reply'}
                  </a>
                </div>
                <p dangerouslySetInnerHTML={{ __html: linkify(parent.body) }} />
              </>
            )}
        </blockquote>
      )}
    </article>
  )
}

export function ThreadReplies({ parentId, user }: { parentId: number; user: User | null }) {
  const viewerId = user?.id ?? -1
  const rows = db.query(`WITH RECURSIVE thread AS (
      SELECT p.*,u.handle,1 depth FROM posts p JOIN users u ON u.id=p.user_id WHERE p.parent_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      UNION ALL
      SELECT p.*,u.handle,thread.depth+1 FROM posts p JOIN users u ON u.id=p.user_id
        JOIN thread ON p.parent_id=thread.id WHERE (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
    ) SELECT id,user_id,parent_id,body,created_at,deleted_at,handle,depth
      FROM thread ORDER BY created_at ASC,id ASC`).all(parentId, viewerId, viewerId, viewerId, viewerId, viewerId,
    viewerId) as (PostView & { depth: number })[]
  const replies = enrichPosts(db, rows, viewerId)
  if (!replies.length) return null
  const children = new Map<number, PostView[]>()
  for (const reply of replies) {
    const siblings = children.get(reply.parent_id!) || []
    siblings.push(reply)
    children.set(reply.parent_id!, siblings)
  }
  const renderBranch = (id: number, depth: number): React.ReactNode => {
    const branch = children.get(id) || []
    if (!branch.length) return null
    return (
      <div className="reply-branch">
        {branch.map(reply => {
          const childBranch = renderBranch(reply.id, depth + 1)
          if (reply.deleted_at) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
          const foldControlId = childBranch ? `thread-fold-${reply.id}` : undefined
          return (
            <div className="reply-node" key={reply.id}>
              {foldControlId && <input className="thread-fold-input" type="checkbox" id={foldControlId} />}
              <Post p={reply} user={user} showParent={false} foldControlId={foldControlId}
                replyHref={user ? undefined : '/login?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1')}
                replyLabel={user ? 'reply' : 'log in to reply'} />
              {childBranch}
            </div>
          )
        })}
      </div>
    )
  }
  return renderBranch(parentId, 1)
}
