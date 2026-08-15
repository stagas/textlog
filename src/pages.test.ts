import { describe, expect, test } from 'bun:test'
import { ConnectionPeople, Pagination, TagPeopleList } from './components/page-shared'
import {
  About,
  AccountApiKeyCreate,
  AccountMagicLink,
  AccountPassword,
  AccountSecurity,
  AccountSwitcher,
  AdminDashboard,
  ApiDocs,
  Auth,
  ChangeAppearance,
  ChooseHandle,
  Compose,
  ConfirmAccountDelete,
  ConfirmDelete,
  ConfirmEmail,
  Connections,
  Contact,
  EditPost,
  EmbedExamples,
  ErrorPage,
  ForgotPassword,
  Legal,
  MagicLinkSent,
  NotFound,
  NotificationSettings,
  PasswordLogin,
  PanelsGallery,
  postTitle,
  Profile,
  Reply,
} from './components/pages'
import { conversationTopPath, Post, postedReplyPath, replyAnchorReturnPath } from './components/post'
import { searchPersonReturnPath, searchPostReturnPath } from './components/search'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { maskEmail } from './components/auth'
import { HotFeed } from './components/hot-feed'
import { PublicFeed } from './components/public-feed'
import { TagFeed } from './components/tag-feed'

test('panels gallery renders every shared panel variation', () => {
  const html = renderToStaticMarkup(React.createElement(PanelsGallery))

  expect(html).toContain('<h1>panels gallery</h1>')
  expect(html).toContain('class="account-settings-heading panels-gallery-header"')
  expect(html).toContain('panel-narrow')
  expect(html).toContain('panel-medium')
  expect(html).toContain('panel-wide')
  expect(html).toContain('panel-fluid')
  expect(html).toContain('panel-danger')
  expect(html).toContain('panel-gallery-shell-preview')
})

test('account switcher errors use the shared error notice', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(AccountSwitcher, {
    user,
    accounts: [{ id: 1, handle: 'reader', handle_chosen_at: '2026-08-12 10:00:00', primary: true,
      selected: true }],
    error: 'Could not switch accounts.',
  }))

  expect(html).toContain('class="status-message status-error" role="alert">Could not switch accounts.</p>')
  expect(html).not.toContain('class="error"')
})

test('auth pages render through the shared centered panel', () => {
  const html = renderToStaticMarkup(React.createElement(Auth, {}))
  expect(html).toContain('class="panel-shell auth-shell enter-shell"')
  expect(html).toContain('class="panel panel-surface panel-narrow auth-panel enter-panel"')
})

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
  expect(preview).toContain('<div class="posttop preview-post-meta"><span class="reference-menu">')
  expect(preview).not.toContain('href="/post/0"')
  expect(preview).toContain('<span class="quiet preview-reply">reply</span>')
  expect(preview).not.toContain('href="#"')
  expect(preview).not.toContain('NaN')
})

test('compose carries its originating page through preview and offers cancel before preview', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user,
    returnPath: '/latest?cursor=abc#post-2',
  }))

  expect(html).toContain('name="from" value="/latest?cursor=abc#post-2"')
  expect(html).toContain('class="secondary-action cancel-action edit-post-cancel" href="/latest?cursor=abc#post-2">cancel</a>')
  expect(html.indexOf('>cancel</a>')).toBeLessThan(html.indexOf('>preview</button>'))
})

test('posting helpers are searchable details and show copyable highlighted results above actions', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user,
    body: 'A draft worth keeping',
    suggestionSearch: { kind: 'hashtags', query: 'type', results: ['typescript', 'typestyle'], truncated: true },
  }))

  expect(html).toContain('popoverTarget="posting-help-hashtags">#hashtags</button>')
  expect(html).toContain('id="posting-help-hashtags" popover="auto"')
  expect(html).toContain('popoverTarget="posting-help-mentions">@mentions</button>')
  expect(html).toContain('id="posting-help-more" popover="auto"')
  expect(html).toContain('for="posting-help-formatting" role="tab">Formatting</label>')
  expect(html).toContain('for="posting-help-emoji" role="tab">Emoji</label>')
  expect(html).toContain('class="posting-help-emoji-panel" aria-label="Emoji to copy and paste"')
  expect(html).toContain('title="Select and copy">😀</span>')
  expect(html).toContain('placeholder="search hashtags"')
  expect(html).toContain('placeholder="search handles"')
  expect(html).toContain('value="search-hashtags" formNoValidate="" name="action"')
  expect(html).toContain('value="search-mentions" formNoValidate="" name="action"')
  expect(html).toContain(
    'required="" autofocus="" autoComplete="off" inputMode="text" enterKeyHint="enter">A draft worth keeping</textarea>',
  )
  expect(html).toContain('#<mark>type</mark>script')
  expect(html).toContain('<span aria-label="More results">...</span>')
  expect(html).not.toContain('href="/tag/typescript"')
  expect(html.indexOf('class="posting-suggestion-results"')).toBeLessThan(html.indexOf('class="composefoot"'))
})

