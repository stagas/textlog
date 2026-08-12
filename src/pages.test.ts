import { describe, expect, test } from 'bun:test'
import { About, AccountApiKeyCreate, AccountMagicLink, AccountPassword, AccountSecurity, AdminDashboard, ApiDocs, Auth,
  ChangeFont, ChangeTheme, ChooseHandle, Compose, ConfirmAccountDelete, ConfirmEmail, Connections, Contact,
  EmbedExamples, ErrorPage, Legal, MagicLinkSent, NotFound, NotificationSettings, PasswordLogin, postTitle, Profile,
  Reply } from './components/pages'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HotFeed } from './components/hot-feed'
import { ConnectionPeople, Pagination, TagPeopleList } from './components/page-shared'
import { Post } from './components/post'
import { PublicFeed } from './components/public-feed'
import { TagFeed } from './components/tag-feed'

test('compose offers a server-rendered post preview', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: 'Writes things',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const form = renderToStaticMarkup(React.createElement(Compose, { user }))
  const preview = renderToStaticMarkup(React.createElement(Compose, { user, body: 'Hello #world', preview: true }))

  expect(form).toContain('value="preview" name="action">preview</button>')
  expect(form.indexOf('>preview</button>')).toBeLessThan(form.indexOf('>post →</button>'))
  expect(preview).toContain('<h2>preview</h2>')
  expect(preview).toContain('What&#x27;s on your mind')
  expect(preview.indexOf('<h2>preview</h2>')).toBeLessThan(preview.indexOf('<form action="/post" method="post">'))
  expect(preview.indexOf('<h2>preview</h2>')).toBeLessThan(preview.indexOf('<h1 class="compose-heading">'))
  expect(preview.indexOf('<h1 class="compose-heading">')).toBeLessThan(
    preview.indexOf('<form action="/post" method="post">'),
  )
  expect(preview.indexOf('<form action="/post" method="post">')).toBeLessThan(preview.indexOf('<textarea'))
  expect(preview).toContain('Hello <a href="/tag/world"')
  expect(preview).not.toContain('href="/post/0"')
  expect(preview).toContain('<span class="quiet preview-reply">reply</span>')
  expect(preview).not.toContain('href="#"')
  expect(preview).not.toContain('NaN')
})

test('reply forms offer the same server-rendered preview flow', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: 'Writes things',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const post = { id: 2, user_id: 2, parent_id: null, body: 'Original post', created_at: '2026-08-12 09:00:00',
    deleted_at: null, handle: 'author' }
  const html = renderToStaticMarkup(React.createElement(Reply, {
    user,
    post,
    showForm: true,
    body: 'Reply #here',
    preview: true,
  }))

  expect(html).toContain('value="preview" name="action">preview</button>')
  expect(html).toContain('<div class="reply-preview"><p class="eyebrow">preview</p><div class="reply-branch">')
  expect(html).not.toContain('<span class="post-context">preview:</span>')
  expect(html.indexOf('<div class="reply-preview">')).toBeLessThan(html.indexOf('<div class="panel replybox">'))
  expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('<div class="composefoot">'))
  expect(html).toContain('Reply <a href="/tag/here"')
  expect(html).toContain('<span class="quiet preview-reply">reply</span>')
  expect(html).not.toContain('href="#"')
  expect(html).not.toContain('href="/post/0"')
  expect(html).not.toContain('NaN')
})

test('write and reply previews apply ASCII-art spacing rules', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const art = ' /\\_/\\\n( o.o )\n #ASCII_ART'
  const write = renderToStaticMarkup(React.createElement(Compose, { user, body: art, preview: true }))
  const reply = renderToStaticMarkup(React.createElement(Reply, {
    user,
    post: { id: 2, user_id: 2, parent_id: null, body: 'Original', created_at: '2026-08-12 09:00:00', deleted_at: null,
      handle: 'author' },
    showForm: true,
    body: art.replace('#ASCII_ART', '#ascii'),
    preview: true,
  }))

  expect(write).toContain('<p class="ascii-art">')
  expect(reply).toContain('<p class="ascii-art">')
})

test('search result cards highlight tag, handle, and bio matches while keeping follow controls', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const tags = renderToStaticMarkup(React.createElement(TagPeopleList, {
    user,
    tags: [{ tag: 'typescript', count: 2, viewerFollowing: false }],
    followingKey: 'viewerFollowing',
    highlightTerms: ['type'],
  }))
  const people = renderToStaticMarkup(React.createElement(ConnectionPeople, {
    user,
    people: [{ id: 2, handle: 'typewriter', email: '', bio: 'Types useful notes', posts: 3, viewerFollowing: true }],
    highlightTerms: ['type'],
  }))

  expect(tags).toContain('#<mark>type</mark>script')
  expect(tags).toContain('>follow</button>')
  expect(people).toContain('@<mark>type</mark>writer')
  expect(people).toContain('<mark>Type</mark>s useful notes')
  expect(people).toContain('>unfollow</button>')
})

