import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Feed, groupSimilarActivities } from './components/feed'
import { HotFeed } from './components/hot-feed'
import { FeedThreads, postAgeTitle } from './components/post'
import { PublicFeed } from './components/public-feed'
import type { ParentPost, PersonalizedTimelineRow } from './types'

function postActivity(id: number, actorId: number, handle: string): PersonalizedTimelineRow {
  const post = {
    id,
    user_id: actorId,
    parent_id: null,
    body: `note by ${handle}`,
    created_at: '2026-08-19 10:00:00',
    deleted_at: null,
    handle,
    reply_count: 0,
  }
  return {
    ...post,
    activity_kind: 'post',
    event_key: `post:${id}`,
    actor_id: actorId,
    actor_handle: handle,
    actor_bio: '',
    target_handle: null,
    target_tag: null,
    target_bio: null,
    following: true,
    target_is_viewer: false,
    targeted_to_viewer: false,
    posts: null,
    unread: 0,
    renderedPost: post,
  }
}

test('activity details compact only consecutive actions by the same actor', () => {
  const followActivity = (id: number, actorId: number): PersonalizedTimelineRow => ({
    ...postActivity(id, actorId, `person-${actorId}`),
    activity_kind: 'tag_follow',
    event_key: `tag_follow:${id}`,
    target_tag: `tag-${id}`,
  })
  const first = followActivity(1, 2)
  const sameActor = followActivity(2, 2)
  const differentActor = followActivity(3, 3)

  expect(groupSimilarActivities([first, sameActor])).toEqual([
    { rows: [first, sameActor], collapsible: true },
  ])
  expect(groupSimilarActivities([first, differentActor])).toEqual([
    { rows: [first], collapsible: true },
    { rows: [differentActor], collapsible: true },
  ])
})