test('post edit places delete above the textarea and keeps preview before save', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const post = { id: 2, user_id: 1, parent_id: null, body: 'Original', created_at: '2026-08-12 09:00:00',
    deleted_at: null }
  const html = renderToStaticMarkup(React.createElement(EditPost, { user, post }))

  expect(html).toContain('class="panel panel-surface panel-medium compose edit-post-compose"')
  expect(html).toContain('class="edit-post-actions"')
  expect(html).toContain('class="edit-post-primary-actions"')
  expect(html).toContain('class="edit-post-delete-action"')
  expect(html).toContain('class="secondary-action cancel-action edit-post-cancel"')
  expect(html).toContain('class="secondary-action danger" href="/post/2/delete">delete note</a>')
  expect(html.indexOf('>delete note</a>')).toBeLessThan(html.indexOf('<textarea'))
  expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('>cancel</a>'))
  expect(html.indexOf('>preview</button>')).toBeLessThan(html.indexOf('>save →</button>'))
})

test('post deletion uses the standard centered confirmation panel', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const post = { id: 2, user_id: 1, parent_id: null, body: 'Original note', created_at: '2026-08-12 09:00:00',
    deleted_at: null }
  const html = renderToStaticMarkup(React.createElement(ConfirmDelete, {
    user,
    post,
    returnPath: '/latest#post-2',
  }))

  expect(html).toContain('class="panel-shell auth-shell account-delete-shell post-delete-shell"')
  expect(html).toContain(
    'class="panel panel-surface panel-medium panel-danger auth-panel account-delete-panel confirm-delete post-delete-panel"',
  )
  expect(html).toContain('<p class="eyebrow">note deletion</p>')
  expect(html).toContain('<blockquote aria-label="Post to delete">Original note</blockquote>')
  expect(html).toContain('class="post-delete-form" action="/post/2/delete" method="post"')
  expect(html).toContain('name="from" value="/latest#post-2"')
  expect(html).toContain('href="/post/2?from=%2Flatest%23post-2">cancel</a>')
  expect(html).toContain('class="button button-danger" type="submit">delete post</button>')
})

test('editing a reply shows its parent context above the textarea', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const post = { id: 3, user_id: 1, parent_id: 2, body: 'My reply', created_at: '2026-08-12 10:00:00',
    deleted_at: null }
  const parent = { id: 2, user_id: 2, parent_id: null, body: 'Parent note', created_at: '2026-08-12 09:00:00',
    deleted_at: null, handle: 'author' }
  const returnPath = '/latest?cursor=abc#post-3'
  const html = renderToStaticMarkup(React.createElement(EditPost, { user, post, parent, returnPath }))

  expect(html).toContain('class="post-page-thread"')
  expect(html).toContain('class="thread-root"')
  expect(html).toContain('class="panel panel-surface panel-medium replybox"')
  expect(html).toContain('Parent note')
  expect(html).toContain('class="quiet post-back-link" href="/latest?cursor=abc#post-3">back</a>')
  expect(html).toContain('name="from" value="/latest?cursor=abc#post-3"')
  expect(html).toContain('href="/post/3/delete?from=%2Flatest%3Fcursor%3Dabc%23post-3"')
  expect(html).toContain('href="/post/3?from=%2Flatest%3Fcursor%3Dabc%23post-3">cancel</a>')
  expect(html.indexOf('Parent note')).toBeLessThan(html.indexOf('<textarea'))

  const preview = renderToStaticMarkup(React.createElement(EditPost, {
    user,
    post,
    parent,
    body: 'Edited reply',
    preview: true,
    returnPath,
  }))
  expect(preview).toContain('value="preview" name="action">preview</button>')
  expect(preview).toContain('<div class="reply-preview"><p class="eyebrow">preview</p>')
  expect(preview).toContain('Edited reply')
  expect(preview.indexOf('<div class="reply-preview">')).toBeLessThan(preview.indexOf('<textarea'))
  const previewPost = preview.slice(preview.indexOf('<div class="reply-preview">'),
    preview.indexOf('<div class="panel panel-surface panel-medium replybox">'))
  expect(previewPost).toContain('<div class="posttop preview-post-meta"><span class="reference-menu">')
  expect(previewPost).toContain('<span class="postdate"')
  expect(previewPost).toContain('<span class="quiet preview-reply">reply</span>')
  expect(previewPost).not.toContain('<a ')
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
  expect(html).toContain('class="secondary-action cancel-action edit-post-cancel" href="/post/2">cancel</a>')
  expect(html.indexOf('>cancel</a>')).toBeLessThan(html.indexOf('>preview</button>'))
  expect(html).toContain('<div class="reply-preview"><p class="eyebrow">preview</p><div class="reply-branch">')
  expect(html).not.toContain('<span class="post-context">preview:</span>')
  expect(html.indexOf('<div class="reply-preview">')).toBeLessThan(
    html.indexOf('<div class="panel panel-surface panel-medium replybox">'),
  )
  expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('<div class="composefoot">'))
  expect(html).toContain('Reply <a href="/tag/here"')
  expect(html).toContain('<span class="quiet preview-reply">reply</span>')
  expect(html).not.toContain('href="#"')
  expect(html).not.toContain('href="/post/0"')
  expect(html).not.toContain('NaN')
})