test('admin metrics use locale-aware number formatting', () => {
  const html = renderToStaticMarkup(React.createElement(AdminDashboard, {
    user: { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' },
    stats: {
      users: 1234567,
      usersOnline: 0,
      suspendedUsers: 0,
      activePosts: 0,
      replies: 0,
      openReports: 0,
      activeUsersYesterday: 0,
      usersYesterday: 0,
      users24h: 0,
      users7d: 0,
      posts24h: 0,
      postsYesterday: 0,
      posts7d: 0,
      visitorsToday: 0,
      visitorsYesterday: 0,
      visitors7d: 0,
    },
    reports: [],
    actions: [],
    status: 'open',
    page: 1,
    total: 0,
  }))

  expect(html).toContain(`<strong>${(1234567).toLocaleString()}</strong><span>users</span>`)
})

test('pages advertise the dynamic favicon, touch icon, and manifest', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).toContain('href="/favicon-theme.svg?v=system.theme" type="image/svg+xml" sizes="any"')
  expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
  expect(html).toContain('rel="manifest" href="/site.webmanifest"')
  expect(html).not.toContain('rel="icon" href="/textlog.svg')
})

test('pages inline the cookie-aware theme and logo', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))
  expect(html).toContain('<style>:root{color-scheme:light')
  expect(html).not.toContain('href="/theme.css"')
  expect(html).toContain('<span class="brand-logo" aria-hidden="true"><svg')
  expect(html).not.toContain('src="/textlog.svg')
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

test('notification settings are the only account page that loads their client script', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const notifications = renderToStaticMarkup(React.createElement(NotificationSettings, {
    user,
    publicKey: 'public-key',
  }))
  const profile = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    posts: [],
    following: false,
    editing: true,
  }))
  expect(notifications).toContain('src="/notifications.js"')
  expect(notifications).toContain('class="static-page notifications-page"')
  expect(notifications).toContain('enable notifications')
  expect(notifications).toContain('name="noteScope" checked="" value="latest"')
  expect(notifications).toContain('name="noteScope" value="following"')
  expect(notifications).toContain('name="notesEnabled" checked=""')
  expect(notifications).toContain('name="replies" checked=""')
  expect(notifications).toContain('name="mentions" checked=""')
  expect(notifications).toContain('name="follows" checked=""')
  expect(notifications).toContain('name="ownPosts" checked=""')
  expect(notifications).toContain('name="followActivity" checked=""')
  expect(notifications).not.toContain('name="signups"')
  expect(notifications).toContain('save preferences</button>')
  expect(profile).toContain('href="/account/edit/notifications"')
  expect(profile).not.toContain('<script')
})

test('notification settings show new-user alerts only to administrators', () => {
  const notifications = renderToStaticMarkup(React.createElement(NotificationSettings, {
    user: { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' },
    publicKey: 'public-key',
  }))
  expect(notifications).toContain('name="signups" checked=""')
  expect(notifications).toContain('new user signups')
})

test('notification settings show Home Screen installation steps only for iOS', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const ios = renderToStaticMarkup(React.createElement(NotificationSettings, {
    user,
    publicKey: 'public-key',
    ios: true,
  }))
  const other = renderToStaticMarkup(React.createElement(NotificationSettings, {
    user,
    publicKey: 'public-key',
    ios: false,
  }))
  expect(ios).toContain('Install textlog first')
  expect(ios).toContain('Add to Home Screen')
  expect(ios).toContain('Open as Web App')
  expect(other).not.toContain('Install textlog first')
})

test('font selection lists local monospace fonts in their own families', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeFont, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: 'consolas',
  }))
  expect(html).toContain('action="/account/edit/font"')
  expect(html).toContain('name="font" checked="" value="consolas"')
  expect(html).toContain('font-preview-sf-mono')
  expect(html).toContain('font-preview-dejavu-sans-mono')
  expect(html).toContain('font-preview-jetbrains-mono')
  expect(html).toContain('<span class="font-sample">textlog</span>')
  expect(html).toContain('name="fontSize" checked="" value="regular"')
  expect(html).toContain('value="small"')
  expect(html).toContain('value="large"')
  expect(html).toContain('value="larger"')
  expect(html).toContain('Fonts are used from your device.')
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
    user: null,
    tag: 'ascii_art',
    following: false,
    posts: [],
    page: 1,
    total: 0,
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
  expect(html).toContain('href="/api/embed-examples"')
  expect(html.match(/class="api-endpoints"/g)).toHaveLength(1)
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/auth/session</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/posts/:id</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/users/:handle/follow</span>')
  expect(html).toContain('data-method="DELETE">DELETE</span><span class="api-path">/users/:handle/block</span>')
})