test('feed pages reconstruct threads with available off-page ancestors', () => {
  const root = { id: 10, user_id: 2, parent_id: null, body: 'root note', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 2 }
  const reply = { id: 11, user_id: 3, parent_id: 10, body: 'page reply', created_at: '2026-08-19 11:00:00',
    deleted_at: null, handle: 'bob', reply_count: 0, parent: { ...root, reply_count: 2 } }
  const orphan = { id: 12, user_id: 4, parent_id: 99, body: 'parent is off page', created_at: '2026-08-19 12:00:00',
    deleted_at: null, handle: 'cara', reply_count: 0,
    parent: { ...root, id: 99, body: 'off-page parent', reply_count: 1 } }
  const html = renderToStaticMarkup(
    <PublicFeed feed={{ posts: [reply, orphan, root], page: 1, totalItems: 3, totalPages: 1 }} path="/latest" />,
  )

  expect(html.match(/id="post-10"/g)).toHaveLength(1)
  expect(html.match(/id="post-11"/g)).toHaveLength(1)
  expect(html.match(/id="post-12"/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(2)
  expect(html.indexOf('id="post-10"')).toBeLessThan(html.indexOf('id="post-11"'))
  expect(html.indexOf('id="post-10"')).toBeLessThan(html.indexOf('id="post-12"'))
  expect(html.indexOf('id="post-99"')).toBeLessThan(html.indexOf('id="post-12"'))
  expect(html.match(/off-page parent/g)).toHaveLength(1)
  expect(html).toContain('class="reply-branch"')
  expect(html).toContain(
    'class="post-hit-area" href="/post/10?from=%2Flatest%23post-11#post-11"',
  )
  expect(html).not.toContain('id="feed-thread-fold-10"')
  expect(html).not.toContain('for="feed-thread-fold-10"')
  expect(html).not.toContain('post-continuation-marker')
})

test('latest renders independent unread controls, thread dots, and directed highlights', () => {
  const root = { id: 70, user_id: 2, parent_id: null, body: 'unread root', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 1 }
  const reply = { id: 71, user_id: 3, parent_id: 70, body: 'directed unread reply', created_at: '2026-08-19 11:00:00',
    deleted_at: null, handle: 'bob', reply_count: 0, parent: root }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(<PublicFeed user={user} path="/all" feed={{
    posts: [reply, root],
    page: 1,
    totalItems: 6,
    totalPages: 3,
    latestUnread: true,
    latestCount: 4,
    unreadPostIds: [70, 71],
    directedUnreadPostIds: [71],
    unreadHref: '/all?page=2#post-60',
    lastUnreadHref: '/all?page=3#post-50',
  }} />)

  expect(html.match(/class="unread-dot" aria-label="unread"/g)).toHaveLength(2)
  expect(html).toContain('class="post tappable-post activity-item-directed-unread" id="post-71"')
  expect(html).toContain('href="/all?page=2#post-60">first unread</a>')
  expect(html).toContain('href="/all?page=3#post-50">last unread</a>')
  expect(html).toContain('action="/all/read-all"')
  expect(html).toContain('all<span class="to-me-count">4</span>')
})

test('a deep unread reply moves its root first and compresses read ancestors', () => {
  const root = { id: 100, user_id: 2, parent_id: null, body: 'active root', created_at: '2026-08-19 08:00:00',
    deleted_at: null, handle: 'alice', reply_count: 4 }
  const readAncestor = { ...root, id: 101, parent_id: root.id, body: 'read ancestor', parent: root }
  const immediate = { ...root, id: 102, parent_id: readAncestor.id, body: 'immediate parent', parent: readAncestor }
  const unreadReply = { ...root, id: 103, user_id: 3, parent_id: immediate.id, body: 'new unread reply',
    created_at: '2026-08-19 12:00:00', handle: 'bob', reply_count: 0, parent: immediate }
  const otherRoot = { ...root, id: 104, body: 'other root', created_at: '2026-08-19 11:00:00' }
  const html = renderToStaticMarkup(
    <PublicFeed feed={{ posts: [unreadReply, otherRoot], page: 1, totalItems: 2, totalPages: 1, unreadPostIds: [103] }}
      path="/latest" />,
  )

  expect(html.indexOf('active root')).toBeLessThan(html.indexOf('other root'))
  expect(html).not.toContain('read ancestor')
  expect(html).toContain('href="/post/100?from=%2Flatest%3Fexpand%3D100%23post-100" aria-label="Earlier replies omitted" rel="nofollow">…</a>')
  expect(html.indexOf('immediate parent')).toBeLessThan(html.indexOf('new unread reply'))
})

test('collapsed conversations render unread ancestors as posts instead of hidden quote paths', () => {
  const root = { id: 200, user_id: 2, parent_id: null, body: 'top level', created_at: '2026-08-19 08:00:00',
    deleted_at: null, handle: 'alice', reply_count: 4 }
  const unread = { ...root, id: 201, parent_id: 200, body: 'actual unread reply',
    created_at: '2026-08-19 09:00:00', parent: root }
  const quotedPath = { ...root, id: 202, parent_id: 201, body: 'quoted path',
    created_at: '2026-08-19 10:00:00', parent: unread }
  const recent = { ...root, id: 203, parent_id: 202, body: 'recent reply',
    created_at: '2026-08-19 11:00:00', parent: quotedPath }
  const newest = { ...root, id: 204, parent_id: 203, body: 'newest reply', reply_count: 0,
    created_at: '2026-08-19 12:00:00', parent: recent }
  const html = renderToStaticMarkup(<PublicFeed path="/latest" feed={{
    posts: [newest, recent, unread, root], page: 1, totalItems: 1, totalPages: 1, unreadPostIds: [201],
  }} />)

  expect(html.match(/collapsed-preview-post/g)).toHaveLength(3)
  expect(html).toMatch(/collapsed-preview-post[^>]*>.*?id="post-201"/s)
  expect(html).toContain('<div class="reply-node collapsed-preview-path"><a class="quiet thread-ancestor-gap post-continuation-link"')
})

test('a feed branch root continues when its retained quoted parent has the same author', () => {
  const parent = { id: 2547, user_id: 490, parent_id: null, body: 'Earlier thought',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'jg', reply_count: 1 }
  const branchRoot = { id: 2553, user_id: 490, parent_id: null, parent, body: 'Upon further reflection',
    created_at: '2026-08-19 11:00:00', deleted_at: null, handle: 'jg', reply_count: 0,
    feed_branch_root: true }
  const html = renderToStaticMarkup(<PublicFeed path="/latest" feed={{
    posts: [branchRoot], page: 1, totalItems: 1, totalPages: 1,
  }} />)
  const quoteStart = html.indexOf('<blockquote class="parent-quote')
  const quoteEnd = html.indexOf('</blockquote>', quoteStart)

  expect(html.slice(0, quoteStart)).toContain('<span class="post-context">continued:</span>')
  expect(html.slice(quoteStart, quoteEnd)).toContain('<span class="post-context">wrote:</span>')
  expect(html.slice(0, quoteStart)).not.toContain('<span class="post-context">wrote:</span>')
})

test('latest shows approximate age wording only for unread post metadata', () => {
  const createdAt = new Date(Date.now() - 6 * 60 * 60_000).toISOString()
  const unread = { id: 72, user_id: 2, parent_id: null, body: 'unread note', created_at: createdAt, deleted_at: null,
    handle: 'alice', reply_count: 0 }
  const read = { ...unread, id: 73, body: 'read note' }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(<PublicFeed user={user} path="/all" feed={{
    posts: [unread, read],
    page: 1,
    totalItems: 2,
    totalPages: 1,
    unreadPostIds: [72],
    directedUnreadPostIds: [],
  }} />)

  expect(html).toContain(`title="${postAgeTitle(createdAt)}">wrote recently:</span>`)
  expect(html).toContain('id="post-73"')
  expect(html.match(/wrote recently/g)).toHaveLength(1)
})

test('latest keeps the arrival count but hides read actions when the rendered page consumes every unread', () => {
  const post = { id: 80, user_id: 2, parent_id: null, body: 'just read', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 0 }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(<PublicFeed user={user} path="/latest" feed={{
    posts: [post],
    page: 1,
    totalItems: 1,
    totalPages: 1,
    latestUnread: false,
    latestCount: 1,
    unreadPostIds: [80],
    directedUnreadPostIds: [],
  }} />)

  expect(html).toContain('class="unread-dot" aria-label="unread"')
  expect(html).toContain('all<span class="to-me-count">1</span>')
  expect(html).not.toContain('action="/all/read-all"')
})

test('latest gives unread dots to a reply and its promoted off-page parent', () => {
  const parent = { id: 90, user_id: 2, parent_id: null, body: 'off-page unread parent',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'alice', reply_count: 1 }
  const reply = { id: 91, user_id: 3, parent_id: 90, body: 'reply on this page', created_at: '2026-08-19 11:00:00',
    deleted_at: null, handle: 'bob', reply_count: 0, parent }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(<PublicFeed user={user} path="/latest" feed={{
    posts: [reply],
    page: 1,
    totalItems: 1,
    totalPages: 1,
    latestUnread: false,
    latestCount: 0,
    unreadPostIds: [90, 91],
    directedUnreadPostIds: [],
  }} />)

  expect(html.match(/class="unread-dot" aria-label="unread"/g)).toHaveLength(2)
  expect(html).toContain('id="post-90"')
  expect(html).not.toContain('class="parent-quote"')
})

test('latest and hot omit the view toggle', () => {
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeCount: 2 }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  expect(renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/latest" />)).not.toContain('>flat</a>')
  expect(renderToStaticMarkup(<HotFeed user={user} feed={feed} />)).not.toContain('>flat</a>')
})

test('anonymous public feeds omit view toggles', () => {
  const feed = { posts: [], page: 2, totalItems: 2, totalPages: 2 }
  const latest = renderToStaticMarkup(<PublicFeed feed={feed} path="/latest" />)
  const hot = renderToStaticMarkup(<HotFeed user={null} feed={feed} />)

  expect(latest).not.toContain('>flat</a>')
  expect(hot).not.toContain('>flat</a>')
})

test('anonymous hot, all, and any feeds expand conversations by default', () => {
  const root = { id: 1, user_id: 2, parent_id: null, body: 'root', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 3 }
  const replies = [1, 2, 3].map((offset) => ({
    id: offset + 1,
    user_id: offset + 2,
    parent_id: root.id,
    body: `reply ${offset}`,
    created_at: `2026-08-19 ${9 + offset}:00:00`,
    deleted_at: null,
    handle: `person-${offset}`,
    reply_count: 0,
    parent: root,
  }))
  const feed = { posts: [root, ...replies], page: 1, totalItems: 4, totalPages: 1 }

  for (const html of [
    renderToStaticMarkup(<HotFeed user={null} feed={feed} />),
    renderToStaticMarkup(<PublicFeed path="/all" feed={feed} />),
    renderToStaticMarkup(<PublicFeed path="/any" feed={feed} />),
  ]) {
    expect(html).toContain('id="feed-thread-fold-1"')
    expect(html).not.toContain('id="feed-thread-fold-1" checked=""')
  }

  const signedIn = renderToStaticMarkup(<PublicFeed user={{ id: 1, handle: 'reader', email: 'reader@example.com',
    bio: '' }} path="/all" feed={feed} />)
  expect(signedIn).toContain('id="feed-thread-fold-1" checked=""')
})

test('feed tree roots retain ASCII-art rendering', () => {
  const post = { id: 20, user_id: 2, parent_id: null, body: ' /\\_/\\\n( o.o )\n#ascii',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'alice', reply_count: 0 }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [post], page: 1, totalItems: 1, totalPages: 1 }} />)

  expect(html).toContain('class="post-body ascii-art"')
})