test('reply form cancel returns to the originating feed entry', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const post = { id: 2, user_id: 2, parent_id: null, body: 'Original post', created_at: '2026-08-12 09:00:00',
    deleted_at: null, handle: 'author' }
  const html = renderToStaticMarkup(React.createElement(Reply, {
    user,
    post,
    showForm: true,
    returnPath: '/u/writer?tab=replies#post-2',
  }))

  expect(html).toContain(
    'class="secondary-action cancel-action edit-post-cancel" href="/u/writer?tab=replies#post-2">cancel</a>',
  )
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
    returnPath: tag => `/explore?tagsPage=3#tag-${tag.tag}`,
  }))
  const people = renderToStaticMarkup(React.createElement(ConnectionPeople, {
    user,
    people: [{ id: 2, handle: 'typewriter', email: '', bio: 'Types useful notes', posts: 3, viewerFollowing: true }],
    highlightTerms: ['type'],
    returnPath: person => searchPersonReturnPath('type writer', 3, person.id),
  }))

  expect(tags).toContain('#<mark>type</mark>script')
  expect(tags).toContain('>follow</button>')
  expect(tags).toContain('id="tag-typescript"')
  expect(tags).toContain('href="/tag/typescript?from=%2Fexplore%3FtagsPage%3D3%23tag-typescript"')
  expect(tags).toContain('name="from" value="/explore?tagsPage=3#tag-typescript"')
  expect(people).toContain('@<mark>type</mark>writer')
  expect(people).toContain('<mark>Type</mark>s useful notes')
  expect(people).toContain('>unfollow</button>')
  expect(people).toContain('id="person-2"')
  expect(people).toContain('name="from" value="/search?q=type%20writer&amp;tab=people&amp;page=3#person-2"')
})

test('search post replies return to the originating result and page', () => {
  expect(searchPostReturnPath('ascii art', 1, 42)).toBe('/search?q=ascii%20art#post-42')
  expect(searchPostReturnPath('ascii art', 3, 42)).toBe('/search?q=ascii%20art&page=3#post-42')
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
  expect(html).toContain('class="account-settings-heading admin-header"')
  expect(html).toContain('class="profile-edit-link" href="/admin/email">send email</a>')
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

test('appearance theme tab is a server-rendered form with mobile appearance choices', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'sepia', accent: 'amber' },
    selectedFont: 'system',
  }))
  expect(html).toContain('<p class="eyebrow">account settings</p><h1>appearance</h1>')
  expect(html).toContain('action="/account/edit/appearance"')
  expect(html).toContain('aria-current="page">theme</a>')
  expect(html).toContain('name="theme" value="dracula"')
  expect(html).toContain('name="accent" value="rust"')
  expect(html).toContain('class="accent-swatch accent-swatch-rust"')
  expect(html).toContain('class="accent-swatch accent-swatch-theme accent-swatch-theme-sepia"')
  expect(html).toContain('name="theme" checked="" value="sepia"')
  expect(html).toContain('name="accent" checked="" value="amber"')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('style=')
})

test('appearance misc tab offers supported page sizes as radio cards', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    selectedPageSize: 40,
    selectedDensity: 'relaxed',
    tab: 'misc',
  }))
  expect(html).toContain('aria-current="page">misc</a>')
  expect(html).toContain('name="pageSize" value="20"')
  expect(html).toContain('name="pageSize" checked="" value="40"')
  expect(html).toContain('name="pageSize" value="80"')
  expect(html).toContain('name="pageSize" value="100"')
  expect(html).toContain('name="density" value="compact"')
  expect(html).toContain('name="density" value="regular"')
  expect(html).toContain('name="density" checked="" value="relaxed"')
  expect(html).toContain('class="density-preview density-preview-compact"')
  expect(html).toContain('class="density-preview density-preview-regular"')
  expect(html).toContain('class="density-preview density-preview-relaxed"')
  expect(html).toContain('save misc →')
})

test('account settings pages share one consistent heading', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const pages = [
    renderToStaticMarkup(React.createElement(ChangeAppearance, {
      user,
      selected: { theme: 'system', accent: 'theme' },
      selectedFont: 'system',
    })),
    renderToStaticMarkup(React.createElement(NotificationSettings, { user, publicKey: null })),
    renderToStaticMarkup(React.createElement(AccountSecurity, { user, sessions: [] })),
  ]
  for (const html of pages) {
    expect(html).toContain('class="account-settings-heading"')
    expect(html).toContain('<p class="eyebrow">account settings</p>')
    expect(html).toContain('<a class="profile-edit-link" href="/account/edit">back</a>')
  }
})

