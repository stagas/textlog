import React from 'react'
import { db, type User } from '../db'
import { fmt, fmtFull, linkify } from '../utils'
import type { PostView } from '../types'
import { enrichPosts } from '../posts'

export function Post({ p, user, showReplyAction = true, showOwnerActions = false, showParent = true, showReplyCount = false, replyHref, replyLabel = 'reply', reportHref }: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string; reportHref?: string }) {
  const parent = showParent ? p.parent : null
  const replyCount = p.reply_count || 0
  if (p.deleted_at) return <article className="post deleted-post">
    <a href={'/post/' + p.id}>(deleted){showReplyCount && replyCount > 0
      ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
      : ''}</a>
  </article>
  return <article className="post">
    <div className="posttop">
      <a className="postauthor" href={'/u/' + p.handle}>@{p.handle}</a>
      <a className="postdate" href={'/post/' + p.id}>
        <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>{showReplyCount && replyCount > 0 && <span> · {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>}
      </a>
      {showReplyAction && <a className="quiet" href={replyHref || '/post/' + p.id + '?reply=1'}>{replyLabel}</a>}
      {reportHref && <a className="quiet report-link" href={reportHref}>report</a>}
      {showOwnerActions && user?.id === p.user_id && <div className="post-actions">
        <a className="quiet" href={'/post/' + p.id + '/edit'}>edit</a>
        <a className="quiet danger" href={'/post/' + p.id + '/delete'}>delete</a>
      </div>}
    </div>
    <p dangerouslySetInnerHTML={{ __html: linkify(p.body) }} />
    {parent && <blockquote className={'parent-quote' + (parent.deleted_at ? ' deleted-parent' : '')}>
      {parent.deleted_at
        ? <a href={'/post/' + parent.id}>(deleted)</a>
        : <>
          <div className="parent-quote-top">
            <a className="postauthor" href={'/u/' + parent.handle}>@{parent.handle}</a>
            <a className="postdate" href={'/post/' + parent.id}>
              <time dateTime={parent.created_at} title={fmtFull(parent.created_at)}>{fmt(parent.created_at)}</time>
              {parent.reply_count > 0 && <span> · {parent.reply_count} {parent.reply_count === 1 ? 'reply' : 'replies'}</span>}
            </a>
          </div>
          <p dangerouslySetInnerHTML={{ __html: linkify(parent.body) }} />
        </>}
    </blockquote>}
  </article>
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
      FROM thread ORDER BY created_at ASC,id ASC`).all(parentId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId) as (PostView & { depth: number })[]
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
    return <div className="reply-branch">
      {branch.map(reply => reply.deleted_at
        ? <React.Fragment key={reply.id}>{renderBranch(reply.id, depth + 1)}</React.Fragment>
        : <div className="reply-node" key={reply.id}>
          <Post p={reply} user={user} showParent={false}
            replyHref={user ? undefined : '/login?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1')}
            replyLabel={user ? 'reply' : 'log in to reply'} />
          {renderBranch(reply.id, depth + 1)}
        </div>)}
    </div>
  }
  return renderBranch(parentId, 1)
}
