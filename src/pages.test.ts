import { describe, expect, test } from 'bun:test'
import { About, AccountMagicLink, AccountSecurity, ApiDocs, Auth, ChangeTheme, ChooseHandle, ConfirmEmail, Connections, Contact, ErrorPage,
  NotFound, postTitle,
  Profile } from './components/pages'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Post } from './components/post'
import { HotFeed } from './components/hot-feed'
import { PublicFeed } from './components/public-feed'
import { TagFeed } from './components/tag-feed'

test('pages advertise the dynamic favicon, touch icon, and manifest', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).toContain('href="/favicon-theme.svg?v=system.theme" type="image/svg+xml" sizes="any"')
  expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
  expect(html).toContain('rel="manifest" href="/site.webmanifest"')
  expect(html).not.toContain('rel="icon" href="/textlog.svg')
})

test('pages use the cookie-aware logo URL instead of its legacy immutable version', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))
  expect(html).toContain('src="/textlog.svg?v=2"')
  expect(html).not.toContain('src="/textlog.svg?v=1"')
})

test('theme selection is a server-rendered form with mobile appearance choices', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeTheme, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'sepia', accent: 'amber' },
  }))
  expect(html).toContain('action="/account/edit/theme"')
  expect(html).toContain('name="theme" value="dracula"')
  expect(html).toContain('name="accent" value="rust"')
  expect(html).toContain('class="accent-swatch accent-swatch-rust"')
  expect(html).toContain('class="accent-swatch accent-swatch-theme accent-swatch-theme-sepia"')
  expect(html).toContain('name="theme" checked="" value="sepia"')
  expect(html).toContain('name="accent" checked="" value="amber"')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('style=')
})

test('signed-in pages put the write shortcut before skip to content', () => {
  const html = renderToStaticMarkup(React.createElement(About, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
  }))

  const writeShortcut = '<a class="skip-link" href="/write">write</a>'
  const contentShortcut = '<a class="skip-link" href="#main-content">skip to content</a>'
  expect(html).toContain(writeShortcut)
  expect(html.indexOf(writeShortcut)).toBeLessThan(html.indexOf(contentShortcut))
})

test('guest pages keep skip to content as their first shortcut', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).not.toContain('<a class="skip-link" href="/write">write</a>')
  expect(html).toContain('<body><a class="skip-link" href="#main-content">skip to content</a>')
})

test('public collection pages advertise their RSS and Atom feeds', () => {
  const hot = renderToStaticMarkup(React.createElement(HotFeed, { user: null, cursor: null }))
  const latest = renderToStaticMarkup(React.createElement(PublicFeed, { user: null, cursor: null, path: '/latest' }))
  const tag = renderToStaticMarkup(React.createElement(TagFeed, {
    user: null, tag: 'ascii_art', following: false, posts: [], page: 1, total: 0,
  }))

  expect(hot).toContain('type="application/rss+xml" title="Hot notes (RSS)" href="/hot.rss"')
  expect(hot).toContain('type="application/atom+xml" title="Hot notes (Atom)" href="/hot.atom"')
  expect(latest).toContain('href="/latest.rss"')
  expect(latest).toContain('href="/latest.atom"')
  expect(tag).toContain('href="/tag/ascii_art.rss"')
  expect(tag).toContain('href="/tag/ascii_art.atom"')
})

test('root feed variants use the unqualified site title', () => {
  const hot = renderToStaticMarkup(React.createElement(HotFeed, { user: null, cursor: null, path: '/' }))
  const latest = renderToStaticMarkup(React.createElement(PublicFeed, { user: null, cursor: null, path: '/' }))

  expect(hot).toContain('<title>textlog</title>')
  expect(latest).toContain('<title>textlog</title>')
})

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
  expect(html).toContain('<span>textlog</span>')
  expect(html).toContain('/api/openapi.json')
  expect(html).toContain('class="api-method" data-method="GET">GET</span>')
  expect(html).toContain('class="api-path">/firehose</span>')
  expect(html).toContain('120 requests per minute')
  expect(html).toContain('/users/:handle/posts.rss')
  expect(html).toContain('/tags/:tag/posts.atom')
  expect(html.match(/class="api-endpoints"/g)).toHaveLength(1)
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/auth/session</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/posts/:id</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/users/:handle/follow</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/users/:handle/block</span>')
})