test('notification settings are the only account page that loads their client script', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const notifications = renderToStaticMarkup(React.createElement(NotificationSettings, {
    user,
    publicKey: 'public-key',
    returnPath: '/latest?page=2',
  }))
  const profile = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    posts: [],
    following: false,
    editing: true,
  }))
  expect(notifications).toContain('src="/notifications.js"')
  expect(notifications).toContain('data-handle="reader"')
  expect(notifications).toContain('class="static-page notifications-page"')
  expect(notifications).toContain('class="profile-edit-link" href="/account/edit?from=%2Flatest%3Fpage%3D2">back</a>')
  expect(notifications).toContain('enable notifications')
  expect(notifications).toContain('name="noteScope" checked="" value="latest"')
  expect(notifications).toContain('name="noteScope" value="following"')
  expect(notifications).toContain('name="notesEnabled" checked=""')
  expect(notifications).toContain('name="replies" checked=""')
  expect(notifications).toContain('name="mentions" checked=""')
  expect(notifications).toContain('name="follows" checked=""')
  expect(notifications).toContain('name="ownPosts" checked=""')
  expect(notifications).toContain('name="followActivity" checked=""')
  expect(notifications).toContain('notify @reader about')
  expect(notifications).toContain('replies to one of @reader’s notes')
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

test('appearance font tab lists local monospace fonts in their own families', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'consolas',
    tab: 'font',
  }))
  expect(html).toContain('action="/account/edit/appearance"')
  expect(html).toContain('aria-current="page">font</a>')
  expect(html).toContain('name="font" checked="" value="consolas"')
  expect(html).toContain('font-preview-sf-mono')
  expect(html).toContain('font-preview-dejavu-sans-mono')
  expect(html).toContain('font-preview-jetbrains-mono')
  expect(html).toContain('<span class="font-sample">Consolas</span>')
  expect(html).toContain('<span class="font-sample">System</span>')
  expect(html).toContain('name="fontSize" checked="" value="regular"')
  expect(html).toContain('<span>small</span>')
  expect(html).toContain('<span>regular</span>')
  expect(html).toContain('<span>large</span>')
  expect(html).toContain('<span>larger</span>')
  expect(html).toContain('name="primaryFont" checked="" value="monospace"')
  expect(html).toContain('<span>monospace</span>')
  expect(html).toContain('<span>sans-serif</span>')
  expect(html).toContain('name="sansSerifFont" checked="" value="system-sans"')
  expect(html).toContain('font-preview-inter')
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
  expect(html).toContain('<body class="density-regular"><a class="skip-link" href="#main-content">skip to content</a>')
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

test('Tag pages keep actions beside the tag and a contextual back link on the right', () => {
  const html = renderToStaticMarkup(React.createElement(TagFeed, {
    user: { id: 2, handle: 'reader', email: 'reader@example.com', bio: '' },
    tag: 'notes',
    following: false,
    posts: [],
    page: 1,
    total: 0,
    followerTotal: 23,
    returnPath: '/latest#post-2',
  }))

  expect(html).toContain('class="tag-title-actions"')
  expect(html).toContain(
    'class="tag-canonical-link" href="/tag/notes"><span class="identity-prefix">#</span>notes</a>',
  )
  expect(html).not.toContain('class="tag-canonical-link" href="/tag/notes?from=')
  expect(html).not.toContain('class="tag-note-count"')
  expect(html).toContain('class="profile-action tag-handle-actions"')
  expect(html).toContain('class="profile-edit-link tag-back-link" href="/latest#post-2">back</a>')
  expect(html).toContain('aria-current="page" href="/tag/notes?from=%2Flatest%23post-2">0 notes</a>')
  expect(html).toContain('href="/tag/notes?tab=followers&amp;from=%2Flatest%23post-2">23 followers</a>')
  expect(html.indexOf('>follow</button>')).toBeLessThan(html.indexOf('>block</button>'))
  expect(html.indexOf('>block</button>')).toBeLessThan(html.indexOf('>back</a>'))
})

test('Tag follower tabs list people with compact follow controls', () => {
  const html = renderToStaticMarkup(React.createElement(TagFeed, {
    user: { id: 2, handle: 'reader', email: 'reader@example.com', bio: '' },
    tag: 'notes',
    following: true,
    posts: [],
    people: [{ id: 3, handle: 'writer', email: 'writer@example.com', bio: 'Writes notes', posts: 14, suspended_at: null,
      deleted_at: null, viewerFollowing: false }],
    tab: 'followers',
    page: 1,
    total: 14,
    followerTotal: 1,
  }))

  expect(html).toContain('href="/tag/notes">14 notes</a>')
  expect(html).toContain('aria-current="page" href="/tag/notes?tab=followers">1 follower</a>')
  expect(html).toContain('id="person-3"')
  expect(html).toContain('href="/u/writer">@writer</a>')
  expect(html).toContain('action="/follow/writer"')
})

