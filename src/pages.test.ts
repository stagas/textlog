import { describe, expect, test } from 'bun:test'
import { About, AccountSecurity, ApiDocs, Auth, ChooseHandle, ConfirmEmail, Contact, NotFound, postTitle,
  Profile } from './components/pages'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

test('API documentation is linked from the footer and describes the firehose', () => {
  const html = renderToStaticMarkup(React.createElement(ApiDocs, { user: null }))
  expect(html).toContain('href="/api">api</a>')
  expect(html).toContain('class="api-title-brand"')
  expect(html).toContain('class="brand-dot">.</span>mx')
  expect(html).toContain('/api/openapi.json')
  expect(html).toContain('class="api-method">GET</span>')
  expect(html).toContain('class="api-path">/firehose</span>')
  expect(html).toContain('120 requests per minute')
  expect(html).toContain('/users/:handle/posts.rss')
  expect(html).toContain('/tags/:tag/posts.atom')
})

test('Contact page shows operator details and is linked before legal in the footer', () => {
  const html = renderToStaticMarkup(React.createElement(Contact, { user: null }))

  expect(html).toContain('href="mailto:hello@root.mx"')
  expect(html).toContain('Kallikratis, Crete, Greece 730 11')
  expect(html).toContain('href="tel:+306946600152"')
  expect(html).toContain('href="/report-illegal-activity"')
  expect(html.indexOf('href="/contact"')).toBeLessThan(html.indexOf('href="/legal"'))
})

test('Not found page gives visitors useful ways back into the site', () => {
  const html = renderToStaticMarkup(React.createElement(NotFound, { user: null }))

  expect(html).toContain('<title>page not found · root.mx</title>')
  expect(html).toContain('aria-hidden="true">404</p>')
  expect(html).toContain('This page doesn&#x27;t exist.')
  expect(html).toContain('class="button" href="/">browse notes</a>')
  expect(html).toContain('<span>or</span><a href="/explore">explore</a>')
})

describe('About', () => {
  test('offers guest visitors a way to join or browse notes', () => {
    const html = renderToStaticMarkup(React.createElement(About, { user: null }))

    expect(html).toContain('Small by design')
    expect(html).toContain('Your profile and notes are public')
    expect(html).toContain('download or delete your account data')
    expect(html).toContain('class="about-actions"')
    expect(html).toContain('class="button" href="/enter">join the community</a>')
    expect(html).toContain('href="/">browse notes</a>')
  })

  test('does not show the guest calls to action to signed-in visitors', () => {
    const html = renderToStaticMarkup(React.createElement(About, {
      user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    }))

    expect(html).not.toContain('class="about-actions"')
    expect(html).not.toContain('>browse notes</a>')
  })
})

describe('Auth', () => {
  test('enter requests only an email address', () => {
    const html = renderToStaticMarkup(React.createElement(Auth))

    expect(html).toContain('action="/enter"')
    expect(html).toContain('type="email"')
    expect(html).not.toContain('type="password"')
  })

  test('handle choice keeps handle validation', () => {
    const html = renderToStaticMarkup(React.createElement(ChooseHandle))

    expect(html).toContain('pattern="[A-Za-z0-9_]{2,24}"')
    expect(html).toContain('action="/choose-handle"')
  })

  test('carries a next destination through entry', () => {
    const next = '/post/42?reply=1'
    const enter = renderToStaticMarkup(React.createElement(Auth, { next }))

    expect(enter).toContain('name="next" value="/post/42?reply=1"')
  })
})

test('Email confirmation requires an explicit POST', () => {
  const html = renderToStaticMarkup(React.createElement(ConfirmEmail, {
    token: 'confirmation-token',
    kind: 'change',
    email: 'new@example.com',
  }))

  expect(html).toContain('method="post"')
  expect(html).toContain('action="/verify-email"')
  expect(html).toContain('type="hidden" name="token" value="confirmation-token"')
  expect(html).toContain('Change your email?')
})

test('AccountSecurity renders email and safe session controls without passwords', () => {
  const html = renderToStaticMarkup(React.createElement(AccountSecurity, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', email_verified_at: null },
    sessions: [
      { token: 'current-id', created_at: 1, expires_at: Date.now() + 1000, user_agent: 'Browser A', current: true },
      { token: 'revocable-id', created_at: 1, expires_at: Date.now() + 1000, user_agent: 'Browser B', current: false },
    ],
  }))

  expect(html).toContain('reader@example.com')
  expect(html).toContain('href="/account/edit">back</a>')
  expect(html).not.toContain('type="password"')
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
      id: 1,
      user_id: 1,
      parent_id: null,
      body: 'hidden while editing',
      handle: 'reader',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
    }],
  }))

  expect(html).toContain('href="/account/export"')
  expect(html).toContain('action="/account/edit"')
  expect(html).toContain('download data')
  expect(html).toContain('href="/u/reader">back</a>')
  expect(html).not.toContain('hidden while editing')
})

test('Profile places owner actions in the handle row', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    posts: [],
  }))

  expect(html).toContain('class="profile-title-row"')
  expect(html).toContain('class="identity-prefix">@</span>reader')
  expect(html).toContain('href="/account/edit">edit</a>')
  expect(html).toContain('action="/logout"')
  expect(html).toContain('class="mobile-account-footer" aria-label="Account shortcuts"')
  expect(html.indexOf('href="/write"')).toBeLessThan(html.indexOf('href="/u/reader"'))
})

test('Post renders preloaded parent and reply data', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    showReplyCount: true,
    p: {
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'child',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      reply_count: 2,
      parent: {
        id: 1,
        body: 'parent',
        handle: 'author',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
      },
    },
  }))
  expect(html).toContain('2 replies')
  expect(html).toContain('@author')
  expect(html).toContain('parent')
  expect(html).toContain('href="/enter?next=%2Fpost%2F2%3Freply%3D1"')
  expect(html).toContain('aria-label="enter to reply to @writer">enter to reply</a>')
  expect(html).toContain('href="/enter?next=%2Fpost%2F1%3Freply%3D1"')
  expect(html).toContain('aria-label="reply to @author">enter to reply</a>')
})

test('Post only renders owner actions when requested by the detail view', () => {
  const props = {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' },
    p: {
      id: 2,
      user_id: 1,
      parent_id: null,
      body: 'note',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
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
    id: 2,
    user_id: 2,
    parent_id: null,
    body: 'note',
    handle: 'writer',
    created_at: '2026-08-03 12:00:00',
    deleted_at: null,
  }
  const adminFeedHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' },
    p,
  }))
  const adminDetailHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' },
    p,
    showModerateAction: true,
  }))
  const userDetailHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' },
    p,
    showModerateAction: true,
  }))

  expect(adminFeedHtml).not.toContain('/admin/posts/2/delete')
  expect(adminDetailHtml).toContain('/admin/posts/2/delete')
  expect(userDetailHtml).not.toContain('/admin/posts/2/delete')
})