test('footer offers the mobile app in a mobile-only row', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).toContain(
    'class="button mobile-app-footer" href="https://github.com/Faultless/textlog_flutter"',
  )
  expect(html).toContain('get mobile app</a>')
})

test('Contact page shows operator details and is linked before legal in the footer', () => {
  const html = renderToStaticMarkup(React.createElement(Contact, { user: null }))

  expect(html).toContain('href="mailto:hello@textlog.cc"')
  expect(html).toContain('Kallikratis, Crete, Greece 730 11')
  expect(html).toContain('href="tel:+306946600152"')
  expect(html).toContain('href="/report-illegal-activity"')
  expect(html.indexOf('href="/contact"')).toBeLessThan(html.indexOf('href="/legal"'))
})

test('Not found page gives visitors useful ways back into the site', () => {
  const html = renderToStaticMarkup(React.createElement(NotFound, { user: null }))

  expect(html).toContain('<title>page not found · textlog</title>')
  expect(html).toContain('aria-hidden="true">404</p>')
  expect(html).toContain('This page doesn&#x27;t exist.')
  expect(html).toContain('class="action-pair not-found-actions status-page-actions"')
  expect(html).toContain('class="button" href="/">browse notes</a>')
  expect(html).toContain('<span class="action-separator">or</span><a href="/explore">explore</a>')
})

test('Error pages explain client and server failures without exposing details', () => {
  const client = renderToStaticMarkup(React.createElement(ErrorPage, { user: null, status: 400 }))
  const server = renderToStaticMarkup(React.createElement(ErrorPage, { user: null, status: 500 }))

  expect(client).toContain('aria-hidden="true">4xx</p>')
  expect(client).toContain("We couldn&#x27;t process that request.")
  expect(server).toContain('aria-hidden="true">5xx</p>')
  expect(server).toContain('Something went wrong.')
  expect(server).not.toContain('Intentional server error')
})

describe('About', () => {
  test('offers guest visitors a way to join or browse notes', () => {
    const html = renderToStaticMarkup(React.createElement(About, { user: null }))

    expect(html).toContain('Small by design')
    expect(html).toContain('Your profile and notes are public')
    expect(html).toContain('download or delete your account data')
    expect(html).toContain('class="action-pair about-actions"')
    expect(html).toContain('<span class="action-separator">or</span>')
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
  expect(html).toContain('action="/account/magic-link"')
  expect(html).toContain('generate magic link')
  expect(html).toContain('href="/account/edit">back</a>')
  expect(html).not.toContain('type="password"')
  expect(html).toContain('value="revocable-id"')
  expect(html).not.toContain('value="current-id"')
})

test('AccountMagicLink renders a generated magic link on its own page for copying', () => {
  const html = renderToStaticMarkup(React.createElement(AccountMagicLink, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', email_verified_at: null },
    magicUrl: 'https://textlog.cc/enter/magic?token=secret-token',
    code: '123456',
  }))

  expect(html).toContain('<textarea')
  expect(html).toContain('readOnly=""')
  expect(html).toContain('https://textlog.cc/enter/magic?token=secret-token</textarea>')
  expect(html).toContain('app entry code')
  expect(html).toContain('value="123456"')
  expect(html).toContain('href="/account/security"')
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
  expect(html).toContain('href="/account/edit">account</a>')
  expect(html).toContain('action="/logout"')
  expect(html).toContain('type="application/rss+xml" title="Notes by @reader (RSS)" href="/u/reader.rss"')
  expect(html).toContain('type="application/atom+xml" title="Notes by @reader (Atom)" href="/u/reader.atom"')
  expect(html).toContain('class="mobile-account-footer" aria-label="Account shortcuts"')
  expect(html.indexOf('href="/write"')).toBeLessThan(html.indexOf('href="/u/reader"'))
  expect(html).toContain('<a class="button" href="/write">write a note</a>')
})

test('An empty profile only offers its owner a way to write a note', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: { id: 2, handle: 'visitor', email: 'visitor@example.com', bio: '' },
    profile,
    following: false,
    posts: [],
  }))

  expect(html).toContain('@reader hasn’t posted any notes yet.')
  expect(html).not.toContain('>write a note</a>')
})

test('An empty following tab offers its owner a way to explore', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Connections, {
    user,
    profile: user,
    people: [],
    kind: 'following',
    page: 1,
    total: 0,
    noteCount: 0,
    followerCount: 0,
    followingCount: 0,
    followingTagCount: 0,
    following: false,
  }))

  expect(html).toContain('<a class="button" href="/explore">explore tags &amp; people</a>')
})