test('Hashtags in posts carry their originating post into the tag page', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    returnPath: '/latest#post-2',
    p: {
      id: 2,
      user_id: 1,
      parent_id: null,
      body: 'A #notes post',
      handle: 'writer',
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
    },
  }))

  expect(html).toContain('href="/tag/notes?from=%2Flatest%23post-2">#notes</a>')
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
  expect(html).toContain('data-method="DELETE" data-auth="true"><span class="api-auth-dot"')
  expect(html).toContain('data-method="GET" data-auth="true"><span class="api-auth-dot"')
  expect(html).toContain('class="api-path">/activities/for-you</span>')
  expect(html).toContain('class="api-path">/users/:handle/blocks</span>')
  expect(html).toContain('class="api-path">/activities/to-me/read-all</span>')
  expect(html).toContain('class="api-path">/users/:handle/following/tags</span>')
  expect(html).toContain('class="api-path">/tags/:tag/followers</span>')
  expect(html).toContain('class="api-path">/tags/:tag</span>')
  expect(html).not.toContain('Bearer token required.')
  expect(html).toContain('authentication bearer token required')
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
  const limited = renderToStaticMarkup(React.createElement(ErrorPage, {
    user: null,
    status: 429,
    message: 'Try again in about 12 minutes.',
  }))

  expect(client).toContain('aria-hidden="true">4xx</p>')
  expect(client).toContain('We couldn&#x27;t process that request.')
  expect(server).toContain('aria-hidden="true">5xx</p>')
  expect(server).toContain('Something went wrong.')
  expect(server).not.toContain('Intentional server error')
  expect(limited).toContain('Please slow down for a bit.')
  expect(limited).toContain('Try again in about 12 minutes.')
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
  test('forgot password form has a clear heading', () => {
    const html = renderToStaticMarkup(React.createElement(ForgotPassword))

    expect(html).toContain('<h1>Reset your password</h1>')
    expect(html).toContain('class="forgot-password-copy">Enter your email address or your handle')
    expect(html).toContain('<label for="forgot-password-identifier"><span>email address or handle</span></label>')
    expect(html).toContain('id="forgot-password-identifier"')
    expect(html).toContain('name="identifier"')
    expect(html.indexOf('<h1>')).toBeLessThan(html.indexOf('action="/forgot-password"'))
  })

  test('enter accepts an email address or handle', () => {
    const html = renderToStaticMarkup(React.createElement(Auth))

    expect(html).toContain('action="/enter"')
    expect(html).toContain('email address or handle')
    expect(html).toContain('name="identifier"')
    expect(html).toContain('placeholder="you@example.com or your_handle"')
    expect(html).not.toContain('type="password"')
  })

  test('handle choice explains validation without blocking the server submission', () => {
    const html = renderToStaticMarkup(React.createElement(ChooseHandle))

    expect(html).toContain('Handles must be 2–24 characters')
    expect(html).toContain('aria-describedby="handle-help"')
    expect(html).not.toContain('pattern=')
    expect(html).toContain('action="/choose-handle"')
  })

  test('handle choice preserves a rejected submitted handle and character-count error', () => {
    const html = renderToStaticMarkup(React.createElement(ChooseHandle, {
      handle: 'Too long!',
      error: 'You typed 9 characters. Use 2–24 letters, numbers, or underscores.',
    }))

    expect(html).toContain('value="Too long!"')
    expect(html).toContain('You typed 9 characters.')
  })

  test('carries a next destination through entry', () => {
    const next = '/post/42?reply=1'
    const enter = renderToStaticMarkup(React.createElement(Auth, { next }))

    expect(enter).toContain('name="next" value="/post/42?reply=1"')
  })

  test('password login submits its server-issued nonce', () => {
    const html = renderToStaticMarkup(React.createElement(PasswordLogin, { nonce: 'one-time-value' }))

    expect(html).toContain('type="hidden" name="nonce" value="one-time-value"')
    expect(html).toContain('email address or handle')
    expect(html).toContain('placeholder="you@example.com or your_handle"')
    expect(html).not.toMatch(/name="password"[^>]+value=/)
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

  test('password login errors retain only the identifier and focus the next field', () => {
    const passwordHtml = renderToStaticMarkup(React.createElement(PasswordLogin, {
      nonce: 'one-time-value',
      identifier: 'reader@example.com',
      error: 'Try again.',
    }))
    expect(passwordHtml).toContain('name="identifier"')
    expect(passwordHtml).toContain('value="reader@example.com"')
    expect(passwordHtml).toMatch(/id="login-password"[^>]+autofocus=""/)
    expect(passwordHtml).not.toMatch(/id="login-identifier"[^>]+autofocus/)

    const captchaHtml = renderToStaticMarkup(React.createElement(PasswordLogin, {
      nonce: 'one-time-value',
      identifier: 'reader@example.com',
      error: 'Try again.',
      captcha: { token: 'captcha-token', image: 'data:image/svg+xml;base64,PHN2Zy8+' },
    }))
    expect(captchaHtml).toMatch(/id="login-password"[^>]+autofocus=""/)
    expect(captchaHtml).not.toMatch(/id="login-captcha"[^>]+autofocus/)
    expect(captchaHtml).not.toMatch(/name="password"[^>]+value=/)
    expect(captchaHtml).not.toMatch(/name="captchaAnswer"[^>]+value=/)
  })

  test('check-your-email page accepts the one-time code', () => {
    const html = renderToStaticMarkup(React.createElement(MagicLinkSent, { email: 'reader@example.com' }))

    expect(html).toContain('Magic link and code sent to <strong>r•••@example.com</strong>')
    expect(html).not.toContain('>reader@example.com<')
    expect(html).toContain('action="/enter/code"')
    expect(html).toContain('or enter the six-digit code')
    expect(html).toContain('name="identifier" value="reader@example.com"')
    expect(html).toContain('name="code"')
    expect(html).toContain('pattern="[0-9]{6}"')
    expect(html).toContain('placeholder="123456"')
    expect(html).not.toContain('autofocus=""')
    expect(html).toContain('expire in 15 minutes')
  })

  test('email masking preserves only the first character and domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a•••@example.com')
    expect(maskEmail('a@example.com')).toBe('a•••@example.com')
  })

  test('check-your-email page does not reveal an email requested by handle', () => {
    const html = renderToStaticMarkup(React.createElement(MagicLinkSent, { email: 'reader', handle: true }))

    expect(html).toContain('Magic link and code sent to the email of <strong>reader</strong>')
    expect(html).toContain('name="identifier" value="reader"')
    expect(html).not.toContain('reader@example.com')
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
  expect(emailHtml).toContain('panel-danger')
  expect(emailHtml).toContain('class="button button-danger"')

  const tokenHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, {
    token: 'deletion-token',
  }))
  expect(tokenHtml).toContain('type="hidden" name="token" value="deletion-token"')
  expect(tokenHtml).toContain('>delete account</button>')

  const sentHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, { user, sent: true }))
  expect(sentHtml).toContain('Check your email.')
  expect(sentHtml).toContain('r•••@example.com')
  expect(sentHtml).not.toContain('reader@example.com')
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

  expect(html).toContain('r•••@example.com')
  expect(html).not.toContain('reader@example.com')
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
  expect(html).not.toContain('class="api-key-radio"')
  expect(html).not.toContain('<select name="lifetime"')
  expect(html).toContain('class="form-actions"')
  expect(html).toContain('class="secondary-action cancel-action" href="/account/security">cancel</a>')
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

  expect(html).toContain('<output class="form-control magic-link-value"')
  expect(html).toContain('https://textlog.cc/enter/magic?token=secret-token</output>')
  expect(html).toContain('app entry code')
  expect(html).toContain('>123456</output>')
  expect(html).toContain('href="/account/security"')
})