test('standalone feed posts with replies omit redundant footer dots', () => {
  const post = { id: 21, user_id: 2, parent_id: null, body: 'root only', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 3 }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [post], page: 1, totalItems: 1, totalPages: 1 }} />)

  expect(html).not.toContain('post-continuation-marker')
  expect(html).not.toContain('feed-thread-fold-21')
})

test('to-me renders sibling reply activities as separate chronological entries', () => {
  const parent = { id: 25, user_id: 1, parent_id: null, body: 'one shared parent', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'reader', reply_count: 2 }
  const activity = (id: number, handle: string): PersonalizedTimelineRow => ({
    ...postActivity(id, id, handle),
    parent_id: parent.id,
    parent,
    activity_kind: 'reply',
    renderedPost: { ...postActivity(id, id, handle), parent_id: parent.id, parent },
  })
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [activity(27, 'cara'), activity(26, 'bob')], page: 1, totalPages: 1, toMeCount: 2, forYouCount: 0,
      forYouUnread: false, toMeUnread: true }}
    toMe
  />)

  expect(html.match(/one shared parent/g)).toHaveLength(2)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(2)
  expect(html.indexOf('note by cara')).toBeLessThan(html.indexOf('note by bob'))
})

test('threaded activity replies retain their unread dots', () => {
  const root = postActivity(28, 2, 'alice')
  const parent = { ...root.renderedPost!, reply_count: 0 }
  const childBase = postActivity(29, 3, 'bob')
  const child: PersonalizedTimelineRow = {
    ...childBase,
    parent_id: root.id,
    parent,
    activity_kind: 'reply',
    unread: 1,
    targeted_to_viewer: true,
    renderedPost: { ...childBase.renderedPost!, parent_id: root.id, parent },
  }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [child, root], page: 1, totalPages: 1, toMeCount: 1, forYouCount: 1, forYouUnread: true,
      toMeUnread: true }}
    toMe
  />)

  expect(html.match(/class="unread-dot" aria-label="unread"/g)).toHaveLength(1)
  expect(html).toContain('class="post tappable-post activity-item-directed-unread" id="post-29"')
  expect(html.indexOf('id="post-29"')).toBeLessThan(html.indexOf('class="unread-dot" aria-label="unread"'))
})

