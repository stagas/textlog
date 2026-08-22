import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Feed } from './components/feed'
import { HotFeed } from './components/hot-feed'
import { PublicFeed } from './components/public-feed'
import type { PersonalizedTimelineRow } from './types'

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

test('feed pages reconstruct threads from only the posts on that page', () => {
  const root = { id: 10, user_id: 2, parent_id: null, body: 'root note', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 2 }
  const reply = { id: 11, user_id: 3, parent_id: 10, body: 'page reply', created_at: '2026-08-19 11:00:00',
    deleted_at: null, handle: 'bob', reply_count: 0, parent: { ...root, reply_count: 2 } }
  const orphan = { id: 12, user_id: 4, parent_id: 99, body: 'parent is off page',
    created_at: '2026-08-19 12:00:00', deleted_at: null, handle: 'cara', reply_count: 0,
    parent: { ...root, id: 99, body: 'off-page parent', reply_count: 1 } }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [reply, orphan, root], page: 1, totalItems: 3,
    totalPages: 1 }} path="/latest" />)

  expect(html.match(/id="post-10"/g)).toHaveLength(1)
  expect(html.match(/id="post-11"/g)).toHaveLength(1)
  expect(html.match(/id="post-12"/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(2)
  expect(html.indexOf('id="post-10"')).toBeLessThan(html.indexOf('id="post-11"'))
  expect(html.indexOf('id="post-10"')).toBeLessThan(html.indexOf('id="post-12"'))
  expect(html).toContain('class="reply-branch"')
  expect(html).toContain('class="thread-fold-input" type="checkbox" id="feed-thread-fold-10"')
  expect(html).toContain('for="feed-thread-fold-10" title="fold or unfold replies"')
  expect(html).toContain('class="quiet post-continuation-link" href="/post/10?from=%2Flatest%23post-10" '
    + 'rel="nofollow">read more</a>')
})

test('flat feed view restores source order and offers the tree toggle after to me', () => {
  const root = { id: 50, user_id: 2, parent_id: null, body: 'older root', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 1 }
  const reply = { id: 51, user_id: 3, parent_id: root.id, body: 'newer reply',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'bob', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(<PublicFeed user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }}
    feed={{ posts: [reply, root], page: 2, totalItems: 4, totalPages: 2, toMeCount: 1 }} path="/latest"
    flat />)

  expect(html).not.toContain('class="post-page-thread feed-thread"')
  expect(html.indexOf('id="post-51"')).toBeLessThan(html.indexOf('id="post-50"'))
  expect(html).toContain('href="/latest?page=2">tree</a>')
  expect(html.indexOf('class="to-me-label"')).toBeLessThan(html.indexOf('href="/latest?page=2">tree</a>'))
  expect(html).toContain('href="/latest?view=flat&amp;page=1"')
  expect(html).toContain('href="/to-me?view=flat"')
})

test('hot and latest put the view toggle after to me when it is present', () => {
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeCount: 2 }
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  for (const html of [
    renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/latest" />),
    renderToStaticMarkup(<HotFeed user={user} feed={feed} />),
  ]) {
    expect(html.indexOf('class="to-me-label"')).toBeLessThan(html.indexOf('>flat</a>'))
  }
})

test('anonymous public feed view toggles return to the feed tabs', () => {
  const feed = { posts: [], page: 2, totalItems: 2, totalPages: 2 }
  const latest = renderToStaticMarkup(<PublicFeed feed={feed} path="/latest" />)
  const hot = renderToStaticMarkup(<HotFeed user={null} feed={feed} />)

  expect(latest).toContain('href="/latest?view=flat&amp;page=2#feed-tabs">flat</a>')
  expect(hot).toContain('href="/hot?view=flat&amp;page=2#feed-tabs">flat</a>')
})

test('feed tree roots retain ASCII-art rendering', () => {
  const post = { id: 20, user_id: 2, parent_id: null, body: ' /\\_/\\\n( o.o )\n#ascii',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'alice', reply_count: 0 }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [post], page: 1, totalItems: 1, totalPages: 1 }} />)

  expect(html).toContain('class="post-body ascii-art"')
})

