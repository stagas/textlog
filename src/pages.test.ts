import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Auth, postTitle } from './components/pages'
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

test('Post renders moderation controls only for admins viewing another user post', () => {
  const p = {
    id: 2, user_id: 2, parent_id: null, body: 'note', handle: 'writer',
    created_at: '2026-08-03 12:00:00', deleted_at: null,
  }
  const adminHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' }, p,
  }))
  const userHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' }, p,
  }))

  expect(adminHtml).toContain('/admin/posts/2/delete')
  expect(userHtml).not.toContain('/admin/posts/2/delete')
})