test('feed trees render a shared off-page parent once for sibling replies', () => {
  const parent = { id: 30, user_id: 2, parent_id: null, body: 'shared context', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 2 }
  const reply = (id: number, handle: string) => ({ id, user_id: id, parent_id: parent.id, body: `${handle} reply`,
    created_at: `2026-08-19 1${id - 30}:00:00`, deleted_at: null, handle, reply_count: 0, parent })
  const html = renderToStaticMarkup(
    <PublicFeed feed={{ posts: [reply(32, 'cara'), reply(31, 'bob')], page: 1, totalItems: 2, totalPages: 1 }} />,
  )

  expect(html.match(/shared context/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(1)
  expect(html.match(/class="parent-quote/g)).toBeNull()
  expect(html.indexOf('id="post-30"')).toBeLessThan(html.indexOf('id="post-32"'))
  expect(html.indexOf('id="post-31"')).toBeLessThan(html.indexOf('id="post-32"'))
})

test('feed trees promote a shared parent when only one sibling carries the quoted record', () => {
  const parent = { id: 494, user_id: 2, parent_id: null, body: 'shared parent 494',
    created_at: '2026-08-08 14:20:43', deleted_at: null, handle: 'alice', reply_count: 2 }
  const older = { id: 496, user_id: 3, parent_id: parent.id, body: 'older reply',
    created_at: '2026-08-08 14:25:42', deleted_at: null, handle: 'bob', reply_count: 0, parent: null }
  const newer = { id: 549, user_id: 4, parent_id: parent.id, body: 'newer reply',
    created_at: '2026-08-08 18:55:52', deleted_at: null, handle: 'cara', reply_count: 0, parent }
  const html = renderToStaticMarkup(
    <FeedThreads posts={[newer, older]} user={null} returnPath="/tag/example" />,
  )

  expect(html.match(/shared parent 494/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(1)
  expect(html.match(/class="parent-quote/g)).toBeNull()
  expect(html.indexOf('id="post-494"')).toBeLessThan(html.indexOf('id="post-496"'))
  expect(html.indexOf('id="post-496"')).toBeLessThan(html.indexOf('id="post-549"'))
})

test('feed trees suppress deleted top-level post 2878 and all of its children', () => {
  const deletedRoot = { id: 2878, user_id: 2, parent_id: null, body: 'deleted root',
    created_at: '2026-08-30 02:48:06', deleted_at: '2026-08-31 15:23:18', handle: 'deleted-453',
    reply_count: 2 }
  const child = (id: number, handle: string, created_at: string) => ({
    id, user_id: id, parent_id: deletedRoot.id, body: `${handle} visible reply`, created_at,
    deleted_at: null, handle, reply_count: 0, parent: deletedRoot, feed_branch_root: true,
    feed_collapsed_preview: true,
  })
  const html = renderToStaticMarkup(
    <PublicFeed user={{ id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }} path="/all"
      feed={{ posts: [child(2887, 'paratoner', '2026-08-30 06:30:32'),
        child(2886, 'stagas', '2026-08-30 05:59:23')], page: 1, totalItems: 1, totalPages: 1 }} />,
  )

  expect(html).not.toContain('id="post-2878"')
  expect(html).not.toContain('(deleted post)')
  expect(html).not.toContain('id="post-2886"')
  expect(html).not.toContain('id="post-2887"')
  expect(html).not.toContain('class="post-page-thread feed-thread"')
})

test('latest joins promoted branches beneath their shared grandparent', () => {
  const root = { id: 494, user_id: 2, parent_id: null, body: 'shared conversation root',
    created_at: '2026-08-08 14:20:43', deleted_at: null, handle: 'alice', reply_count: 2 }
  const left = { id: 496, user_id: 3, parent_id: root.id, body: 'left branch',
    created_at: '2026-08-08 14:25:42', deleted_at: null, handle: 'bob', reply_count: 1, parent: root }
  const right = { id: 549, user_id: 4, parent_id: root.id, body: 'right branch',
    created_at: '2026-08-08 18:55:52', deleted_at: null, handle: 'cara', reply_count: 1, parent: root }
  const leftReply = { id: 2516, user_id: 5, parent_id: left.id, body: 'new left reply',
    created_at: '2026-08-26 05:27:01', deleted_at: null, handle: 'dan', reply_count: 0, parent: left }
  const rightReply = { id: 2432, user_id: 6, parent_id: right.id, body: 'new right reply',
    created_at: '2026-08-25 13:30:21', deleted_at: null, handle: 'erin', reply_count: 0, parent: right }
  const html = renderToStaticMarkup(
    <PublicFeed path="/latest"
      feed={{ posts: [leftReply, rightReply], page: 1, totalItems: 1, totalPages: 1 }} />,
  )

  expect(html.match(/shared conversation root/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(1)
  expect(html.match(/class="parent-quote/g)).toBeNull()
  expect(html.indexOf('id="post-494"')).toBeLessThan(html.indexOf('id="post-496"'))
  expect(html.indexOf('id="post-496"')).toBeLessThan(html.indexOf('id="post-2516"'))
  expect(html.indexOf('id="post-549"')).toBeLessThan(html.indexOf('id="post-2432"'))
})

test('collapsed latest keeps a visible newest reply nested beneath its visible parent', () => {
  const root = { id: 494, user_id: 2, parent_id: null, body: 'conversation root',
    created_at: '2026-08-08 14:20:43', deleted_at: null, handle: 'alice', reply_count: 3 }
  const branch = { id: 496, user_id: 3, parent_id: root.id, body: 'branch',
    created_at: '2026-08-08 14:25:42', deleted_at: null, handle: 'bob', reply_count: 2, parent: root }
  const parent = { id: 2516, user_id: 4, parent_id: branch.id, body: 'visible parent',
    created_at: '2026-08-26 05:27:01', deleted_at: null, handle: 'cara', reply_count: 1, parent: branch }
  const child = { id: 2582, user_id: 5, parent_id: parent.id, body: 'visible child',
    created_at: '2026-08-26 18:34:27', deleted_at: null, handle: 'dan', reply_count: 0, parent }
  const html = renderToStaticMarkup(
    <PublicFeed path="/latest"
      feed={{ posts: [child, parent, branch, root], page: 1, totalItems: 1, totalPages: 1 }} />,
  )

  expect(html).toContain('id="feed-thread-fold-494" checked=""')
  expect(html).toMatch(/reply-node collapsed-preview-path collapsed-preview-post[^>]*>[\s\S]*?id="post-2516"[\s\S]*?reply-branch[\s\S]*?reply-node collapsed-preview-path collapsed-preview-post[^>]*>[\s\S]*?id="post-2582"/)
})

test('collapsed latest strongly favors two recent direct replies over a deep run', () => {
  const root = { id: 1495, user_id: 2, parent_id: null, body: 'conversation root',
    created_at: '2026-08-16 14:10:58', deleted_at: null, handle: 'alice', reply_count: 5, direct_reply_count: 2 }
  const directOlder = { id: 2904, user_id: 3, parent_id: root.id, body: 'older direct',
    created_at: '2026-08-30 13:20:03', deleted_at: null, handle: 'bob', reply_count: 0, parent: root,
    feed_collapsed_preview: true }
  const directNewest = { id: 2953, user_id: 4, parent_id: root.id, body: 'newer direct',
    created_at: '2026-08-31 15:42:10', deleted_at: null, handle: 'cara', reply_count: 3, parent: root,
    feed_collapsed_preview: true }
  const intermediateOne = { id: 2954, user_id: 5, parent_id: directNewest.id, body: 'intermediate one',
    created_at: '2026-08-31 15:47:09', deleted_at: null, handle: 'dan', reply_count: 2, parent: directNewest }
  const intermediateTwo = { id: 2955, user_id: 6, parent_id: intermediateOne.id, body: 'intermediate two',
    created_at: '2026-08-31 15:53:24', deleted_at: null, handle: 'erin', reply_count: 1,
    parent: intermediateOne }
  const newest = { id: 2956, user_id: 7, parent_id: intermediateTwo.id, body: 'newest deep reply',
    created_at: '2026-08-31 15:54:59', deleted_at: null, handle: 'dan', reply_count: 0,
    parent: intermediateTwo }
  const html = renderToStaticMarkup(
    <PublicFeed path="/latest"
      feed={{ posts: [newest, intermediateTwo, intermediateOne, directNewest, directOlder, root],
        page: 1, totalItems: 1, totalPages: 1 }} />,
  )

  expect(html.match(/collapsed-preview-post/g)).toHaveLength(2)
  expect(html.indexOf('id="post-2904"')).toBeLessThan(html.indexOf('id="post-2953"'))
  expect(html).toMatch(/id="post-2953"[\s\S]*?<div class="reply-branch collapsed-preview-path-branch"[^>]*>[\s\S]*?aria-label="Expand hidden replies"[^>]*>…<\/label>[\s\S]*?id="post-2954"/)
})

test('threaded feed replies omit redundant footer dots', () => {
  const root = { id: 40, user_id: 2, parent_id: null, body: 'root', created_at: '2026-08-19 09:00:00', deleted_at: null,
    handle: 'alice', reply_count: 3 }
  const reply = { id: 41, user_id: 3, parent_id: root.id, body: 'visible reply', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'bob', reply_count: 2, parent: root }
  const html = renderToStaticMarkup(
    <PublicFeed feed={{ posts: [reply, root], page: 1, totalItems: 2, totalPages: 1 }} path="/latest" />,
  )

  expect(html).not.toContain('post-continuation-marker')
})

test('threaded feed replies do not show more when every descendant is visible', () => {
  const root = { id: 45, user_id: 2, parent_id: null, body: 'root', created_at: '2026-08-19 09:00:00', deleted_at: null,
    handle: 'alice', reply_count: 3 }
  const reply = { id: 46, user_id: 3, parent_id: root.id, body: 'visible reply', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'bob', reply_count: 1, parent: root }
  const child = { id: 47, user_id: 4, parent_id: reply.id, body: 'visible child', created_at: '2026-08-19 11:00:00',
    deleted_at: null, handle: 'cara', reply_count: 0, parent: reply }
  const html = renderToStaticMarkup(
    <PublicFeed feed={{ posts: [child, reply, root], page: 1, totalItems: 3, totalPages: 1 }} path="/latest" />,
  )

  expect(html).toContain('id="post-47"')
  expect(html).not.toMatch(/id="post-46"[\s\S]*?aria-label="more replies">…<\/span>/)
})

test('for-you does not render author hide-all controls', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice'), postActivity(11, 3, 'bob')], page: 1, totalPages: 1, toMeCount: 0,
      forYouCount: 0, forYouUnread: false, toMeUnread: false }}
  />)

  expect(html).not.toContain('for-you-author-filters')
  expect(html).not.toContain('for-you-hide-input')
  expect(html).not.toContain('hide all posts by')
  expect(html).toContain('for-you-item for-you-author-2')
  expect(html).not.toContain(':has(.for-you-hide-2:checked)')
})

test('for-you renders a single author without a filter shell', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice')], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 0,
      forYouUnread: false, toMeUnread: false }}
  />)

  expect(html).not.toContain('for-you-filter-shell')
  expect(html).not.toContain('for-you-hide-action')
})

test('for-you labels a descendant that replies to its own author as continued', () => {
  const parent = { id: 10, user_id: 2, parent_id: 9, body: 'earlier reply', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 1 }
  const activity = {
    ...postActivity(11, 2, 'alice'),
    parent_id: parent.id,
    parent,
    activity_kind: 'post' as const,
    targeted_to_viewer: false,
    unread: 1,
    renderedPost: { ...postActivity(11, 2, 'alice'), parent_id: parent.id, parent },
  }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [activity], page: 1, totalPages: 1, toMeCount: 1, forYouCount: 1, forYouUnread: false,
      toMeUnread: true }}
  />)

  expect(html).toMatch(/continued [^<]+ ago:<\/span>/)
  expect(html).not.toContain('replied to you:')
})

test('for-you positions a root by its newest deep reply when timeline ancestors are missing', () => {
  const rootRow = postActivity(120, 2, 'alice')
  rootRow.created_at = '2026-08-19 08:00:00'
  const root: ParentPost = { id: rootRow.id, user_id: rootRow.user_id, parent_id: null,
    body: 'active conversation root', created_at: rootRow.created_at, deleted_at: null, handle: rootRow.handle,
    reply_count: 3 }
  rootRow.renderedPost = { ...rootRow.renderedPost!, ...root }
  const missingAncestor: ParentPost = { ...root, id: 121, parent_id: root.id, body: 'omitted ancestor', parent: root }
  const immediate: ParentPost = { ...root, id: 122, parent_id: missingAncestor.id, body: 'immediate context',
    parent: missingAncestor }
  const deepRow = postActivity(123, 3, 'bob')
  deepRow.parent_id = immediate.id
  deepRow.created_at = '2026-08-19 12:00:00'
  deepRow.unread = 1
  deepRow.renderedPost = { ...deepRow.renderedPost!, parent_id: immediate.id, parent: immediate,
    body: 'newest deep reply', created_at: deepRow.created_at }
  const earlier = postActivity(124, 4, 'cara')
  earlier.created_at = '2026-08-19 11:00:00'
  earlier.renderedPost = { ...earlier.renderedPost!, body: 'earlier standalone post', created_at: earlier.created_at }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [deepRow, earlier, rootRow], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 1,
      forYouUnread: true, toMeUnread: false }}
  />)

  expect(html.match(/active conversation root/g)).toHaveLength(1)
  expect(html.indexOf('active conversation root')).toBeLessThan(html.indexOf('earlier standalone post'))
  expect(html).not.toContain('omitted ancestor')
  expect(html).toContain('newest deep reply')
})