test('standalone feed posts do not offer to read an undisplayed thread', () => {
  const post = { id: 21, user_id: 2, parent_id: null, body: 'root only', created_at: '2026-08-19 10:00:00',
    deleted_at: null, handle: 'alice', reply_count: 3 }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [post], page: 1, totalItems: 1, totalPages: 1 }} />)

  expect(html).not.toContain('post-continuation-link')
  expect(html).not.toContain('feed-thread-fold-21')
  expect(html).not.toContain('>read more</a>')
})

test('to-me deduplicates the shared parent of sibling reply activities', () => {
  const parent = { id: 25, user_id: 1, parent_id: null, body: 'one shared parent',
    created_at: '2026-08-19 09:00:00', deleted_at: null, handle: 'reader', reply_count: 2 }
  const activity = (id: number, handle: string): PersonalizedTimelineRow => ({
    ...postActivity(id, id, handle),
    parent_id: parent.id,
    parent,
    activity_kind: 'reply',
    renderedPost: { ...postActivity(id, id, handle), parent_id: parent.id, parent },
  })
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [activity(27, 'cara'), activity(26, 'bob')], page: 1, totalPages: 1, toMeCount: 2,
      forYouCount: 0, forYouUnread: false, toMeUnread: true }} toMe
  />)

  expect(html.match(/one shared parent/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(1)
  expect(html.match(/class="parent-quote/g)).toBeNull()
})

test('feed trees render a shared off-page parent once for sibling replies', () => {
  const parent = { id: 30, user_id: 2, parent_id: null, body: 'shared context',
    created_at: '2026-08-19 09:00:00', deleted_at: null, handle: 'alice', reply_count: 2 }
  const reply = (id: number, handle: string) => ({ id, user_id: id, parent_id: parent.id, body: `${handle} reply`,
    created_at: `2026-08-19 1${id - 30}:00:00`, deleted_at: null, handle, reply_count: 0, parent })
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [reply(32, 'cara'), reply(31, 'bob')], page: 1,
    totalItems: 2, totalPages: 1 }} />)

  expect(html.match(/shared context/g)).toHaveLength(1)
  expect(html.match(/class="post-page-thread feed-thread"/g)).toHaveLength(1)
  expect(html.match(/class="parent-quote/g)).toBeNull()
  expect(html.indexOf('id="post-30"')).toBeLessThan(html.indexOf('id="post-32"'))
  expect(html.indexOf('id="post-32"')).toBeLessThan(html.indexOf('id="post-31"'))
})

test('threaded feed replies link to descendants omitted from the page', () => {
  const root = { id: 40, user_id: 2, parent_id: null, body: 'root', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 3 }
  const reply = { id: 41, user_id: 3, parent_id: root.id, body: 'visible reply',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'bob', reply_count: 2, parent: root }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [reply, root], page: 1, totalItems: 2,
    totalPages: 1 }} path="/latest" />)

  expect(html).toContain('class="quiet post-continuation-link" href="/post/41?from=%2Flatest%23post-41" '
    + 'rel="nofollow">read more</a>')
})