test('API documentation links to the privacy-filtered public archive', () => {
  const html = renderToStaticMarkup(React.createElement(ApiDocs, { user: null }))
  expect(html).toContain('id="public-archive"')
  expect(html).toContain('href="/dump.zip"')
  expect(html).toContain('record timestamps')
})

test('embed examples show every format and use stagas for the user feed', () => {
  const html = renderToStaticMarkup(React.createElement(EmbedExamples, {
    user: null,
    handle: 'stagas',
    tag: 'notes',
    postId: 42,
  }))
  expect(html).toContain('/embed/latest?theme=light&amp;accent=sage&amp;font=menlo')
  expect(html).toContain('/embed/hot?accent=purple&amp;font=consolas')
  expect(html).toContain('/embed/user/stagas?theme=dracula&amp;accent=cyan&amp;font=jetbrains')
  expect(html).toContain('/embed/tag/notes?theme=sepia&amp;accent=amber')
  expect(html).toContain('/embed/post/42?theme=system&amp;accent=blue')
  expect(html.match(/<iframe/g)).toHaveLength(5)
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

test('Legal privacy disclosures cover current account settings data', () => {
  const html = renderToStaticMarkup(React.createElement(Legal, { user: null }))

  expect(html).toContain('one-way password hash')
  expect(html).toContain('hashed app entry codes')
  expect(html).toContain('appearance cookie')
  expect(html).toContain('manage your password and sessions')
  expect(html).toContain('download a JSON copy of your account data')
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
  expect(client).toContain('We couldn&#x27;t process that request.')
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
    expect(html).toContain('class="button" href="/enter" rel="nofollow">join the community</a>')
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

  test('password login submits its server-issued nonce', () => {
    const html = renderToStaticMarkup(React.createElement(PasswordLogin, { nonce: 'one-time-value' }))

    expect(html).toContain('type="hidden" name="nonce" value="one-time-value"')
  })

  test('password login renders a server-issued CAPTCHA when requested', () => {
    const html = renderToStaticMarkup(React.createElement(PasswordLogin, {
      nonce: 'one-time-value',
      captcha: { token: 'captcha-token', image: 'data:image/svg+xml;base64,PHN2Zy8+' },
    }))
    expect(html).toContain('name="captchaToken" value="captcha-token"')
    expect(html).toContain('name="captchaAnswer"')
    expect(html).toContain('data:image/svg+xml;base64,PHN2Zy8+')
  })

  test('check-your-email page accepts the one-time code', () => {
    const html = renderToStaticMarkup(React.createElement(MagicLinkSent, { email: 'reader@example.com' }))

    expect(html).toContain('action="/enter/code"')
    expect(html).toContain('or enter the six-digit code')
    expect(html).toContain('name="email" value="reader@example.com"')
    expect(html).toContain('name="code"')
    expect(html).toContain('pattern="[0-9]{6}"')
    expect(html).toContain('placeholder="123456"')
    expect(html).not.toContain('autofocus=""')
    expect(html).toContain('expire in 15 minutes')
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

test('Email change approval uses the action panel', () => {
  const html = renderToStaticMarkup(React.createElement(ConfirmEmail, {
    token: 'approval-token',
    kind: 'authorize-change',
    email: 'new@example.com',
  }))
  expect(html).toContain('welcome-panel verify-email-panel email-change-approval')
  expect(html).toContain('security confirmation')
  expect(html).toContain('action="/account/email/change/authorize"')
})

test('Account deletion asks for the configured second factor', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const passwordHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, {
    user,
    passwordEnabled: true,
  }))
  expect(passwordHtml).toContain('type="password"')
  expect(passwordHtml).toContain('name="password"')

  const emailHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, { user }))
  expect(emailHtml).not.toContain('type="password"')
  expect(emailHtml).toContain('send confirmation link')

  const tokenHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, {
    token: 'deletion-token',
  }))
  expect(tokenHtml).toContain('type="hidden" name="token" value="deletion-token"')
  expect(tokenHtml).toContain('>delete account</button>')

  const sentHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, { user, sent: true }))
  expect(sentHtml).toContain('Check your email.')
  expect(sentHtml).toContain('reader@example.com')
  expect(sentHtml).toContain('Your account has not been deleted.')
  expect(sentHtml).not.toContain('action="/account/delete"')
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
  expect(html).toContain('href="/account/api-keys/new">generate API key')
  expect(html).not.toContain('name="lifetime"')
  expect(html).toContain('href="/account/edit">back</a>')
  expect(html).not.toContain('type="password"')
  expect(html).toContain('value="revocable-id"')
  expect(html).not.toContain('value="current-id"')
})