test('Profile linkifies Markdown links and tags in the bio', () => {
  const profile = {
    id: 1,
    handle: 'reader',
    email: 'reader@example.com',
    bio: 'Writing about #TextLog at [my site](https://example.com/).',
  }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: null,
    profile,
    following: false,
    posts: [],
  }))

  expect(html).toContain('<a href="/tag/TextLog">#TextLog</a>')
  expect(html).toContain('<a href="https://example.com/" title="https://example.com/" target="_blank" rel="nofollow ugc noopener noreferrer">my site</a>.')
})

test('Post renders preloaded parent and reply data', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    showReplyCount: true,
    p: {
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'child [link](https://example.com/reply)',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      reply_count: 2,
      parent: {
        id: 1,
        body: 'parent [link](https://example.com/post)',
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
  expect(html).toContain('href="https://example.com/reply" title="https://example.com/reply" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>')
  expect(html).toContain('href="https://example.com/post" title="https://example.com/post" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>')
  expect(html).toContain('href="/enter?next=%2Fpost%2F2%3Freply%3D1"')
  expect(html).toContain('aria-label="enter to reply to @writer">enter to reply</a>')
  expect(html).toContain('href="/enter?next=%2Fpost%2F1%3Freply%3D1"')
  expect(html).toContain('aria-label="reply to @author">enter to reply</a>')
})

test('Profile and hashtag feeds show cumulative reply counts beside post dates', () => {
  const post = {
    id: 2,
    user_id: 1,
    parent_id: null,
    body: 'A note with a conversation',
    handle: 'writer',
    created_at: '2026-08-03 12:00:00',
    deleted_at: null,
    reply_count: 3,
  }
  const profile = {
    id: 1,
    handle: 'writer',
    email: 'writer@example.com',
    bio: '',
  }
  const profileHtml = renderToStaticMarkup(React.createElement(Profile, {
    user: null,
    profile,
    following: false,
    posts: [post],
  }))
  const tagHtml = renderToStaticMarkup(React.createElement(TagFeed, {
    user: null,
    tag: 'notes',
    following: false,
    posts: [post],
    page: 1,
    total: 1,
  }))

  expect(profileHtml).toContain('· 3 replies</span>')
  expect(tagHtml).toContain('· 3 replies</span>')
})

test('Post marks #ascii and #ascii_art bodies and quoted parents for tight line spacing', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: {
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: ' /\\_/\\\n( o.o )\n #ASCII',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      parent: {
        id: 1,
        body: 'parent art\n#ascii_art',
        handle: 'author',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
      },
    },
  }))

  expect(html.match(/class="ascii-art"/g)).toHaveLength(2)

  const regularHtml = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: {
      id: 3,
      user_id: 1,
      parent_id: null,
      body: 'not #ascii_artwork',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
    },
  }))
  expect(regularHtml).not.toContain('class="ascii-art"')
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

test('Post renders an opt-in feed hit area without changing detail posts', () => {
  const props = {
    user: null,
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
  const feedHtml = renderToStaticMarkup(React.createElement(Post, { ...props, tappable: true }))
  const detailHtml = renderToStaticMarkup(React.createElement(Post, props))

  expect(feedHtml).toContain('class="post tappable-post"')
  expect(feedHtml).toContain('class="post-hit-area" href="/post/2" aria-label="open post by @writer"')
  expect(detailHtml).not.toContain('post-hit-area')
})

test('A quoted post gets its own higher-priority hit area in tappable feeds', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    tappable: true,
    p: {
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'reply',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      parent: {
        id: 1,
        body: 'quoted note',
        handle: 'parent',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
      },
    },
  }))

  expect(html).toContain('parent-quote tappable-parent')
  expect(html).toContain('class="parent-hit-area" href="/post/1" aria-label="open quoted post by @parent"')
})

test('Post detail can make only its quoted parent tappable', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    tappableParent: true,
    p: {
      id: 2,
      user_id: 1,
      parent_id: 1,
      body: 'reply',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      parent: {
        id: 1,
        body: 'quoted note',
        handle: 'parent',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
      },
    },
  }))

  expect(html).toContain('class="parent-hit-area" href="/post/1"')
  expect(html).not.toContain('class="post-hit-area"')
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