test('Profile edit offers a data download without rendering notes', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    editing: true,
    returnPath: '/latest?page=2',
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
  expect(html).toContain('href="/latest?page=2">back</a>')
  expect(html).toContain('type="hidden" name="from" value="/latest?page=2"')
  expect(html).toContain('href="/account/edit/appearance?from=%2Flatest%3Fpage%3D2"')
  expect(html).toContain('change appearance')
  expect(html).toContain('href="/account/security?from=%2Flatest%3Fpage%3D2"')
  expect(html).toContain('href="/account/edit/notifications?from=%2Flatest%3Fpage%3D2"')
  expect(html).toContain('Handles must be 2–24 characters')
  expect(html).toContain('aria-describedby="profile-handle-help"')
  expect(html).toContain('role="switch" name="isBot" value="yes"')
  expect(html).toContain('This account is a bot')
  expect(html).toContain('Bot notes are hidden from /latest')
  expect(html).not.toContain('visiting its profile.0')
  expect(html.indexOf('160 chars / 5 lines max')).toBeLessThan(html.indexOf('This account is a bot'))
  expect(html.indexOf('This account is a bot')).toBeLessThan(html.indexOf('save profile'))
  expect(html).not.toContain('pattern="[A-Za-z0-9_]{2,24}"')
  expect(html).not.toContain('hidden while editing')
})