test('for-you does not put hide actions on follow activity', () => {
  const followActivity = {
    ...postActivity(12, 4, 'carol'),
    activity_kind: 'user_follow' as const,
    event_key: 'user-follow:12',
    target_handle: 'dave',
    target_bio: '',
    renderedPost: undefined,
  }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice'), followActivity], page: 1, totalPages: 1, toMeCount: 0,
      forYouCount: 0, forYouUnread: false, toMeUnread: false }}
  />)

  expect(html).not.toContain('for-you-hide-input for-you-hide-4')
  expect(html).not.toContain(':has(.for-you-hide-4:checked) .for-you-author-4')
  expect(html).toContain('>@dave</a>')
  expect(html).not.toContain('>@dave.</a>')
  expect(html).toContain('<span class="activity-follow-full-stop">.</span>')
})

test('activity targets do not duplicate their details in hovercards', () => {
  const followActivity = {
    ...postActivity(12, 4, 'carol'),
    activity_kind: 'user_follow' as const,
    event_key: 'user-follow:12',
    target_handle: 'dave',
    target_bio: 'Dave builds things',
    renderedPost: undefined,
  }
  const signupActivity = {
    ...postActivity(13, 5, 'erin'),
    activity_kind: 'signup' as const,
    event_key: 'signup:13',
    target_bio: 'Erin builds things',
    renderedPost: undefined,
  }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }

  const followHtml = renderToStaticMarkup(
    <Feed user={user}
      data={{ timeline: [followActivity], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 0, forYouUnread: false,
        toMeUnread: false }} />,
  )
  const signupHtml = renderToStaticMarkup(
    <Feed user={user}
      data={{ timeline: [signupActivity], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 0, forYouUnread: false,
        toMeUnread: false }} />,
  )

  expect(followHtml).toContain('href="/u/dave?from=%2Fmy-feed%23a-')
  expect(followHtml).not.toContain('<span class="reference-popover-bio">Dave builds things</span>')
  expect(signupHtml).toContain('href="/u/erin?from=%2Fmy-feed%23a-')
  expect(signupHtml).toContain('signed up.')
  expect(signupHtml).not.toContain('/admin/users/5')
  expect(signupHtml).not.toContain('reference-menu-popover')
  const signupActivityHtml = signupHtml.match(/<article class="activity-follow"[\s\S]*?<\/article>/)?.[0]
  expect(signupActivityHtml).toBeDefined()
  expect(signupActivityHtml).not.toContain('<button')
  expect(signupActivityHtml).not.toContain('<form')
  expect(signupActivityHtml).not.toContain('follows you')
})

