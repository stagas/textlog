import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccountSecurity, Auth, Profile, postTitle } from './components/pages'
import { Post } from './components/post'

describe('postTitle', () => {
  test('uses short post text as-is', () => {
    expect(postTitle('A short note')).toBe('A short note')
  })

  test('collapses whitespace for use in the document title', () => {
    expect(postTitle('A note\nwith   uneven spacing')).toBe('A note with uneven spacing')
  })

  test('truncates long post text with an ellipsis', () => {
    const title = postTitle('x'.repeat(61))
    expect(title).toBe(`${'x'.repeat(59)}…`)
    expect(Array.from(title)).toHaveLength(60)
  })
})

describe('Auth', () => {
  test('login accepts an email address or handle', () => {
    const html = renderToStaticMarkup(React.createElement(Auth, { mode: 'login' }))

    expect(html).toContain('email or handle')
    expect(html).toContain('autoComplete="username"')
    expect(html).not.toContain('pattern="[A-Za-z0-9_]{2,24}"')
  })

  test('signup keeps handle validation', () => {
    const html = renderToStaticMarkup(React.createElement(Auth, { mode: 'signup' }))

    expect(html).toContain('pattern="[A-Za-z0-9_]{2,24}"')
  })
})

test('AccountSecurity renders verification and safe session controls', () => {
  const html = renderToStaticMarkup(React.createElement(AccountSecurity, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', email_verified_at: null },
    sessions: [
      { token: 'current-id', created_at: 1, expires_at: Date.now() + 1000, user_agent: 'Browser A', current: true },
      { token: 'revocable-id', created_at: 1, expires_at: Date.now() + 1000, user_agent: 'Browser B', current: false },
    ],
  }))

  expect(html).toContain('send verification email')
  expect(html).toContain('/account/password')
  expect(html).toContain('value="revocable-id"')
  expect(html).not.toContain('value="current-id"')
})

test('Profile edit offers a data download without rendering notes', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    editing: true,
    posts: [{
      id: 1, user_id: 1, parent_id: null, body: 'hidden while editing', handle: 'reader',
      created_at: '2026-08-03 12:00:00', deleted_at: null,
    }],
  }))

  expect(html).toContain('href="/account/export"')
  expect(html).toContain('download data')
  expect(html).toContain('href="/u/reader">back</a>')
  expect(html).not.toContain('hidden while editing')
})

test('Profile places owner actions in the handle row', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user, profile: user, following: false, posts: [],
  }))

  expect(html).toContain('class="profile-title-row"')
  expect(html).toContain('class="identity-prefix">@</span>reader')
  expect(html).toContain('href="/u/reader?edit=1">edit</a>')
  expect(html).toContain('action="/logout"')
})

test('Post renders preloaded parent and reply data', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    showReplyCount: true,
    p: {
      id: 2, user_id: 1, parent_id: 1, body: 'child', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null, reply_count: 2,
      parent: {
        id: 1, body: 'parent', handle: 'author', created_at: '2026-08-03 11:00:00',
        deleted_at: null, reply_count: 1,
      },
    },
  }))
  expect(html).toContain('2 replies')
  expect(html).toContain('@author')
  expect(html).toContain('parent')
})

test('Post only renders owner actions when requested by the detail view', () => {
  const props = {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' },
    p: {
      id: 2, user_id: 1, parent_id: null, body: 'note', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null,
    },
  }
  const feedHtml = renderToStaticMarkup(React.createElement(Post, props))
  const detailHtml = renderToStaticMarkup(React.createElement(Post, { ...props, showOwnerActions: true }))

  expect(feedHtml).not.toContain('/post/2/edit')
  expect(feedHtml).not.toContain('/post/2/delete')
  expect(detailHtml).toContain('/post/2/edit')
  expect(detailHtml).toContain('/post/2/delete')
})

test('Post renders moderation controls only for admins on the detail page', () => {
  const p = {
    id: 2, user_id: 2, parent_id: null, body: 'note', handle: 'writer',
    created_at: '2026-08-03 12:00:00', deleted_at: null,
  }
  const adminFeedHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' }, p,
  }))
  const adminDetailHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' }, p, showModerateAction: true,
  }))
  const userDetailHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' }, p, showModerateAction: true,
  }))

  expect(adminFeedHtml).not.toContain('/admin/posts/2/delete')
  expect(adminDetailHtml).toContain('/admin/posts/2/delete')
  expect(userDetailHtml).not.toContain('/admin/posts/2/delete')
})