test('Profile places owner actions in the handle row', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    posts: [],
    returnPath: '/latest#post-2',
  }))

  expect(html).toContain('class="profile-title-row"')
  expect(html).toContain(
    'class="profile-canonical-link" href="/u/reader"><span class="identity-prefix">@</span>reader</a>',
  )
  expect(html).not.toContain('class="profile-canonical-link" href="/u/reader?from=')
  expect(html).toContain('href="/account/edit">account</a>')
  expect(html).toContain('href="/latest#post-2">back</a>')
  expect(html).toContain('action="/logout"')
  expect(html).toContain('type="application/rss+xml" title="Notes by @reader (RSS)" href="/u/reader.rss"')
  expect(html).toContain('type="application/atom+xml" title="Notes by @reader (Atom)" href="/u/reader.atom"')
  expect(html).toContain('class="account-nav-row account-nav-primary"')
  expect(html).toContain('class="account-nav-row account-nav-secondary"')
  expect(html).toContain('class="account-menu-handle" href="/u/reader?from=%2F">@reader</a>')
  expect(html).toContain('class="account-menu-popover"')
  expect(html).toContain('href="/u/reader?from=%2F">profile</a>')
  expect(html).toContain('href="/account/edit?from=%2F">account</a>')
  expect(html).not.toContain('class="mobile-account-footer"')
  expect(html.indexOf('href="/write"')).toBeLessThan(html.indexOf('href="/u/reader?from=%2F"'))
  expect(html).toContain('<a class="button" href="/write">write a note</a>')
})

test('Profile places a contextual back link in the handle row', () => {
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: { id: 2, handle: 'visitor', email: 'visitor@example.com', bio: '' },
    profile: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' },
    following: false,
    posts: [],
    returnPath: '/latest#post-2',
  }))

  expect(html).toContain('class="profile-action profile-handle-actions"')
  expect(html).toContain('class="profile-action profile-back-action"')
  expect(html).toContain('href="/latest#post-2">back</a>')
  expect(html.indexOf('aria-label="follow @writer"')).toBeLessThan(html.indexOf('href="/latest#post-2">back</a>'))
  expect(html).toContain('href="/u/writer?from=%2Flatest%23post-2">0 notes</a>')
  expect(html).toContain('href="/u/writer?tab=replies&amp;from=%2Flatest%23post-2">0 replies</a>')
  expect(html).toContain('href="/u/writer?tab=following&amp;from=%2Flatest%23post-2"')
  expect(html).toContain('href="/u/writer?tab=followers&amp;from=%2Flatest%23post-2"')
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
  for (const page of [4, 6]) expect(html).toContain(`>${page}</`)
  expect(html).toContain('name="tagsPage" value="5"')
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
  for (const page of [2, 3, 17]) expect(first).toContain(`>${page}</`)
  expect(first).toContain('name="page" value="1"')
  expect(first).not.toContain('>4</')

  const last = render(17)
  for (const page of [1, 15, 16]) expect(last).toContain(`>${page}</`)
  expect(last).toContain('name="page" value="17"')
  expect(last).not.toContain('>14</')
})

test('Standard pagination uses the same three-page window as compact columns', () => {
  const render = (page: number) =>
    renderToStaticMarkup(React.createElement(Pagination, {
      page,
      totalPages: 17,
      path: '/latest',
    }))

  const first = render(1)
  for (const page of [2, 3, 17]) expect(first).toContain(`>${page}</`)
  expect(first).toContain('name="page" value="1"')
  expect(first).not.toContain('>4</')

  const middle = render(9)
  for (const page of [1, 8, 10, 17]) expect(middle).toContain(`>${page}</`)
  expect(middle).toContain('name="page" value="9"')
  expect(middle).not.toContain('>7</')

  const last = render(17)
  for (const page of [1, 15, 16]) expect(last).toContain(`>${page}</`)
  expect(last).toContain('name="page" value="17"')
  expect(last).not.toContain('>14</')
})

test('Top pagination omits its top border', () => {
  const html = renderToStaticMarkup(React.createElement(Pagination, {
    page: 2,
    totalPages: 10,
    path: '/latest',
    top: true,
  }))
  expect(html).toContain('class="pagination pagination-top"')
})

test('Current pagination page is an enter-to-navigate bounded input that preserves filters', () => {
  const html = renderToStaticMarkup(React.createElement(Pagination, {
    page: 5,
    totalPages: 17,
    path: '/u/writer?tab=replies',
  }))
  expect(html).toContain('<form class="pagination-current-form" aria-current="page"')
  expect(html).toContain('action="/u/writer" method="get"')
  expect(html).toContain('type="hidden" name="tab" value="replies"')
  expect(html).toContain('aria-label="Current page, 5 of 17"')
  expect(html).toContain(
    'type="number" min="1" max="17" required="" autoComplete="off" inputMode="numeric" enterKeyHint="go" name="page" value="5"',
  )
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

  expect(html).toContain('<span class="reference-menu"><a class="reference-menu-trigger" '
    + 'href="/tag/textlog">#TextLog</a><span class="reference-menu-popover reference-menu-popover-tag">'
    + '<span class="reference-profile-tabs"><a href="/tag/textlog">')
  expect(html).toContain('<a href="/tag/textlog?tab=followers">')
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

test('Profile note and reply actions link back to their originating feed entries', () => {
  const post = {
    id: 2,
    user_id: 1,
    parent_id: null,
    body: 'A note',
    handle: 'writer',
    created_at: '2026-08-03 12:00:00',
    deleted_at: null,
  }
  const profile = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const user = { id: 2, handle: 'reader', email: 'reader@example.com', bio: '' }
  const notes = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile,
    following: false,
    posts: [post],
    page: 2,
  }))
  const replies = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile,
    following: false,
    posts: [{ ...post, parent_id: 1 }],
    tab: 'replies',
    page: 2,
  }))

  expect(notes).toContain(
    'href="/post/2?reply=1&amp;from=%2Fu%2Fwriter%3Fpage%3D2%23post-2"',
  )
  expect(replies).toContain(
    'href="/post/2?reply=1&amp;from=%2Fu%2Fwriter%3Ftab%3Dreplies%26page%3D2%23post-2"',
  )
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
  expect(detailHtml).not.toContain('/post/2/delete')
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
  expect(feedHtml).toContain('id="post-2"')
  expect(feedHtml).toContain('class="post-hit-area" href="/post/2" aria-label="open post by @writer"')
  expect(detailHtml).not.toContain('post-hit-area')
})

