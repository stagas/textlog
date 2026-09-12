import React from 'preact/compat'

function replyOffset(depth: number) {
  return depth === 0 ? '0px' : `calc(${Array(depth).fill('clamp(18px, 3vw, 28px)').join(' + ')})`
}

export function ThreadLockedNotice() {
  return <div className="thread-locked-notice" role="status">Thread is locked for new replies</div>
}

export function ThreadReplySlot({ depth = 0, locked = false, className = '', replyPostId, children }: {
  depth?: number
  locked?: boolean
  className?: string
  replyPostId?: number
  children?: React.ReactNode
}) {
  if (!locked && depth === 0) return <>{children}</>
  return (
    <div data-reply-post-id={replyPostId} className={`inline-reply-compose${
      locked ? ' thread-locked-reply-notice' : ''}${
      className ? ` ${className}` : ''
    }`} style={{ '--reply-offset': replyOffset(depth) } as React.CSSProperties}>
      {locked ? <ThreadLockedNotice /> : children}
    </div>
  )
}