test('activity bios enrich hashtag and mention references with hovercards', () => {
  const followActivity = {
    ...postActivity(12, 4, 'carol'),
    activity_kind: 'user_follow' as const,
    event_key: 'user-follow:references',
    target_handle: 'dave',
    target_bio: 'Builds #tools with @alice',
    targetBioReferences: {
      hashtagCounts: { tools: 3 },
      hashtagFollowerCounts: { tools: 2 },
      hashtagFollowing: { tools: false },
      mentionBios: { alice: 'Makes useful things' },
      mentionNoteCounts: { alice: 4 },
      mentionProfileStats: { alice: { notes: 4, replies: 0, followers: 2, following: 1, followingTags: 0 } },
      mentionFollowing: { alice: false },
      mentionFollowsViewer: { alice: false },
      linkPreviews: {},
    },
    renderedPost: undefined,
  }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const html = renderToStaticMarkup(
    <Feed user={user}
      data={{ timeline: [followActivity], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 0, forYouUnread: false,
        toMeUnread: false }} />,
  )

  expect(html).toContain('class="reference-menu-popover reference-menu-popover-tag"')
  expect(html).toContain('Makes useful things')
  expect(html).toContain('action="/tag-follow/tools"')
  expect(html).toContain('action="/follow/alice"')
})