test('API key creation has a focused form with themed expiration radios', () => {
  const html = renderToStaticMarkup(React.createElement(AccountApiKeyCreate, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
  }))
  expect(html).toContain('action="/account/api-keys"')
  expect(html).toContain('name="name"')
  expect(html).toContain('type="radio" name="lifetime" checked="" value="year"')
  expect(html).toContain('class="api-key-radio"')
  expect(html).not.toContain('<select name="lifetime"')
  expect(html).toContain('href="/account/security">cancel</a>')
})

test('AccountSecurity asks for the current password when email changes require it', () => {
  const html = renderToStaticMarkup(React.createElement(AccountSecurity, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    sessions: [],
    passwordEnabled: true,
  }))
  expect(html).toContain('action="/account/email/change"')
  expect(html).toContain('name="password"')
  expect(html).toContain('autoComplete="current-password"')
})

test('enabling password login requests email confirmation before showing password fields', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const requestHtml = renderToStaticMarkup(React.createElement(AccountPassword, {
    user,
    enabled: false,
    request: true,
  }))
  expect(requestHtml).toContain('send setup link')
  expect(requestHtml).toContain('password-panel enable-password-panel')
  expect(requestHtml).not.toContain('name="newPassword"')

  const confirmedHtml = renderToStaticMarkup(React.createElement(AccountPassword, {
    user,
    enabled: false,
    token: 'setup-token',
  }))
  expect(confirmedHtml).toContain('name="token" value="setup-token"')
  expect(confirmedHtml).toContain('name="newPassword"')
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
  expect(html).toContain('class="account-nav-row account-nav-primary"')
  expect(html).toContain('class="account-nav-row account-nav-secondary"')
  expect(html).not.toContain('class="mobile-account-footer"')
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

test('Following and followers paginate every 10 people', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  for (const kind of ['following', 'followers'] as const) {
    const html = renderToStaticMarkup(React.createElement(Connections, {
      user: null,
      profile,
      people: [],
      kind,
      page: 1,
      total: 11,
      noteCount: 0,
      followerCount: 11,
      followingCount: 11,
      followingTagCount: 0,
      following: false,
    }))

    expect(html).toContain(`href="/u/reader?tab=${kind}&amp;page=2"`)
  }
})

test('Compact column pagination shows labeled arrow controls and neighboring pages', () => {
  const html = renderToStaticMarkup(React.createElement(Pagination, {
    page: 5,
    totalPages: 10,
    path: '/explore',
    pageParam: 'tagsPage',
    compact: true,
  }))

  expect(html).toContain('aria-label="Previous page">← prev</a>')
  expect(html).toContain('aria-label="Next page">next →</a>')
  for (const page of [4, 5, 6]) expect(html).toContain(`>${page}</`)
})

test('Compact column pagination shows three page boxes at either edge', () => {
  const render = (page: number) =>
    renderToStaticMarkup(React.createElement(Pagination, {
      page,
      totalPages: 17,
      path: '/explore',
      compact: true,
    }))

  const first = render(1)
  for (const page of [1, 2, 3, 17]) expect(first).toContain(`>${page}</`)
  expect(first).not.toContain('>4</')

  const last = render(17)
  for (const page of [1, 15, 16, 17]) expect(last).toContain(`>${page}</`)
  expect(last).not.toContain('>14</')
})

test('Followed tags paginate every 12 tags', () => {
  const html = renderToStaticMarkup(React.createElement(Connections, {
    user: null,
    profile: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    people: [],
    tags: [{ tag: 'notes', count: 1, viewerFollowing: false }],
    kind: 'following',
    page: 1,
    total: 0,
    tagsTotal: 13,
    noteCount: 0,
    followerCount: 0,
    followingCount: 0,
    followingTagCount: 13,
    following: false,
  }))

  expect(html).toContain('href="/u/reader?tab=following&amp;tagsPage=2"')
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

  expect(html).toContain('<a href="/tag/textlog">#TextLog</a>')
  expect(html).toContain(
    '<a href="https://example.com/" title="https://example.com/" target="_blank" rel="nofollow ugc noopener noreferrer">my site</a>.',
  )
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
  expect(html).toContain(
    'href="https://example.com/reply" title="https://example.com/reply" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>',
  )
  expect(html).toContain(
    'href="https://example.com/post" title="https://example.com/post" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>',
  )
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
