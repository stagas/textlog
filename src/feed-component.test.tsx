import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Feed } from './components/feed'
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
})