test('a followed-you event offers to follow back', () => {
  const followActivity = {
    ...postActivity(12, 4, 'carol'),
    activity_kind: 'user_follow' as const,
    event_key: 'user-follow:12',
    target_handle: null,
    target_bio: '',
    target_is_viewer: true,
    targeted_to_viewer: true,
    actor_bio: 'Carol builds things',
    following: false,
    actorFollowsViewer: true,
    renderedPost: undefined,
  }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [followActivity], page: 1, totalPages: 1, toMeCount: 1, forYouCount: 0, forYouUnread: false,
      toMeUnread: true }}
  />)

  expect(html).toContain('>follow back</button>')
  expect(html).toContain('href="/u/carol?from=%2Fmy-feed%23a-IEy7ZWXnSxMC"')
  expect(html).not.toContain('reference-menu-popover')
  expect(html).toContain('</div><form action="/follow/carol" method="post"><input type="hidden" '
    + 'name="from" value="/my-feed#a-IEy7ZWXnSxMC"/><button class="button">follow back</button>')
})

test('for-you does not put hide actions on posts by people', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice')], page: 1, totalPages: 1, toMeCount: 0, forYouCount: 0,
      forYouUnread: false, toMeUnread: false }}
  />)

  expect(html).not.toContain('for-you-hide-action')
  expect(html).not.toContain('for-you-filter-shell')
})