test('Post carries its originating cursor into detail, reply, and edit links', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', email_verified_at: '2026-08-12 10:00:00',
      handle_chosen_at: '2026-08-12 10:00:00' },
    returnPath: '/latest?cursor=abc#post-2',
    tappable: true,
    showOwnerActions: true,
    p: {
      id: 2,
      user_id: 1,
      parent_id: null,
      body: 'note @friend #topic',
      handle: 'writer',
      bio: 'Writer bio',
      mention_bios: { friend: 'Friend bio' },
      mention_note_counts: { friend: 1 },
      mention_profile_stats: { friend: { notes: 1, replies: 0, followers: 0, following: 0, followingTags: 0 } },
      mention_following: { friend: false },
      hashtag_counts: { topic: 1 },
      hashtag_follower_counts: { topic: 2 },
      hashtag_following: { topic: false },
      created_at: '2026-08-03 12:00:00',
      deleted_at: null,
    },
  }))

  expect(html).toContain('href="/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('href="/post/2?reply=1&amp;from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('href="/post/2/edit?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('<input type="hidden" name="from" value="/latest?cursor=abc#post-2"/>')
  expect(html).toContain('id="post-2-user-friend" action="/follow/friend" method="post"')
  expect(html).toContain('id="post-2-user-friend-block" action="/block/friend" method="post"')
  expect(html).toContain('id="post-2-tag-topic" action="/tag-follow/topic" method="post"')
  expect(html).toContain('id="post-2-tag-topic-block" action="/tag-block/topic" method="post"')
  expect(html).toContain('href="/tag/topic?tab=followers&from=%2Flatest%3Fcursor%3Dabc%23post-2">2 followers</a>')
  expect(html).not.toContain('/post/2/delete')
})

test('Post-page timestamp links to the canonical post URL', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 2, user_id: 1, parent_id: null, body: 'A note', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
    user: null,
    returnPath: '/latest?page=2#post-2',
    canonicalTimestamp: true,
  }))
  expect(html).toContain('class="postdate" href="/post/2"')
  expect(html).not.toContain('class="postdate" href="/post/2?from=')
})

test('Reply pages show a top link immediately after the timestamp', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 1, parent_id: 2, body: 'A reply', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
    user: null,
    canonicalTimestamp: true,
    topHref: '/post/1?from=%2Flatest%23post-3',
  }))
  expect(html).toContain('</a><a class="quiet post-top-link" href="/post/1?from=%2Flatest%23post-3">top</a>')
})

test('conversation top links return to the deep reply and preserve its original back path', () => {
  expect(conversationTopPath(1, 3)).toBe('/post/1?from=%2Fpost%2F3%23post-3#post-1')
  expect(conversationTopPath(1, 3, '/latest#post-3'))
    .toBe('/post/1?from=%2Fpost%2F3%3Ffrom%3D%252Flatest%2523post-3%23post-3#post-1')
})

test('thread replies use their own permanent anchor as the next return path', () => {
  expect(replyAnchorReturnPath(2, 7)).toBe('/post/2#post-7')
  expect(replyAnchorReturnPath(2, 7, '/latest?cursor=abc#post-2'))
    .toBe('/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2#post-7')
})

test('a posted reply returns to its originating thread and preserves that thread back path', () => {
  const thread = '/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2#post-7'
  expect(postedReplyPath(7, 9, thread))
    .toBe('/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2#post-9')
  expect(postedReplyPath(7, 9, '/latest#post-7'))
    .toBe('/post/7?from=%2Flatest%23post-7#post-9')
})

test('A quoted post gets its own higher-priority hit area in tappable feeds', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 9, handle: 'reader', email: 'reader@example.com', bio: '' },
    tappable: true,
    returnPath: '/latest?cursor=abc#post-2',
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
  expect(html).toContain('class="reference-menu-trigger postauthor" '
    + 'href="/u/writer?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('class="parent-hit-area" href="/post/1?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('class="reference-menu-trigger postauthor" '
    + 'href="/u/parent?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('class="postdate" href="/post/1?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('href="/post/1?reply=1&amp;from=%2Flatest%3Fcursor%3Dabc%23post-2"')
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