test('threaded feed replies do not show read more before an included descendant', () => {
  const root = { id: 45, user_id: 2, parent_id: null, body: 'root', created_at: '2026-08-19 09:00:00',
    deleted_at: null, handle: 'alice', reply_count: 3 }
  const reply = { id: 46, user_id: 3, parent_id: root.id, body: 'visible reply',
    created_at: '2026-08-19 10:00:00', deleted_at: null, handle: 'bob', reply_count: 2, parent: root }
  const child = { id: 47, user_id: 4, parent_id: reply.id, body: 'visible child',
    created_at: '2026-08-19 11:00:00', deleted_at: null, handle: 'cara', reply_count: 0, parent: reply }
  const html = renderToStaticMarkup(<PublicFeed feed={{ posts: [child, reply, root], page: 1, totalItems: 3,
    totalPages: 1 }} path="/latest" />)

  expect(html).toContain('id="post-47"')
  expect(html).not.toContain('class="quiet post-continuation-link" href="/post/46?from=%2Flatest%23post-46" '
    + 'rel="nofollow">read more</a>')
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
  const parent = { id: 10, user_id: 2, parent_id: 9, body: 'earlier reply',
    created_at: '2026-08-19 09:00:00', deleted_at: null, handle: 'alice', reply_count: 1 }
  const activity = {
    ...postActivity(11, 2, 'alice'),
    parent_id: parent.id,
    parent,
    activity_kind: 'post' as const,
    targeted_to_viewer: false,
    renderedPost: { ...postActivity(11, 2, 'alice'), parent_id: parent.id, parent },
  }
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [activity], page: 1, totalPages: 1, toMeCount: 1,
      forYouCount: 1, forYouUnread: false, toMeUnread: true }}
  />)

  expect(html).toContain('<span class="post-context">continued:</span>')
  expect(html).not.toContain('replied to you:')
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

test('a followed-you event offers to follow back', () => {
  const followActivity = {
    ...postActivity(12, 4, 'carol'),
    activity_kind: 'user_follow' as const,
    event_key: 'user-follow:12',
    target_handle: null,
    target_bio: '',
    target_is_viewer: true,
    targeted_to_viewer: true,
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
  expect(html).toContain('</div><form action="/follow/carol" method="post"><input type="hidden" '
    + 'name="from" value="/for-you#activity-user-follow-12"/><button class="button">follow back</button>')
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
      forYouCount: 1, forYouUnread: true, toMeUnread: false, unreadHref: '/for-you?page=2#post-20' }}
  />)

  expect(html).toContain('pagination pagination-top')
})

test('for-you offers links to the first and last unread activity', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    data={{ timeline: [postActivity(10, 2, 'alice')], page: 1, totalPages: 3, toMeCount: 0, forYouCount: 2,
      forYouUnread: true, toMeUnread: false, unreadHref: '/for-you?page=2#post-20',
      lastUnreadHref: '/for-you?page=3#post-30' }}
  />)

  expect(html).toContain('<span class="activity-side-status">jump to</span>')
  expect(html).toContain('href="/for-you?page=2#post-20">first unread</a>')
  expect(html).toContain('href="/for-you?page=3#post-30">last unread</a>')
})

test('to-me omits hide actions and keeps top pagination before entries', () => {
  const html = renderToStaticMarkup(<Feed
    user={{ id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-08-19 09:00:00' }}
    toMe
    path="/to-me"
    data={{ timeline: [postActivity(10, 2, 'alice'), postActivity(11, 3, 'bob')], page: 1, totalPages: 3, toMeCount: 2,
      forYouCount: 2, forYouUnread: false, toMeUnread: true, unreadHref: '/to-me?page=2#post-20' }}
  />)

  expect(html).not.toContain('for-you-hide-input')
  expect(html.indexOf('pagination pagination-top')).toBeLessThan(html.indexOf('for-you-item for-you-author-2'))
  expect(html).toContain('href="/to-me?page=2#post-20">unread</a>')
  expect(html).not.toContain('>first unread</a>')
  expect(html).not.toContain('>last unread</a>')
  expect(html).toContain('action="/to-me/read-all"')
})

test('hot and latest show the to-me link when it has unread content', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeUnread: true, toMeCount: 3 }

  for (const html of [
    renderToStaticMarkup(<HotFeed user={user} feed={feed} />),
    renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/latest" />),
  ]) {
    expect(html).toContain('href="/to-me"><span class="to-me-label">to me</span>'
      + '<span class="to-me-count">3</span></a>')
  }
})

test('hot and latest hide the to-me link when it has no unread content', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    handle_chosen_at: '2026-08-19 09:00:00' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1, toMeUnread: false }

  for (const html of [
    renderToStaticMarkup(<HotFeed user={user} feed={feed} />),
    renderToStaticMarkup(<PublicFeed user={user} feed={feed} path="/latest" />),
  ]) {
    expect(html).not.toContain('href="/to-me"')
  }
})