test('secondary for-you pages retain top pagination with hide actions', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice'), postActivity(11, 3, 'bob')], page: 2, totalPages: 3, toMeCount: 0,
      forYouCount: 0, forYouUnread: false, toMeUnread: false }}
  />)

  expect(html).toContain('pagination pagination-top')
  expect(html.indexOf('pagination pagination-top')).toBeLessThan(html.indexOf('for-you-item for-you-author-2'))
})

test('first for-you page shows top pagination when the first unread item is on a later page', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice'), postActivity(11, 3, 'bob')], page: 1, totalPages: 3, toMeCount: 0,
      forYouCount: 1, forYouUnread: true, toMeUnread: false, unreadHref: '/my-feed?page=2#post-20' }}
  />)

  expect(html).toContain('pagination pagination-top')
})

test('for-you offers links to the first and last unread activity', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice')], page: 1, totalPages: 3, toMeCount: 0, forYouCount: 2,
      forYouUnread: true, toMeUnread: false, unreadHref: '/my-feed?page=2#post-20',
      lastUnreadHref: '/my-feed?page=3#post-30' }}
  />)

  expect(html).toContain('<span class="activity-side-status">jump to</span>')
  expect(html).toContain('href="/my-feed?page=2#post-20">first unread</a>')
  expect(html).toContain('href="/my-feed?page=3#post-30">last unread</a>')
})

test('to-me omits hide actions and keeps top pagination before entries', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    toMe
    path="/@"
    data={{ timeline: [postActivity(10, 2, 'alice'), postActivity(11, 3, 'bob')], page: 1, totalPages: 3, toMeCount: 2,
      forYouCount: 2, forYouUnread: false, toMeUnread: true, unreadHref: '/@?page=2#post-20' }}
  />)

  expect(html).not.toContain('for-you-hide-input')
  expect(html.indexOf('pagination pagination-top')).toBeLessThan(html.indexOf('for-you-item for-you-author-2'))
  expect(html).toContain('href="/@?page=2#post-20">unread</a>')
  expect(html).not.toContain('>first unread</a>')
  expect(html).not.toContain('>last unread</a>')
  expect(html).toContain('action="/@/read-all"')
})

test('hot and latest show the to-me tab with its unread count', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeUnread: true, toMeCount: 3 }

  for (const html of [
    renderToStaticMarkup(<HotFeed user={user} feed={feed} />),
    renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/all" />),
  ]) {
    expect(html).toContain('href="/@">@<span class="to-me-count">3</span></a>')
  }
})

test('tab counters cap counts at 99+', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeUnread: true, toMeCount: 99,
    forYouCount: 1234, latestCount: 100 }
  const html = renderToStaticMarkup(<HotFeed user={user} feed={feed} />)

  expect(html).toContain('href="/@">@<span class="to-me-count">99+</span></a>')
  expect(html).toContain('my feed<span class="to-me-count">99+</span></a>')
  expect(html).toContain('all<span class="to-me-count">99+</span></a>')
  expect(html).not.toContain('1234')
})

test('hot and latest keep the to-me tab without a count when it has no unread content', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeUnread: false }

  for (const html of [
    renderToStaticMarkup(<HotFeed user={user} feed={feed} />),
    renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/all" />),
  ]) {
    expect(html).toContain('href="/@">@</a>')
  }
})
