import { describe, expect, test } from 'bun:test'
import { ConnectionPeople, Pagination, paginationHeadingClass, TagChips } from './components/page-shared'
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
  BlogBuildingWithoutJavascript,
  BlogRecap,
  BlogRecapV2,
  ChangeAppearance,
  ChooseHandle,
  Compose,
  ConfirmAccountDelete,
  ConfirmDelete,
  ConfirmEmail,
  Connections,
  Contact,
  Drafts,
  EditPost,
  EmbedExamples,
  ErrorPage,
  Explore,
  ForgotPassword,
  InteractedEmails,
  Legal,
  MagicLinkSent,
  NotFound,
  NotificationSettings,
  PanelsGallery,
  PasswordLogin,
  postTitle,
  Profile,
  PublicThread,
  RecapEmails,
  Reply,
} from './components/pages'
import { approximatePostAge, conversationTopPath, FeedThreads, isProbablyNonEnglish, Post, postAgeTitle,
  postAnchorId, postedReplyPath, PreviewPost, replyAnchorReturnPath, shortPostAge, ThreadReplies } from './components/post'
import { searchPersonReturnPath, searchPostReturnPath, SearchResults } from './components/search'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { maskEmail } from './components/auth'
import { HotFeed } from './components/hot-feed'
import { Layout } from './components/layout'
import { PublicFeed } from './components/public-feed'
import { TagFeed } from './components/tag-feed'
import { withAppearance } from './theme'

test('mobile account navigation uses an in-flow details menu', () => {
  const request = new Request('https://textlog.test/', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' },
  })
  const html = withAppearance(request, () =>
    renderToStaticMarkup(React.createElement(Layout, {
      user: { id: 1, handle: 'reader', mood: '🤸', email: 'reader@example.com', bio: '',
        handle_chosen_at: '2026-01-01' },
      children: React.createElement('p', null, 'Hello'),
    })))

  expect(html).toContain('<details class="account-menu"><summary class="account-menu-handle">@reader'
    + '<span class="nav-mood">🤸</span></summary>')
  expect(html).not.toContain('popoverTarget="account-menu-popover"')
  expect(html).not.toContain('popover="auto"')
})

test('write page omits the redundant header write action', () => {
  const request = new Request('https://textlog.test/write')
  const html = withAppearance(request, () =>
    renderToStaticMarkup(React.createElement(Layout, {
      user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-01-01' },
      children: React.createElement('p', null, 'Write'),
    })))

  expect(html).not.toContain('class="button nav-write-action"')
})

test('write page shows a back button above the form when a return path is available', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    email_verified_at: '2026-01-01', handle_chosen_at: '2026-01-01' }
  const html = renderToStaticMarkup(React.createElement(Compose, { user, returnPath: '/latest?page=2', showBack: true }))

  expect(html).toContain('class="profile-edit-link compose-back-link" href="/latest?page=2">back</a>')
  expect(html).toContain('<div class="page-header compose-heading-row compose-heading-row-with-back"><h2>'
    + 'What’s on your mind, <span class="compose-heading-at">@</span>reader?</h2>'
    + '<a class="profile-edit-link compose-back-link"')
  expect(html).toContain('type="hidden" name="show_back" value="1"')
  expect(html).not.toContain('placeholder="What’s on your mind, @reader?"')
  expect(html.indexOf('>back</a>')).toBeLessThan(html.indexOf('write-compose'))
})

test('write preview places its heading and back link in the same row', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    email_verified_at: '2026-01-01', handle_chosen_at: '2026-01-01' }
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user, body: 'Preview me', preview: true, returnPath: '/latest', showBack: true,
  }))

  expect(html).toContain('<div class="compose-preview-heading"><h2>preview</h2>'
    + '<a class="profile-edit-link compose-back-link" href="/latest">back</a></div>')
  expect(html).not.toContain('class="page-header compose-heading-row')
})

test('header write action appears outside feed pages', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', handle_chosen_at: '2026-01-01',
    draft_count: 1 }
  const renderPath = (path: string) => withAppearance(new Request(`https://textlog.test${path}`), () =>
    renderToStaticMarkup(React.createElement(Layout, {
      user,
      children: React.createElement('p', null, 'Page'),
    })))

  for (const path of ['/@', '/my-feed', '/hot', '/any', '/new', '/all']) {
    expect(renderPath(path)).not.toContain('class="button nav-write-action"')
  }
  expect(renderPath('/explore')).toContain(
    '<a class="button nav-write-action" href="/write?from=%2Fexplore">write</a>',
  )
  expect(renderPath('/explore')).toContain('<a href="/drafts?from=%2Fexplore">drafts</a>')
  expect(renderPath('/drafts')).toContain('<a href="/drafts">drafts</a>')
})

test('admin navigation is the first child in the handle menu', () => {
  const html = renderToStaticMarkup(React.createElement(Layout, {
    user: { id: 1, handle: 'admin', mood: '🤸', email: 'gstagas@gmail.com', bio: '' },
    children: React.createElement('p', null, 'Hello'),
  }))

  expect(html).toContain(
    '<div class="account-menu-popover"><a href="/admin">admin</a><a href="/u/admin?from=%2F">profile</a>',
  )
  expect(html).toContain('>@admin<span class="nav-mood">🤸</span></a>')
  expect(html.indexOf('href="/admin">admin</a>')).toBeLessThan(html.indexOf('action="/logout"'))
})

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

test('blog recap uses the site layout and shared post presentation', () => {
  const html = renderToStaticMarkup(React.createElement(BlogRecap, {
    user: null,
    pageUrl: 'https://textlog.test/blog/recap-v1',
    posts: [{
      id: 925,
      user_id: 1,
      parent_id: null,
      body: 'A memorable #note',
      created_at: '2026-01-01 12:00:00',
      deleted_at: null,
      handle: 'writer',
      reply_count: 2,
    }],
  }))

  expect(html).toContain('<header>')
  expect(html).toContain('<article class="static-page recap-page">')
  expect(html).toContain('<article class="post tappable-post" id="post-925">')
  expect(html).toContain('href="/post/925?from=%2Fblog%2Frecap-v1%23post-925"')
  expect(html).toContain('A lot has happened.<br/>Quietly, of course.')
  expect(html).toContain('<a class="button" href="/about">about textlog</a><a class="button" href="/hot">')
  expect(html).toContain('class="site-footer"')
})

test('total recap presents the complete feature story and popular conversations', () => {
  const html = renderToStaticMarkup(React.createElement(BlogRecapV2, {
    user: null,
    pageUrl: 'https://textlog.test/blog/recap-v2',
    posts: [{
      id: 1200,
      user_id: 2,
      parent_id: null,
      body: 'A conversation starter',
      created_at: '2026-08-01 12:00:00',
      deleted_at: null,
      handle: 'writer',
      reply_count: 18,
    }],
  }))

  expect(html).toContain('What textlog has become')
  expect(html).toContain('The conversations that grew')
  expect(html).toContain('class="post-page-thread feed-thread"')
  expect(html).toContain('href="/post/1200?from=%2Fblog%2Frecap-v2%23post-1200"')
  expect(html).not.toContain('post-continuation-link')
  expect(html).toContain('join the community')
  expect(html).toContain('browse notes →')
})

test('building without JavaScript blog post renders its Markdown as an article', () => {
  const html = renderToStaticMarkup(React.createElement(BlogBuildingWithoutJavascript, {
    user: null,
    pageUrl: 'https://textlog.test/blog/building-textlog-without-javascript',
  }))

  expect(html).toContain(
    '<article class="static-page blog-article"><div class="blog-article-copy"><h1>Building textlog without JavaScript</h1>',
  )
  expect(html).toContain('<blockquote>')
  expect(html).toContain('<code>UI = f(state)</code>')
  expect(html).toContain('<em>clarity</em>')
  expect(html).toContain('<code>&lt;details&gt;</code>')
  expect(html).toContain('<code class="hljs">app.<span class="hljs-title function_">post</span>')
  expect(html).toContain('class="button" href="/enter" rel="nofollow">join the community</a>')
  expect(html).toContain('href="/hot">browse notes</a>')
  expect(html).toContain('property="og:type" content="article"')
  expect(html).not.toContain('# Building textlog without JavaScript')
})

test('locked notes and descendants omit reply controls and reply forms', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const post = { id: 9, user_id: 2, parent_id: null, body: 'Closed #lock', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'writer', reply_count: 0, thread_locked: true }
  const card = renderToStaticMarkup(React.createElement(Post, { p: post, user, showReplyAction: true }))
  const page = renderToStaticMarkup(React.createElement(Reply, { user, post, showForm: true }))

  expect(card).not.toContain('post-reply-link')
  expect(page).not.toContain('class="panel panel-surface panel-medium replybox"')
})

test('post page reply forms only autofocus when reply was explicitly requested', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    email_verified_at: '2026-08-01 10:00:00' }
  const post = { id: 9, user_id: 2, parent_id: null, body: 'Open note', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'writer', reply_count: 0 }
  const passive = renderToStaticMarkup(React.createElement(Reply, { user, post, showForm: true, autoFocus: false }))
  const requested = renderToStaticMarkup(React.createElement(Reply, { user, post, showForm: true, autoFocus: true }))

  expect(passive).toContain('class="panel panel-surface panel-medium replybox reply-compose root-reply-compose"')
  expect(passive).not.toContain('autofocus=""')
  expect(requested).toContain('autofocus=""')
})

test('replying to your own post invites you to continue writing', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-01 10:00:00' }
  const post = { id: 9, user_id: 1, parent_id: null, body: 'First thought', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'writer', reply_count: 0 }
  const page = renderToStaticMarkup(React.createElement(Reply, { user, post, showForm: true }))

  expect(page).toContain('placeholder="Continue writing…"')
  expect(page).not.toContain('placeholder="Reply to @writer…"')
})

test('replying to a threaded reply keeps the root page and places the composer after its target', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    email_verified_at: '2026-08-01 10:00:00' }
  const post = { id: 9, user_id: 2, parent_id: null, body: 'Root note', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'writer', reply_count: 1 }
  const target = { id: 10, user_id: 3, parent_id: 9, body: 'Threaded reply #topic',
    created_at: '2026-08-23 11:00:00', deleted_at: null, handle: 'friend', reply_count: 0, parent: post }
  const page = renderToStaticMarkup(React.createElement(Reply, {
    user, post, replies: [target], showForm: true, autoFocus: true, replyTo: target,
    returnPath: '/all#post-10',
  }))

  expect(page).not.toContain('href="/post/9?reply=1&amp;to=10#post-10"')
  expect(page).toContain('href="/post/9?reply=1&amp;from=%2Fall%23post-10"')
  expect(page.match(/post-reply-link/g)).toHaveLength(1)
  expect(page).toContain('<form action="/post/10/reply#post-10" method="post">')
  expect(page).toContain('<input type="hidden" name="reply_page_id" value="9"/>')
  expect(page.indexOf('id="post-10"')).toBeLessThan(page.indexOf('action="/post/10/reply#post-10"'))
  expect(page).toContain('placeholder="Reply to @friend…"')
  expect(page).toContain('class="inline-reply-compose" style="--reply-offset:calc(clamp(18px, 3vw, 28px))"')
  expect(page).toContain('class="quiet post-back-link" href="/all#post-10">back</a>')
  expect(page).toContain(
    '<form class="reference-follow-form" id="post-10-tag-topic" action="/tag-follow/topic" method="post">'
      + '<input type="hidden" name="from" value="/post/9?to=10&amp;from=%2Fall%23post-10#post-10"/>',
  )
})

test('post anchors embedded in return paths identify the inline reply target', () => {
  expect(postAnchorId('/all?expand=209#post-2922')).toBe(2922)
})

test('account switcher errors use the shared error notice', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(AccountSwitcher, {
    user,
    accounts: [{ id: 1, handle: 'reader', handle_chosen_at: '2026-08-12 10:00:00', primary: true, selected: true }],
    error: 'Could not switch accounts.',
  }))

  expect(html).toContain('class="status-message status-error" role="alert">Could not switch accounts.</p>')
  expect(html).not.toContain('class="error"')
})

test('auth pages render through the shared centered panel', () => {
  const html = renderToStaticMarkup(React.createElement(Auth, {}))
  expect(html).toContain('<body class="density-regular full-screen-page full-screen-scrollable">')
  expect(html).toContain('class="panel-shell auth-shell enter-shell"')
  expect(html).toContain('class="panel panel-surface panel-narrow auth-panel enter-panel"')
  expect(html).toContain('class="brand enter-brand"')
  expect(html).not.toContain('<header')
  expect(html).not.toContain('<footer')
})

test('compose offers a server-rendered post preview', () => {
  const user = { id: 1, handle: 'writer', mood: '🌞', email: 'writer@example.com', bio: 'Writes things',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const form = renderToStaticMarkup(React.createElement(Compose, { user }))
  const preview = renderToStaticMarkup(React.createElement(Compose, {
    user,
    body: 'Hello @reader, see #world at https://example.com',
    preview: true,
  }))

  expect(form).toContain('title="Preview this post before publishing" name="action">preview</button>')
  expect(form).toContain('title="Enrich post with hashtags" name="action">autotag')
  expect(form).not.toContain('compose-new-badge')
  expect(form.indexOf('>autotag')).toBeLessThan(form.indexOf('>preview</button>'))
  expect(form).toContain('class="button" accessKey="p" title="Publish this post">post →</button>')
  expect(form.indexOf('>preview</button>')).toBeLessThan(form.indexOf('>post →</button>'))
  expect(preview).toContain('<h2>preview</h2>')
  expect(preview).toContain('What’s on your mind')
  expect(preview.indexOf('<h2>preview</h2>')).toBeLessThan(preview.indexOf('<form action="/post" method="post">'))
  expect(preview).not.toContain('<h1 class="compose-heading">')
  expect(preview).not.toContain('placeholder="What’s on your mind, @writer?"')
  expect(preview.indexOf('<form action="/post" method="post">')).toBeLessThan(preview.indexOf('<textarea'))
  expect(preview.indexOf('<div class="compose-post-preview">')).toBeLessThan(
    preview.indexOf('<div class="panel panel-surface panel-medium compose write-compose">'),
  )
  expect(preview.slice(
    preview.indexOf('<div class="panel panel-surface panel-medium compose write-compose">'),
  )).not.toContain('<div class="compose-post-preview">')
  expect(preview).toContain('Hello <a href="/u/reader">@reader</a>, see <a href="/tag/world"')
  expect(preview).toContain('<a href="https://example.com" class="raw-link"')
  expect(preview).toContain(
    '<div class="posttop posttop-context preview-post-meta"><span class="post-context post-context-author">you'
      + '<span class="post-mood">🌞</span></span>',
  )
  expect(preview).not.toContain('<span class="postauthor post-context-author">you</span>')
  expect(preview).toContain('<span class="post-context">wrote:</span>')
  expect(preview).not.toContain('<span class="postdate">read</span>')
  expect(preview).not.toContain('href="/post/0"')
  expect(preview).not.toContain('preview-reply')
  expect(preview).not.toContain('href="#"')
  expect(preview).not.toContain('NaN')
})

test('compose previews inline polls with their visible tag and options', () => {
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '', email_verified_at: '2026-08-20' },
    body: 'Best OS? #poll\nWindows\nMacOS\nLinux',
    preview: true,
  }))
  expect(html).toContain('Best OS? <a href="/tag/poll')
  expect(html).toContain('aria-label="Poll preview"')
  expect(html).toContain('>Windows</div>')
  expect(html).toContain('>MacOS</div>')
  expect(html).toContain('>Linux</div>')
})

test('compose previews map locations with the stored-style hovercard', () => {
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '', email_verified_at: '2026-08-20' },
    body: 'Going hiking #map\nKallikratis, Crete',
    preview: true,
    previewLocation: { query: 'Kallikratis, Crete', latitude: 35.2, longitude: 24.2,
      displayName: 'Kallikratis, Crete, Greece',
      url: 'https://www.openstreetmap.org/?mlat=35.2&mlon=24.2#map=3/35.2/24.2',
      preview: { imageUrl: '/uploads/location-maps/test.png', title: 'Kallikratis',
        description: 'Crete, Greece', imageWidth: 600, imageHeight: 315 } },
  }))
  expect(html).toContain('href="/tag/map')
  expect(html).toContain('noopener noreferrer">Kallikratis, Crete</a><a class="remote-link-popover"')
  expect(html).toContain('/uploads/location-maps/test.png')
})

test('compose previews quizzes and identifies the correct answer', () => {
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '', email_verified_at: '2026-08-20' },
    body: 'Capital of Greece? #quiz\nRome\n> Athens\nParis\n\nAthens *is* the capital.',
    preview: true,
  }))
  expect(html).toContain('Capital of Greece? <a href="/tag/quiz')
  expect(html).toContain('aria-label="Quiz preview"')
  expect(html).toContain(
    'quiz-correct">Athens<span class="quiz-mark quiz-mark-correct" aria-label="correct">✓</span></div>',
  )
  expect(html).toContain('<div class="quiz-explanation">Athens <strong>is</strong> the capital.</div>')
})

test('todos are clickable only for their author', () => {
  const body = 'Weekend #todo\n[ ] Buy milk\n[x] Call Sam'
  const post = { id: 7, user_id: 1, parent_id: null, body, created_at: '2026-08-23 10:00:00', deleted_at: null,
    handle: 'writer', reply_count: 0 }
  const author = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const viewer = { id: 2, handle: 'reader', email: 'reader@example.com', bio: '' }
  const owned = renderToStaticMarkup(React.createElement(Post, { p: post, user: author }))
  const viewed = renderToStaticMarkup(React.createElement(Post, { p: post, user: viewer }))

  expect(owned).toContain('Weekend <a href="/tag/todo')
  expect(owned).toContain('action="/post/7/todo"')
  expect(owned).toContain('<span class="todo-check" aria-hidden="true">[ ]</span>')
  expect(owned).toContain('<span class="todo-check todo-check-checked" aria-hidden="true">[✓]</span>')
  expect(owned).toContain('<span class="todo-label todo-done">Call Sam</span>')
  expect(viewed).toContain('class="todo-item todo-item-static"')
  expect(viewed).not.toContain('action="/post/7/todo"')
})

test('top-level edit previews render todo items and preserve their leading blank line', () => {
  const html = renderToStaticMarkup(React.createElement(PreviewPost, { p: {
    id: 7,
    user_id: 1,
    parent_id: null,
    body: 'my today\'s #todo list\n\n[x] wake up\n[ ] work',
    created_at: '2026-08-23 10:00:00',
    deleted_at: null,
    handle: 'writer',
    reply_count: 0,
  } }))

  expect(html).toContain('aria-label="Todo preview"')
  expect(html).toContain('class="todo-text"> </div>')
  expect(html).toContain('<span class="todo-check todo-check-checked" aria-hidden="true">[✓]</span>')
  expect(html).toContain('<span class="todo-check" aria-hidden="true">[ ]</span>')
})

test('todo previews preserve regular text between checkbox lines', () => {
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '', email_verified_at: '2026-08-20' },
    body: 'my today\'s #todo list\n\n[x] wake up\n[x] drink coffee\n[ ] work\nand possibly\n[ ] contemplate existence',
    preview: true,
  }))
  expect(html.indexOf('>work</span>')).toBeLessThan(html.indexOf('>and possibly</div>'))
  expect(html.indexOf('>and possibly</div>')).toBeLessThan(html.indexOf('>contemplate existence</span>'))
})

test('todos compose with spoiler sections while preserving toggle indices', () => {
  const body = '#todo\n[ ] visible task\n#spoiler\n[x] hidden task\n[ ] another hidden task'
  const post = { id: 7, user_id: 1, parent_id: null, body, created_at: '2026-08-23 10:00:00', deleted_at: null,
    handle: 'writer', reply_count: 0 }
  const author = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Post, { p: post, user: author }))

  expect(html).toContain('<div class="todo-text"><a href="/tag/spoiler?from=')
  expect(html).toContain('>#spoiler</a></div><div class="post-spoiler todo-spoiler">')
  expect(html).toContain('<span>reveal</span></label><div class="post-spoiler-content">')
  expect(html).toContain('<input type="hidden" name="item" value="1"/>')
  expect(html.indexOf('<span>reveal</span>')).toBeLessThan(html.indexOf('>hidden task</span>'))
  expect(html.indexOf('>hidden task</span>')).toBeLessThan(html.indexOf('>another hidden task</span>'))
})

test('todo text and labels render links, Markdown, and LaTeX', () => {
  const body = '#todo\nRead #notes and [the docs](https://example.com/docs)\n[ ] Calculate $x^2$ for @reader'
  const post = { id: 7, user_id: 1, parent_id: null, body, created_at: '2026-08-23 10:00:00', deleted_at: null,
    handle: 'writer', reply_count: 0, mention_bios: { reader: 'A reader' } }
  const author = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Post, { p: post, user: author }))

  expect(html).toContain('<a href="/tag/notes?from=')
  expect(html).toContain('<a href="https://example.com/docs" title="https://example.com/docs"')
  expect(html).toContain('>the docs</a>')
  expect(html).toContain('<math')
  expect(html).toContain('href="/u/reader?from=')
  expect(html.indexOf('</button><span class="todo-label">')).toBeGreaterThan(-1)
})

test('todo references and links render the same hover cards as post text', () => {
  const body = '#todo\n[ ] Read #notes with @reader at https://example.com/docs'
  const post = { id: 7, user_id: 1, parent_id: null, body, created_at: '2026-08-23 10:00:00', deleted_at: null,
    handle: 'writer', reply_count: 0, mention_bios: { reader: 'A reader' }, hashtag_counts: { notes: 3 },
    hashtag_follower_counts: { notes: 2 }, link_previews: {
      'https://example.com/docs': { imageUrl: 'https://example.com/preview.png', title: 'Example docs',
        description: 'Documentation' },
    } }
  const author = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Post, { p: post, user: author }))

  expect(html).toContain('href="/tag/notes?from=')
  expect(html).toContain('class="reference-menu-popover reference-menu-popover-tag"')
  expect(html).toContain('class="reference-menu"')
  expect(html).toContain('class="remote-link-menu"')
  expect(html).toContain('Example docs')
})

test('quoted parents render their todos', () => {
  const user = { id: 2, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Post, { user, showParent: true, p: {
    id: 8,
    user_id: 2,
    parent_id: 7,
    body: 'reply',
    created_at: '2026-08-23 10:01:00',
    deleted_at: null,
    handle: 'reader',
    reply_count: 0,
    parent: { id: 7, user_id: 1, parent_id: null, body: '#todo\n[ ] quoted task', created_at: '2026-08-23 10:00:00',
      deleted_at: null, handle: 'writer', reply_count: 1 },
  } }))

  expect(html).toContain('<blockquote class="parent-quote"')
  expect(html).toContain('aria-label="Todo list"')
  expect(html).toContain('<span class="todo-label">quoted task</span>')
  expect(html).not.toContain('action="/post/7/todo"')
})

test('draft cards linkify mentions, hashtags, and links', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Drafts, {
    user,
    drafts: [{ id: 7, public_id: 'draft-public-id', parent_id: null, body: '@reader #world https://example.com', created_at: '2026-08-23 10:00:00',
      updated_at: '2026-08-23 10:00:00' }],
  }))

  expect(html).toContain('<a href="/u/reader?from=%2Fpost%2F-7%23post--7">@reader</a>')
  expect(html).toContain('<a href="/tag/world?from=%2Fpost%2F-7%23post--7">#world</a>')
  expect(html).toContain('<a href="https://example.com" class="raw-link"')
})

test('compose carries its originating page without a redundant cancel action', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user,
    returnPath: '/latest?cursor=abc#post-2',
  }))

  expect(html).toContain('name="from" value="/latest?cursor=abc#post-2"')
  expect(html).not.toContain('class="secondary-action cancel-action edit-post-cancel"')
})

test('posting helpers use the compact action and show copyable highlighted results above actions', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '',
    email_verified_at: '2026-08-12 10:00:00', handle_chosen_at: '2026-08-12 10:00:00' }
  const html = renderToStaticMarkup(React.createElement(Compose, {
    user,
    body: 'A draft worth keeping',
    suggestionSearch: { kind: 'hashtags', query: 'type', results: ['typescript', 'typestyle'], truncated: true },
  }))

  expect(html).toContain('<label class="secondary-action posting-help-action" for="write-posting-help"')
  expect(html).toContain('title="Show more writing actions and help"')
  expect(html).toContain('/>more</label>')
  expect(html).toContain('id="write-posting-help" type="checkbox" aria-controls="write-posting-help-content" checked=""')
  expect(html).toContain('class="posting-help-actions"')
  expect(html.indexOf('value="search-hashtags"')).toBeLessThan(html.indexOf('class="posting-help-actions"'))
  expect(html).toContain('<span class="posting-help-limits">500 chars / 15 lines max</span>')
  expect(html).toContain(' · use #hashtags, @mentions and more</div>')
  expect(html).not.toContain('<h2>Find hashtags and people</h2>')
  expect(html).not.toContain('<h2>Formatting</h2>')
  expect(html).toContain('class="posting-help-tabs" aria-label="Writing help"')
  expect(html).toContain('>emoji</label>')
  expect(html).toContain('>formatting</label>')
  expect(html).toContain('>tags</label>')
  expect(html).toContain('>search</label>')
  expect(html).toContain('class="posting-help-formatting-panel posting-help-tab-panel"')
  expect(html).toContain('class="posting-help-modifiers-panel posting-help-tab-panel"')
  expect(html).toContain('<dt>Strikethrough</dt>')
  expect(html).toContain('<b>~</b>text<b>~</b> or <b>~~</b>text<b>~~</b>')
  expect(html).toContain('<b>|</b>redacted<b>|</b>')
  expect(html).toContain('<dt>Redacted</dt>')
  expect(html).toContain('<b>&gt;</b> text')
  expect(html).toContain('<dt>Quote</dt>')
  expect(html).toContain('<b>1.</b> first<br/><b>2.</b> second<br/><b>3.</b> third')
  expect(html).toContain('<dt>Numbered lists</dt>')
  expect(html).toContain('<b>-</b> first<br/><b>-</b> second<br/><b>-</b> third')
  expect(html).toContain('<dt>Bulleted lists</dt>')
  expect(html).toContain('<dt>Tables</dt>')
  expect(html).toContain(
    'Name\u00a0 <b>|</b> Status <b>|</b> Count<br/>----- <b>|</b> :----- <b>|</b> ----:<br/>'
      + 'notes <b>|</b> ready\u00a0 <b>|</b> \u00a0\u00a0\u00a0\u00a03',
  )
  expect(html.indexOf('<dt>Inline code</dt>')).toBeLessThan(html.indexOf('<dt>Code fences</dt>'))
  expect(html.indexOf('<dt>Redacted</dt>')).toBeLessThan(html.indexOf('<dt>Inline code</dt>'))
  expect(html.indexOf('<dt>Code fences</dt>')).toBeLessThan(html.indexOf('<dt>Inline LaTeX</dt>'))
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Polls</span><small>Use 2–8 unique options.</small>',
  )
  expect(html).toContain('Which one? <b>#poll</b><br/>First option<br/>Second option')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Spoilers</span><small>Text after #spoiler is hidden until revealed. Aliases: #tldr, #sensitive, #contentwarning, #cw, and #triggerwarning.</small>',
  )
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Maps</span><small>Shows a map preview for the first location line. Alias: #location.</small>',
  )
  expect(html).toContain('Visible text <b>#spoiler</b><br/>Hidden text')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Todos</span><small>Only [ ] and [x] lines become items.',
  )
  expect(html).toContain('Today <b>#todo</b><br/><b>[ ]</b> First task<br/><b>[x]</b> Finished task')
  expect(html).toContain('Only [ ] and [x] lines become items. Click your items to toggle them.')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Executable code</span><small>Runs the next language-tagged code fence',
  )
  expect(html).toContain('Run this <b>#exec</b><br/><b>```js</b><br/>console.log(6 * 7)<br/><b>```</b>')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Pinned notes</span><small>Your latest #pin is shown first on your profile',
  )
  expect(html).toContain('Keep this visible <b>#pin</b>')
  expect(html).toContain('Your latest #pin is shown first on your profile, independently for notes and replies.')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Locked conversations</span><small>Prevents new replies to this note',
  )
  expect(html).toContain('No more replies <b>#lock</b>')
  expect(html).toContain('Prevents new replies to this note and every reply beneath it.')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Meta conversations</span><small>Keeps this note and its replies '
      + 'out of public discovery feeds. Aliases: #tlog and #textlog.</small>',
  )
  expect(html).toContain('About textlog <b>#meta</b>')
  expect(html).toContain(
    '<span class="posting-help-modifier-heading">Whisper conversations</span><small>Keeps the branch out of all and hot.',
  )
  expect(html).toContain('Continue quietly <b>#whisper</b>')
  expect(html).toContain('Participants, mentions, and tag followers can receive it in my feed.')
  expect(html).toContain('It remains public elsewhere.')
  expect(html).not.toContain('<h2>Emoji</h2>')
  expect(html).toContain('class="posting-help-emoji-panel posting-help-tab-panel" aria-label="Emoji to copy and paste"')
  expect(html).toContain('title="Select and copy">😀</span>')
  expect(html).toContain('placeholder="search hashtags"')
  expect(html).toContain('placeholder="search handles"')
  expect(html).toContain('value="search-hashtags" formNoValidate="" name="action"')
  expect(html).toContain('value="search-mentions" formNoValidate="" name="action"')
  expect(html).toContain(
    'autofocus="" aria-label="What’s on your mind, @writer?" autoComplete="off" inputMode="text" '
      + 'enterKeyHint="enter">A draft worth keeping</textarea>',
  )
  expect(html).toContain('#<mark>type</mark>script')
  expect(html).toContain('class="posting-suggestion-result" title="Select and copy"')
  expect(html).toContain('<span aria-label="More results">...</span>')
  expect(html).not.toContain('href="/tag/typescript"')
  expect(html.indexOf('class="posting-suggestion-results"')).toBeLessThan(html.indexOf('class="composefoot"'))
})

test('post edit keeps destructive navigation above the textarea and secondary writing actions under more', () => {
  const user = { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' }
  const post = { id: 2, user_id: 1, parent_id: null, body: 'Original', created_at: '2026-08-12 09:00:00',
    deleted_at: null }
  const html = renderToStaticMarkup(React.createElement(EditPost, { user, post }))

  expect(html).toContain(
    'class="panel panel-surface panel-medium compose edit-post-compose write-compose edit-write-compose"',
  )
  expect(html).toContain('class="edit-post-actions"')
  expect(html).toContain('class="edit-post-primary-actions"')
  expect(html).toContain('class="edit-post-delete-action"')
  expect(html).not.toContain('class="secondary-action cancel-action edit-post-cancel"')
  expect(html).toContain('value="unpublish" formNoValidate="" name="action">draft</button>')
  expect(html).toContain('class="secondary-action danger" href="/post/2/delete">delete</a>')
  expect(html).toContain('class="secondary-action" href="/post/2">back</a>')
  expect(html).toContain('title="Enrich post with hashtags" name="action">autotag')
  expect(html).not.toContain('compose-new-badge')
  expect(html.indexOf('>delete</a>')).toBeLessThan(html.indexOf('>back</a>'))
  expect(html.indexOf('>back</a>')).toBeLessThan(html.indexOf('<textarea'))
  expect(html.indexOf('value="search-hashtags"')).toBeLessThan(html.indexOf('class="posting-help-actions"'))
  expect(html.indexOf('>autotag')).toBeLessThan(html.indexOf('>preview</button>'))
  expect(html.indexOf('>preview</button>')).toBeLessThan(html.indexOf('>draft</button>'))
  expect(html.indexOf('>draft</button>')).toBeLessThan(html.indexOf('>more</label>'))
  expect(html.indexOf('>more</label>')).toBeLessThan(html.indexOf('>save →</button>'))
})

test('moderator post editing keeps save but hides owner-only actions', () => {
  const moderator = { id: 1, handle: 'moderator', email: 'gstagas@gmail.com', bio: '' }
  const post = { id: 2, user_id: 2, parent_id: null, body: 'Original', created_at: '2026-08-12 09:00:00',
    deleted_at: null, handle: 'writer' }
  const html = renderToStaticMarkup(React.createElement(EditPost, { user: moderator, post, moderator: true }))

  expect(html).toContain('>save →</button>')
  expect(html).not.toContain('value="unpublish"')
  expect(html).not.toContain('href="/post/2/delete"')
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
  expect(html).toContain(
    'class="panel panel-surface panel-medium replybox reply-compose edit-reply-compose"',
  )
  expect(html).toContain('Parent note')
  expect(html).not.toContain('>read</a>')
  expect(html).toContain('class="quiet post-back-link" href="/latest?cursor=abc#post-3">back</a>')
  expect(html).toContain('name="from" value="/latest?cursor=abc#post-3"')
  expect(html).toContain('href="/post/3/delete?from=%2Flatest%3Fcursor%3Dabc%23post-3"')
  expect(html).toContain('class="secondary-action" href="/latest?cursor=abc#post-3">back</a>')
  expect(html).not.toContain('class="secondary-action cancel-action edit-post-cancel"')
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
    preview.indexOf(
      '<div class="panel panel-surface panel-medium replybox reply-compose edit-reply-compose">',
    ))
  expect(previewPost).toContain('<span class="post-context post-context-author">you</span>')
  expect(previewPost).toContain(
    '<span class="post-context">replied to</span><span class="preview-context-target">@author</span>',
  )
  expect(previewPost).toContain('<span class="post-context post-context-punctuation">:</span>')
  expect(previewPost).not.toContain('<span class="postdate"')
  expect(previewPost).not.toContain('preview-reply')
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
  expect(html).toContain('title="Enrich post with hashtags" name="action">autotag')
  expect(html).not.toContain('compose-new-badge')
  expect(html.indexOf('>autotag')).toBeLessThan(html.indexOf('>preview</button>'))
  expect(html).toContain('class="button" accessKey="p">post →</button>')
  expect(html).not.toContain('class="secondary-action cancel-action edit-post-cancel"')
  expect(html).toContain('<div class="reply-preview"><p class="eyebrow">preview</p><div class="reply-branch">')
  expect(html).not.toContain('<span class="post-context">preview:</span>')
  expect(html.indexOf('<div class="reply-preview">')).toBeLessThan(
    html.indexOf('<div class="panel panel-surface panel-medium replybox reply-compose root-reply-compose">'),
  )
  expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('<div class="composefoot">'))
  expect(html).toContain('Reply <a href="/tag/here"')
  expect(html).not.toContain('preview-reply')
  expect(html).not.toContain('href="#"')
  expect(html).not.toContain('href="/post/0"')
  expect(html).not.toContain('NaN')
})

test('reply form relies on the existing back link for its originating feed entry', () => {
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

  expect(html).toContain('class="quiet post-back-link" href="/u/writer?tab=replies#post-2">back</a>')
  expect(html).not.toContain('class="secondary-action cancel-action edit-post-cancel"')
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

  expect(write).toContain('<div class="post-body ascii-art">')
  expect(reply).toContain('<div class="post-body ascii-art">')
})

test('search results use explore tag chips and highlight handle and bio matches', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const tags = renderToStaticMarkup(React.createElement(TagChips, {
    user,
    tags: [{ tag: 'typescript', count: 2, viewerFollowing: false }],
    followingKey: 'viewerFollowing',
    highlightTerms: ['type'],
    returnPath: '/search?q=type&tab=tags&page=3',
  }))
  const people = renderToStaticMarkup(React.createElement(ConnectionPeople, {
    user,
    people: [{ id: 2, handle: 'typewriter', email: '', bio: 'Types useful notes', posts: 3, viewerFollowing: true }],
    highlightTerms: ['type'],
    returnPath: person => searchPersonReturnPath('type writer', 3, person.id),
  }))

  expect(tags).toContain('<span>#<mark>type</mark>script</span>')
  expect(tags).toContain('class="explore-tag-chips"')
  expect(tags).toContain('class="button explore-tag-chip" aria-pressed="false"')
  expect(tags).toContain('name="from" value="/search?q=type&amp;tab=tags&amp;page=3"')
  expect(people).toContain('@<mark>type</mark>writer')
  expect(people).toContain('<mark>Type</mark>s useful notes')
  expect(people).toContain('>unfollow</button>')
  expect(people).toContain('id="person-2"')
  expect(people).toContain('name="from" value="/search?q=type%20writer&amp;tab=people&amp;page=3#person-2"')
})

test('explore renders tag toggles above a full-width people section', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Explore, {
    user,
    data: {
      tags: [
        { tag: 'followed', count: 2, following: true },
        { tag: 'new', count: 1, following: false },
      ],
      people: [],
      peopleTotal: 9,
      tagsTotal: 25,
      profileStats: {},
    },
  }))

  expect(html).toContain('class="explore-tags" id="explore-tags"')
  expect(html).toContain('class="button explore-tag-chip button-muted" aria-pressed="true"')
  expect(html).toContain('class="button explore-tag-chip" aria-pressed="false"')
  expect(html).toContain('name="from" value="/explore#explore-tags"')
  expect(html).toContain(
    'class="explore-tag-link" href="/tag/followed?from=%2Fexplore%23explore-tags" title="View #followed"',
  )
  expect(html).toContain(
    '<section class="explore-people" id="explore-people"><div class="explore-section-heading">'
      + '<h2>People to follow</h2><nav class="pagination pagination-compact"',
  )
  expect(html).toContain('href="/explore?tagsPage=2&amp;_scroll=instant#explore-tags"')
  expect(html).toContain('href="/explore?peoplePage=2&amp;_scroll=instant#explore-people"')
  expect(html).toContain(
    '<div class="explore-section-heading"><h2>Trending tags</h2><nav class="pagination pagination-compact"',
  )
  expect(html.indexOf('aria-label="Tags pagination"')).toBeLessThan(html.indexOf('class="explore-tag-chips"'))
  expect(html.indexOf('aria-label="People pagination"')).toBeLessThan(html.indexOf('class="people"'))
  expect(html.lastIndexOf('aria-label="People pagination"')).toBeGreaterThan(html.indexOf('class="people"'))
})

test('explore renders a person mood next to their username', () => {
  const html = renderToStaticMarkup(React.createElement(Explore, {
    user: null,
    data: {
      tags: [],
      people: [{ id: 2, handle: 'writer', mood: '🌞', email: '', bio: '', posts: 1 }],
      peopleTotal: 1,
      tagsTotal: 0,
      profileStats: {},
    },
  }))

  expect(html).toContain('>@writer</a><span class="post-mood">🌞</span>')
})

test('search post replies return to the originating result and page', () => {
  expect(searchPostReturnPath('ascii art', 1, 42)).toBe('/search?q=ascii%20art#post-42')
  expect(searchPostReturnPath('ascii art', 3, 42)).toBe('/search?q=ascii%20art&page=3#post-42')
})

test('search results render pagination above and below starting on the first page', () => {
  const html = renderToStaticMarkup(React.createElement(SearchResults, {
    user: null,
    query: 'needle',
    page: 1,
    results: {
      totals: { notes: 1234567, tags: 0, people: 0 },
      posts: [],
      tags: [],
      people: [],
      highlights: ['needle'],
      totalPages: 3,
    },
  }))

  expect(html.match(/<nav class="pagination/g)).toHaveLength(2)
  expect(html).toContain('<nav class="pagination pagination-top"')
  expect(html).toContain(`>${(1234567).toLocaleString()} notes</a>`)
})

test('feed threads highlight search matches while retaining tappable reply navigation', () => {
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/search?q=needle&page=2',
    highlightTerms: ['needle'],
    posts: [{
      id: 42,
      user_id: 2,
      parent_id: 7,
      body: 'A needle in a reply',
      created_at: '2026-08-23 10:00:00',
      deleted_at: null,
      handle: 'writer',
      parent: { id: 7, user_id: 3, parent_id: null, body: 'Parent', created_at: '2026-08-23 09:00:00', deleted_at: null,
        handle: 'parent', reply_count: 1 },
    }],
  }))

  expect(html).toContain('A <mark>needle</mark> in a reply')
  expect(html).toContain('class="quiet post-top-link"')
  expect(html).toContain('from=%2Fsearch%3Fq%3Dneedle%26page%3D2%23post-42')
  expect(html).not.toContain('>read</a>')
})

test('feed conversations stay expanded when all visible replies fit the preview', () => {
  const root = { id: 1, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-23 09:00:00', deleted_at: null,
    handle: 'root', reply_count: 2 }
  const firstReply = { id: 2, user_id: 2, parent_id: 1, body: 'Reply', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'reply', reply_count: 0, parent: root }
  const secondReply = { id: 3, user_id: 2, parent_id: 1, body: 'Another reply', created_at: '2026-08-23 11:00:00',
    deleted_at: null, handle: 'reply', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, firstReply, secondReply],
  }))

  expect(html).not.toContain('id="feed-thread-fold-1"')
  expect(html).not.toContain('class="quiet thread-fold"')
  expect(html).not.toContain('collapsed-preview-post')
  expect(html).not.toContain('aria-label="Earlier replies hidden"')
  expect(html).toContain(
    'class="post-hit-area" href="/post/1?from=%2Flatest%23post-2#post-2"',
  )

  const returned = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    expandedRootId: 1,
    posts: [root, firstReply, secondReply],
  }))
  expect(returned).not.toContain('id="feed-thread-fold-1"')
  expect(returned).toContain(
    'class="post-hit-area" href="/post/1?from=%2Flatest%23post-2#post-2"',
  )

  const single = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [{ ...root, reply_count: 1 }, firstReply],
  }))
  expect(single).not.toContain('id="feed-thread-fold-1"')

  const unread = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    contextUnreadPostIds: new Set([2]),
    posts: [root, firstReply, secondReply],
  }))
  expect(unread).not.toContain('id="feed-thread-fold-1"')
  expect(unread).not.toContain('class="quiet thread-fold"')
})

test('folded feed conversations preview the two newest replies from a recent burst', () => {
  const root = { id: 1, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-23 09:00:00', deleted_at: null,
    handle: 'root', reply_count: 4 }
  const olderReply = { id: 2, user_id: 2, parent_id: 1, body: 'Older reply', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'reply', reply_count: 1, parent: root }
  const olderDeepReply = { id: 3, user_id: 3, parent_id: 2, body: 'Older deep reply', created_at: '2026-08-23 11:00:00',
    deleted_at: null, handle: 'deep', reply_count: 0, parent: olderReply }
  const newerReply = { id: 4, user_id: 4, parent_id: 1, body: 'Newest reply', created_at: '2026-08-23 12:00:00',
    deleted_at: null, handle: 'newest', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, olderReply, olderDeepReply, newerReply],
  }))

  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?Newest reply/)
  expect(html.match(/collapsed-preview-post/g)).toHaveLength(2)
  expect(html.match(/feed-thread-collapsed-branch/g)).toHaveLength(1)
  expect(html).not.toContain('id="thread-fold-2"')
  expect(html).not.toContain('for="thread-fold-2"')
  expect(html).toContain('class="quiet thread-fold" for="feed-thread-fold-1"')
  expect(html).toMatch(/class="thread-root"[^>]*>[\s\S]*?class="collapsed-post-expander" for="feed-thread-fold-1"/)
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?class="collapsed-post-expander" for="feed-thread-fold-1"/)
  expect(html.match(/class="collapsed-post-expander"/g)).toHaveLength(3)
  expect(html).toContain('aria-label="expand conversation containing post by @newest"')
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?Older deep reply/)
  expect(html).toContain(
    'class="post-hit-area" href="/post/1?from=%2Flatest%3Fexpand%3D1%23post-4#post-4"',
  )

  const expanded = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    expandedRootId: 1,
    posts: [root, olderReply, olderDeepReply, newerReply],
  }))
  expect(expanded.match(/class="collapsed-post-expander"/g)).toHaveLength(2)
  expect(expanded).toContain('class="post-hit-area" href="/post/1')
  expect(expanded).toContain(
    'class="post-hit-area" href="/post/1?from=%2Flatest%3Fexpand%3D1%23post-4#post-4"',
  )
})

test('Any reply cards return through the retained sample with their conversation expanded', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const root = { id: 20, user_id: 2, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const reply = (id: number, created_at: string) => ({ id, user_id: id, parent_id: root.id, body: `Reply ${id}`,
    created_at, deleted_at: null, handle: `reply${id}`, reply_count: 0, parent: root })
  const html = renderToStaticMarkup(React.createElement(PublicFeed, {
    user,
    path: '/any?seed=9l',
    feed: { posts: [root, reply(21, '2026-08-20 10:00:00'), reply(22, '2026-08-20 11:00:00'),
      reply(23, '2026-08-20 12:00:00')], page: 1, totalItems: 1, totalPages: 1 },
  }))

  expect(html).toContain(
    'href="/post/20?from=%2Fany%3Fseed%3D9l%26expand%3D20%23post-22#post-22"',
  )
  expect(html).toContain(
    'href="/post/20?from=%2Fany%3Fseed%3D9l%26expand%3D20%23post-23#post-23"',
  )
  expect(html).not.toContain('post-reply-link')
})

test('folded feed conversations distinguish previews from different depths', () => {
  const root = { id: 5, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-23 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const shallow = { id: 6, user_id: 2, parent_id: 5, body: 'Shallow preview', created_at: '2026-08-23 12:00:00',
    deleted_at: null, handle: 'shallow', reply_count: 0, parent: root }
  const hidden = { id: 7, user_id: 3, parent_id: 5, body: 'Hidden branch', created_at: '2026-08-20 10:00:00',
    deleted_at: null, handle: 'hidden', reply_count: 1, parent: root }
  const hiddenChild = { id: 8, user_id: 3, parent_id: 7, body: 'Hidden child', created_at: '2026-08-20 11:00:00',
    deleted_at: null, handle: 'hidden', reply_count: 1, parent: hidden }
  const deep = { id: 9, user_id: 4, parent_id: 8, body: 'Deep preview', created_at: '2026-08-23 11:00:00',
    deleted_at: null, handle: 'deep', reply_count: 0, parent: hiddenChild }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, shallow, hidden, hiddenChild, deep],
  }))

  expect(html).toMatch(/collapsed-preview-post collapsed-preview-deeper[^>]*>[\s\S]*?Deep preview/)
  expect(html).toContain('<div class="reply-node collapsed-preview-path collapsed-preview-post"><article')
})

test('folded feed conversations do not double-indent a preview below another preview', () => {
  const root = { id: 50, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const hidden = { id: 51, user_id: 2, parent_id: 50, body: 'Hidden', created_at: '2026-08-20 10:00:00',
    deleted_at: null, handle: 'hidden', reply_count: 0, parent: root }
  const parentPreview = { id: 52, user_id: 3, parent_id: 50, body: 'Parent preview',
    created_at: '2026-08-23 11:00:00', deleted_at: null, handle: 'parent', reply_count: 1, parent: root }
  const childPreview = { id: 53, user_id: 4, parent_id: 52, body: 'Child preview',
    created_at: '2026-08-23 12:00:00', deleted_at: null, handle: 'child', reply_count: 0, parent: parentPreview }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, hidden, parentPreview, childPreview],
  }))

  expect(html.match(/collapsed-preview-post/g)).toHaveLength(2)
  expect(html).not.toContain('collapsed-preview-deeper')
})

test('folded feed conversations flatten a deleted ancestor on a collapsed preview path', () => {
  const root = { id: 166, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-07 19:14:53',
    deleted_at: null, handle: 'root', reply_count: 4 }
  const branch = { id: 177, user_id: 2, parent_id: root.id, body: 'Branch', created_at: '2026-08-07 19:36:41',
    deleted_at: null, handle: 'branch', reply_count: 3, parent: root }
  const deleted = { id: 200, user_id: 3, parent_id: branch.id, body: '(deleted)',
    created_at: '2026-08-07 20:10:08', deleted_at: '2026-08-19 19:23:45', handle: 'deleted',
    reply_count: 1, parent: branch }
  const deep = { id: 211, user_id: 4, parent_id: deleted.id, body: 'Deep preview',
    created_at: '2026-08-07 20:36:19', deleted_at: null, handle: 'deep', reply_count: 0, parent: deleted }
  const shallow = { id: 360, user_id: 5, parent_id: branch.id, body: 'Shallow preview',
    created_at: '2026-08-08 01:56:40', deleted_at: null, handle: 'shallow', reply_count: 0, parent: branch }
  const older = { id: 191, user_id: 6, parent_id: branch.id, body: 'Older reply',
    created_at: '2026-08-07 19:58:33', deleted_at: null, handle: 'older', reply_count: 0, parent: branch }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, branch, deleted, deep, shallow, older],
  }))

  expect(html).toContain('reply-branch collapsed-preview-path-branch')
  expect(html).toMatch(/collapsed-preview-post collapsed-preview-deeper[^>]*>[\s\S]*?id="post-211"/)
})

test('folded feed conversations render previews beyond the normal thread depth limit', () => {
  const root = { id: 60, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 1 }
  const replies: any[] = []
  let parent: any = root
  for (let id = 61; id <= 67; id++) {
    const reply = { id, user_id: id, parent_id: parent.id, body: `Reply ${id}`,
      created_at: `2026-08-${id < 66 ? '20' : '23'} ${id === 67 ? '12' : '11'}:00:00`, deleted_at: null,
      handle: `user${id}`, reply_count: id < 67 ? 1 : 0, parent }
    replies.push(reply)
    parent = reply
  }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, ...replies],
    promoteAncestors: 'all',
  }))

  expect(html).toContain('id="feed-thread-fold-60" checked=""')
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?Reply 67/)
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?Reply 66/)
})

test('new unread replies use the normal feed conversation folding rules', () => {
  const root = { id: 10, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-23 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const reply = (id: number, created_at: string) => ({ id, user_id: 2, parent_id: root.id, body: `Reply ${id}`,
    created_at, deleted_at: null, handle: 'reply', reply_count: 0, parent: root })
  const newest = reply(13, '2026-08-23 12:00:00')
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    contextUnreadPostIds: new Set([newest.id]),
    posts: [root, reply(11, '2026-08-20 10:00:00'), reply(12, '2026-08-21 11:00:00'), newest],
  }))

  expect(html).toContain('id="feed-thread-fold-10" checked=""')
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?id="post-13"/)
})

test('folded feed conversations show a gap above a preview when same-depth replies are hidden', () => {
  const root = { id: 20, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 2 }
  const older = { id: 21, user_id: 2, parent_id: root.id, body: 'Hidden sibling',
    created_at: '2026-08-20 10:00:00', deleted_at: null, handle: 'older', reply_count: 0, parent: root }
  const newest = { id: 22, user_id: 3, parent_id: root.id, body: 'Visible preview',
    created_at: '2026-08-23 11:00:01', deleted_at: null, handle: 'newest', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, older, newest],
  }))

  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?for="feed-thread-fold-20" aria-label="Expand earlier replies">…<\/label>[\s\S]*?id="post-22"/)
})

test('folded feed conversations show a gap when a same-depth preview path hides its post above', () => {
  const root = { id: 30, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const branch = { id: 31, user_id: 2, parent_id: root.id, body: 'Hidden same-depth branch',
    created_at: '2026-08-20 10:00:00', deleted_at: null, handle: 'branch', reply_count: 1, parent: root }
  const deepPreview = { id: 32, user_id: 3, parent_id: branch.id, body: 'Deep preview',
    created_at: '2026-08-23 11:00:00', deleted_at: null, handle: 'deep', reply_count: 0, parent: branch }
  const siblingPreview = { id: 33, user_id: 4, parent_id: root.id, body: 'Same-depth preview',
    created_at: '2026-08-23 11:30:00', deleted_at: null, handle: 'sibling', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, branch, deepPreview, siblingPreview],
  }))

  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?for="feed-thread-fold-30" aria-label="Expand earlier replies">…<\/label>[\s\S]*?id="post-32"/)
})

test('folded feed conversations place a same-depth omission only before the oldest preview', () => {
  const root = { id: 40, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 4, direct_reply_count: 4 }
  const visible = (id: number, created_at: string) => ({ id, user_id: id, parent_id: root.id, body: `Visible ${id}`,
    created_at, deleted_at: null, handle: `user${id}`, reply_count: 0, parent: root })
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, visible(43, '2026-08-23 11:00:00'), visible(44, '2026-08-23 11:30:00'),
      visible(45, '2026-08-23 12:00:00')],
  }))

  expect(html).toMatch(/for="feed-thread-fold-40" aria-label="Expand earlier replies">…<\/label>[\s\S]*?id="post-44"/)
  expect(html.slice(html.indexOf('id="post-44"'), html.indexOf('id="post-45"')))
    .not.toContain('aria-label="Expand earlier replies"')
})

test('expanded partial feed conversations place sibling omission markers before the oldest visible reply', () => {
  const root = { id: 895, user_id: 2, parent_id: null, body: 'Root', created_at: '2026-08-11 09:41:26',
    deleted_at: null, handle: 'followed', reply_count: 5, direct_reply_count: 5 }
  const visible = (id: number, created_at: string) => ({ id, user_id: 3, parent_id: root.id, body: `Reply ${id}`,
    created_at, deleted_at: null, handle: 'replier', reply_count: 0, parent: root })
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/for-you',
    expandedRootId: root.id,
    posts: [root, visible(2599, '2026-08-26 22:03:54'), visible(2600, '2026-08-26 22:07:23'),
      visible(2602, '2026-08-26 22:10:21'), visible(2607, '2026-08-26 23:28:22')],
  }))

  expect(html).toMatch(/href="\/post\/895\?from=%2Ffor-you%3Fexpand%3D895%23post-895" aria-label="Earlier replies omitted" rel="nofollow">…<\/a>[\s\S]*?id="post-2599"/)
})

test('expanded complete deep threads remove feed-projection ancestor omission markers', () => {
  const root = { id: 60, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 3, direct_reply_count: 2 }
  const branch = { id: 61, user_id: 2, parent_id: root.id, body: 'Branch', created_at: '2026-08-20 10:00:00',
    deleted_at: null, handle: 'branch', reply_count: 1, direct_reply_count: 1, parent: root }
  const deep = { id: 62, user_id: 3, parent_id: branch.id, body: 'Deep reply',
    created_at: '2026-08-23 11:00:00', deleted_at: null, handle: 'deep', reply_count: 0,
    direct_reply_count: 0, parent: branch, feed_ancestor_gap: true }
  const sibling = { id: 63, user_id: 4, parent_id: root.id, body: 'Sibling',
    created_at: '2026-08-23 12:00:00', deleted_at: null, handle: 'sibling', reply_count: 0,
    direct_reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/for-you',
    expandedRootId: root.id,
    posts: [root, branch, deep, sibling],
  }))

  expect(html).toContain('aria-label="Earlier replies omitted"')
})

test('expanded complete linear conversations remove the folded feed omission marker', () => {
  const root = { id: 2652, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-27 12:05:04',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const first = { id: 2653, user_id: 2, parent_id: root.id, body: 'First reply', created_at: '2026-08-27 12:11:08',
    deleted_at: null, handle: 'first', reply_count: 2, parent: root }
  const second = { id: 2654, user_id: 1, parent_id: first.id, body: 'Second reply', created_at: '2026-08-27 12:28:13',
    deleted_at: null, handle: 'second', reply_count: 1, parent: first, feed_ancestor_gap: true }
  const third = { id: 2655, user_id: 2, parent_id: second.id, body: 'Third reply', created_at: '2026-08-27 12:55:26',
    deleted_at: null, handle: 'third', reply_count: 0, parent: second }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/for-you',
    expandedRootId: root.id,
    posts: [root, first, second, third],
  }))

  expect(html).toContain('First reply')
  expect(html).toContain('Second reply')
  expect(html).toContain('Third reply')
  expect(html).toContain('aria-label="Earlier replies omitted"')
  expect(html).not.toContain('>more</a>')
})

test('locally collapsible complete conversations only render the collapsed-preview gap', () => {
  const root = { id: 2652, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-27 12:05:04',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const first = { id: 2653, user_id: 2, parent_id: root.id, body: 'First reply', created_at: '2026-08-27 12:11:08',
    deleted_at: null, handle: 'first', reply_count: 2, parent: root }
  const second = { id: 2654, user_id: 1, parent_id: first.id, body: 'Second reply', created_at: '2026-08-27 12:28:13',
    deleted_at: null, handle: 'second', reply_count: 1, parent: first, feed_ancestor_gap: true }
  const third = { id: 2655, user_id: 2, parent_id: second.id, body: 'Third reply', created_at: '2026-08-27 12:55:26',
    deleted_at: null, handle: 'third', reply_count: 0, parent: second }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/for-you',
    posts: [root, first, second, third],
  }))

  expect(html).toContain('id="feed-thread-fold-2652" checked=""')
  expect(html).toContain('aria-label="Expand earlier replies"')
  expect(html).toContain('aria-label="Earlier replies omitted"')
  expect(html).not.toContain('>more</a>')
})

test('partial conversations place sibling omission markers at the newest visible boundary', () => {
  const root = { id: 35, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-07 15:44:34',
    deleted_at: null, handle: 'root', reply_count: 5, direct_reply_count: 3 }
  const branch = { id: 37, user_id: 2, parent_id: root.id, body: 'Older branch',
    created_at: '2026-08-07 15:45:17', deleted_at: null, handle: 'branch', reply_count: 1,
    direct_reply_count: 2, parent: root }
  const branchReply = { id: 47, user_id: 1, parent_id: branch.id, body: 'Visible branch reply',
    created_at: '2026-08-07 15:53:52', deleted_at: null, handle: 'reply', reply_count: 0,
    direct_reply_count: 0, parent: branch }
  const newest = { id: 2716, user_id: 3, parent_id: root.id, body: 'Newest visible reply',
    created_at: '2026-08-28 03:51:52', deleted_at: null, handle: 'newest', reply_count: 0,
    direct_reply_count: 0, parent: root }
  const newerOlderReply = { id: 41, user_id: 4, parent_id: root.id, body: 'Newer older reply',
    created_at: '2026-08-07 15:46:39', deleted_at: null, handle: 'newer', reply_count: 0,
    direct_reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    expandedRootId: root.id,
    posts: [root, branchReply, newerOlderReply, newest],
    promoteAncestors: true,
  }))

  expect(html).not.toContain('id="post-37"')
  expect(html).toMatch(/class="reply-node projected-reply-deeper omitted-parent-reply"[\s\S]*?aria-label="Earlier replies omitted" rel="nofollow">…<\/a>[\s\S]*?id="post-47"[\s\S]*?id="post-41"[\s\S]*?id="post-2716"/)
  expect(html.match(/aria-label="Earlier replies omitted"/g)).toHaveLength(1)
})

test('collapsed nested previews mark an omitted path without adding preview indentation twice', () => {
  const root = { id: 2686, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-27 18:00:25',
    deleted_at: null, handle: 'root', reply_count: 7, direct_reply_count: 2 }
  const omittedParent = { id: 2687, user_id: 1, parent_id: root.id, body: 'Omitted parent',
    created_at: '2026-08-27 18:00:52', deleted_at: null, handle: 'root', reply_count: 5 }
  const path = { id: 2689, user_id: 1, parent_id: root.id, body: 'Rewired path',
    created_at: '2026-08-27 18:03:46', deleted_at: null, handle: 'root', reply_count: 4,
    parent: omittedParent, feed_ancestor_gap: true }
  const parentPreview = { id: 2725, user_id: 1, parent_id: path.id, body: 'Parent preview',
    created_at: '2026-08-28 07:35:50', deleted_at: null, handle: 'root', reply_count: 1, parent: path }
  const childPreview = { id: 2727, user_id: 1, parent_id: parentPreview.id, body: 'Child preview',
    created_at: '2026-08-28 07:51:56', deleted_at: null, handle: 'root', reply_count: 0, parent: parentPreview }
  const sibling = { id: 2712, user_id: 2, parent_id: root.id, body: 'Older sibling',
    created_at: '2026-08-28 01:50:52', deleted_at: null, handle: 'sibling', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, path, parentPreview, childPreview, sibling],
  }))

  expect(html).toContain('reply-node collapsed-preview-path projected-reply-deeper omitted-parent-reply')
  expect(html.match(/collapsed-preview-post/g)).toHaveLength(2)
})

test('expanded direct-sibling omissions appear before the oldest loaded sibling', () => {
  const root = { id: 875, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-10 20:52:39',
    deleted_at: null, handle: 'root', reply_count: 4, direct_reply_count: 3 }
  const older = { id: 2604, user_id: 2, parent_id: root.id, body: 'Older loaded sibling',
    created_at: '2026-08-26 22:37:34', deleted_at: null, handle: 'older', reply_count: 0,
    direct_reply_count: 0, parent: root }
  const newer = { id: 2615, user_id: 3, parent_id: root.id, body: 'Newer loaded sibling',
    created_at: '2026-08-27 01:27:01', deleted_at: null, handle: 'newer', reply_count: 1,
    direct_reply_count: 1, parent: root }
  const child = { id: 2718, user_id: 1, parent_id: newer.id, body: 'Newest child',
    created_at: '2026-08-28 06:13:09', deleted_at: null, handle: 'root', reply_count: 0,
    direct_reply_count: 0, parent: newer }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    expandedRootId: root.id,
    posts: [root, older, newer, child],
  }))

  expect(html).toMatch(/aria-label="Earlier replies omitted" rel="nofollow">…<\/a>[\s\S]*?id="post-2604"[\s\S]*?id="post-2615"/)
  expect(html).not.toMatch(/id="post-2604"[\s\S]*?aria-label="Earlier replies omitted" rel="nofollow">…<\/a>[\s\S]*?id="post-2615"/)
})

test('collapsed previews retain extra depth when the preview itself has an omitted parent', () => {
  const root = { id: 2515, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-26 05:07:55',
    deleted_at: null, handle: 'root', reply_count: 14, direct_reply_count: 6 }
  const omittedParent = { id: 2701, user_id: 2, parent_id: root.id, body: 'Omitted parent',
    created_at: '2026-08-27 20:45:37', deleted_at: null, handle: 'parent', reply_count: 1 }
  const deeper = { id: 2706, user_id: 1, parent_id: root.id, body: 'Deeper preview',
    created_at: '2026-08-27 22:16:52', deleted_at: null, handle: 'root', reply_count: 0,
    parent: omittedParent, feed_ancestor_gap: true }
  const sibling = { id: 2717, user_id: 3, parent_id: root.id, body: 'Sibling preview',
    created_at: '2026-08-28 05:30:19', deleted_at: null, handle: 'sibling', reply_count: 0, parent: root }
  const older = { id: 2705, user_id: 4, parent_id: root.id, body: 'Older reply',
    created_at: '2026-08-27 22:14:39', deleted_at: null, handle: 'older', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, deeper, sibling, older],
  }))

  expect(html).toMatch(/collapsed-preview-post collapsed-preview-deeper projected-reply-deeper omitted-parent-reply[^>]*>[\s\S]*?id="post-2706"/)
  expect(html).toMatch(/collapsed-preview-post collapsed-preview-deeper projected-reply-deeper omitted-parent-reply[^>]*>[\s\S]*?aria-label="Expand earlier replies">…<\/label>[\s\S]*?id="post-2706"/)
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?id="post-2717"/)
  expect(html).toContain('collapsed-preview-post collapsed-preview-deeper projected-reply-deeper omitted-parent-reply')
})

test('collapsed feed previews indent a reply whose immediate parent was omitted', () => {
  const root = { id: 370, user_id: 12, parent_id: null, body: 'Root', created_at: '2026-08-08 02:32:30',
    deleted_at: null, handle: 'root', reply_count: 4 }
  const omittedParent = { id: 2829, user_id: 1, parent_id: root.id, body: 'Omitted parent',
    created_at: '2026-08-29 10:49:12', deleted_at: null, handle: 'viewer', reply_count: 1, parent: root }
  const nested = { id: 2833, user_id: 275, parent_id: root.id, body: 'Nested preview',
    created_at: '2026-08-29 11:22:11', deleted_at: null, handle: 'reply', reply_count: 0,
    parent: omittedParent, feed_ancestor_gap: true }
  const sibling = { id: 2834, user_id: 275, parent_id: root.id, body: 'Sibling preview',
    created_at: '2026-08-29 11:25:06', deleted_at: null, handle: 'reply', reply_count: 0, parent: root }
  const older = { id: 2370, user_id: 501, parent_id: root.id, body: 'Older reply',
    created_at: '2026-08-25 03:11:23', deleted_at: null, handle: 'older', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/my-feed',
    posts: [root, nested, sibling, older],
  }))

  expect(html).toMatch(/collapsed-preview-post collapsed-preview-deeper projected-reply-deeper omitted-parent-reply[^>]*>[\s\S]*?id="post-2833"/)
  expect(html).toMatch(/collapsed-preview-post[^>]*>[\s\S]*?id="post-2834"/)
  expect(html).toMatch(/class="reply-node collapsed-preview-path collapsed-preview-post"><article[^>]*id="post-2834"/)
})

test('hot post 925 marks reply 2521 as nested beneath sibling 2445', () => {
  const root = { id: 925, user_id: 321, parent_id: null, body: 'Root', created_at: '2026-08-11 15:07:20',
    deleted_at: null, handle: 'root', reply_count: 3 }
  const omittedParent = { id: 2331, user_id: 447, parent_id: root.id, body: 'Omitted parent',
    created_at: '2026-08-24 23:15:20', deleted_at: null, handle: 'parent', reply_count: 1, parent: root }
  const nested = { id: 2521, user_id: 558, parent_id: root.id, body: 'Nested preview',
    created_at: '2026-08-26 06:58:19', deleted_at: null, handle: 'nested', reply_count: 0,
    parent: omittedParent, feed_ancestor_gap: true }
  const sibling = { id: 2445, user_id: 545, parent_id: root.id, body: 'Sibling preview',
    created_at: '2026-08-25 16:09:47', deleted_at: null, handle: 'sibling', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, nested, sibling],
    promoteAncestors: true,
  }))

  expect(html).toMatch(/class="reply-node projected-reply-deeper omitted-parent-reply">[\s\S]*?id="post-2521"/)
  expect(html).toMatch(/class="reply-node"><article[^>]*id="post-2445"/)
})

test('post 925 does not put omission dots between loaded direct siblings 2902 and 2947', () => {
  const root = { id: 925, user_id: 321, parent_id: null, body: 'Root', created_at: '2026-08-11 15:07:20',
    deleted_at: null, handle: 'root', reply_count: 65, direct_reply_count: 37 }
  const older = { id: 2521, user_id: 558, parent_id: root.id, body: 'Older projected reply',
    created_at: '2026-08-26 06:58:19', deleted_at: null, handle: 'older', reply_count: 0,
    parent: { ...root, id: 2331, parent_id: root.id, parent: root }, feed_ancestor_gap: true }
  const direct = (id: number, created_at: string, reply_count = 0) => ({
    id, user_id: id, parent_id: root.id, body: `Direct ${id}`, created_at, deleted_at: null,
    handle: `user${id}`, reply_count, parent: root, feed_collapsed_preview: true,
  })
  const newer = direct(2947, '2026-08-31 14:40:17', 1)
  const child = { id: 2950, user_id: 2950, parent_id: newer.id, body: 'Hidden child',
    created_at: '2026-08-31 15:35:40', deleted_at: null, handle: 'child', reply_count: 0, parent: newer }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/all',
    posts: [root, older, direct(2902, '2026-08-30 13:09:16'), newer, child],
    promoteAncestors: true,
  }))

  expect(html.slice(html.indexOf('id="post-2902"'), html.indexOf('id="post-2947"')))
    .not.toContain('aria-label="Expand earlier replies"')
  expect(html).toMatch(/id="post-2947"[\s\S]*?aria-label="Expand hidden replies"/)
})

test('post 2910 keeps hidden descendants from creating gaps before the next direct sibling', () => {
  const root = { id: 2910, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-30 13:42:58',
    deleted_at: null, handle: 'root', reply_count: 7, direct_reply_count: 4 }
  const older = { id: 2927, user_id: 2, parent_id: root.id, body: 'Older projected reply',
    created_at: '2026-08-30 20:37:56', deleted_at: null, handle: 'older', reply_count: 0,
    parent: { ...root, id: 2923, parent_id: root.id, parent: root }, feed_ancestor_gap: true }
  const first = { id: 2934, user_id: 3, parent_id: root.id, body: 'First direct preview',
    created_at: '2026-08-30 23:53:58', deleted_at: null, handle: 'first', reply_count: 1,
    parent: root, feed_collapsed_preview: true }
  const hiddenChild = { id: 2935, user_id: 4, parent_id: first.id, body: 'Hidden child',
    created_at: '2026-08-31 06:41:31', deleted_at: null, handle: 'child', reply_count: 0, parent: first }
  const second = { id: 2936, user_id: 5, parent_id: root.id, body: 'Second direct preview',
    created_at: '2026-08-31 07:19:56', deleted_at: null, handle: 'second', reply_count: 0,
    parent: root, feed_collapsed_preview: true }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/all',
    posts: [root, older, first, hiddenChild, second],
    promoteAncestors: true,
  }))

  const betweenSiblings = html.slice(html.indexOf('id="post-2934"'), html.indexOf('id="post-2936"'))
  expect(betweenSiblings).toContain('aria-label="Expand hidden replies"')
  expect(betweenSiblings).not.toContain('aria-label="Expand earlier replies"')
})

test('expanded hot post 925 indents both selected replies with omitted parents', () => {
  const root = { id: 925, user_id: 321, parent_id: null, body: 'Root', created_at: '2026-08-11 15:07:20',
    deleted_at: null, handle: 'root', reply_count: 4 }
  const nested = (id: number, parentId: number, created_at: string) => ({
    id, user_id: id, parent_id: root.id, body: `Nested ${id}`, created_at, deleted_at: null,
    handle: `user${id}`, reply_count: 0, feed_ancestor_gap: true,
    parent: { id: parentId, user_id: 2, parent_id: root.id, body: 'Omitted parent',
      created_at: '2026-08-20 10:00:00', deleted_at: null, handle: 'parent', reply_count: 1, parent: root },
  })
  const direct = (id: number, created_at: string) => ({
    id, user_id: id, parent_id: root.id, body: `Direct ${id}`, created_at, deleted_at: null,
    handle: `user${id}`, reply_count: 0, parent: root,
  })
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    expandedRootId: root.id,
    posts: [root, nested(2521, 2331, '2026-08-26 06:58:19'), direct(2445, '2026-08-25 16:09:47'),
      nested(2441, 2366, '2026-08-25 15:00:00'), direct(2440, '2026-08-25 14:00:00')],
  }))

  expect(html).toMatch(/projected-reply-deeper omitted-parent-reply[^>]*>[\s\S]*?id="post-2521"/)
  expect(html).toMatch(/projected-reply-deeper omitted-parent-reply[^>]*>[\s\S]*?id="post-2441"/)
  expect(html).toMatch(/class="reply-node collapsed-preview-path collapsed-preview-post">[\s\S]*?id="post-2445"/)
  expect(html).toMatch(/class="reply-node"><article[^>]*id="post-2440"/)
})

test('hot post 1174 keeps omitted branches on one baseline when no direct reply is selected', () => {
  const root = { id: 1174, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-14 00:02:46',
    deleted_at: null, handle: 'root', reply_count: 2 }
  const shallowParent = { id: 2296, user_id: 2, parent_id: root.id, body: 'Shallow omitted parent',
    created_at: '2026-08-24 20:42:07', deleted_at: null, handle: 'shallow-parent', reply_count: 1, parent: root }
  const shallow = { id: 2564, user_id: 3, parent_id: root.id, body: 'Shallow projected reply',
    created_at: '2026-08-26 15:31:31', deleted_at: null, handle: 'shallow', reply_count: 0,
    parent: shallowParent, feed_ancestor_gap: true }
  const deepParent = { id: 2553, user_id: 4, parent_id: 2547, body: 'Deep omitted parent',
    created_at: '2026-08-26 13:49:06', deleted_at: null, handle: 'deep-parent', reply_count: 1,
    parent: { ...shallowParent, id: 2547, parent: root } }
  const deep = { id: 2557, user_id: 5, parent_id: root.id, body: 'Deep projected reply',
    created_at: '2026-08-26 14:37:52', deleted_at: null, handle: 'deep', reply_count: 0,
    parent: deepParent, feed_ancestor_gap: true }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    posts: [root, shallow, deep],
  }))

  expect(html).toMatch(/class="reply-node omitted-parent-reply">[\s\S]*?id="post-2564"/)
  expect(html).toMatch(/class="reply-node omitted-parent-reply">[\s\S]*?id="post-2557"/)
  expect(html).not.toContain('projected-reply-deeper')
})

test('expanded hot post 2737 does not double-indent parallel omitted branches', () => {
  const root = { id: 2737, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-28 09:47:07',
    deleted_at: null, handle: 'root', reply_count: 4 }
  const omitted = (id: number, parentId: number) => ({ id: parentId, user_id: 2, parent_id: root.id,
    body: 'Omitted parent', created_at: '2026-08-28 16:00:00', deleted_at: null, handle: 'parent',
    reply_count: 1, parent: root })
  const first = { id: 2806, user_id: 3, parent_id: root.id, body: 'First branch',
    created_at: '2026-08-28 21:15:31', deleted_at: null, handle: 'first', reply_count: 1,
    parent: omitted(2806, 2778), feed_ancestor_gap: true }
  const firstChild = { id: 2809, user_id: 3, parent_id: first.id, body: 'First child',
    created_at: '2026-08-28 21:17:43', deleted_at: null, handle: 'first', reply_count: 0, parent: first }
  const second = { id: 2779, user_id: 4, parent_id: root.id, body: 'Second branch',
    created_at: '2026-08-28 16:30:08', deleted_at: null, handle: 'second', reply_count: 1,
    parent: omitted(2779, 2777), feed_ancestor_gap: true }
  const secondChild = { id: 2789, user_id: 1, parent_id: second.id, body: 'Second child',
    created_at: '2026-08-28 17:14:28', deleted_at: null, handle: 'root', reply_count: 0, parent: second }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/hot',
    expandedRootId: root.id,
    posts: [root, firstChild, first, secondChild, second],
  }))

  expect(html).not.toContain('projected-reply-deeper')
  expect(html).toMatch(/class="reply-node omitted-parent-reply">[\s\S]*?id="post-2806"[\s\S]*?class="reply-branch/)
  expect(html).toMatch(/class="reply-node omitted-parent-reply">[\s\S]*?id="post-2779"[\s\S]*?class="reply-branch/)
})

test('expanded feed conversations do not mark omissions when every reply at that depth is visible', () => {
  const root = { id: 50, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 2, direct_reply_count: 1 }
  const child = { id: 51, user_id: 2, parent_id: root.id, body: 'Only child', created_at: '2026-08-20 10:00:00',
    deleted_at: null, handle: 'child', reply_count: 1, direct_reply_count: 1, parent: root }
  const grandchild = { id: 52, user_id: 3, parent_id: child.id, body: 'Only grandchild',
    created_at: '2026-08-20 11:00:00', deleted_at: null, handle: 'grandchild', reply_count: 0,
    direct_reply_count: 0, parent: child }
  const html = renderToStaticMarkup(React.createElement(ThreadReplies, {
    parentId: root.id,
    replies: [root, child, grandchild],
    user: null,
    returnPath: '/latest',
  }))

  expect(html).not.toContain('aria-label="Earlier replies omitted"')
})

test('folded feed conversations reveal only one reply when the next newest is over 48 hours older', () => {
  const root = { id: 1, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 09:00:00', deleted_at: null,
    handle: 'root', reply_count: 2 }
  const olderReply = { id: 2, user_id: 2, parent_id: 1, body: 'Older reply', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'reply', reply_count: 0, parent: root }
  const recentReply = { id: 3, user_id: 3, parent_id: 1, body: 'Recent reply', created_at: '2026-08-25 11:00:01',
    deleted_at: null, handle: 'recent', reply_count: 0, parent: root }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/latest',
    posts: [root, olderReply, recentReply],
  }))

  expect(html.match(/collapsed-preview-post/g)).toHaveLength(1)
})

test('promoted deep feed activity anchors at its recent branch instead of resurrecting the root', () => {
  const root = { id: 1, user_id: 1, parent_id: null, body: 'Old root', created_at: '2025-01-01 09:00:00',
    deleted_at: null, handle: 'root', reply_count: 1 }
  const branch = { id: 2, user_id: 2, parent_id: 1, body: 'Deep branch', created_at: '2025-01-02 09:00:00',
    deleted_at: null, handle: 'branch', reply_count: 1, parent: root }
  const recent = { id: 3, user_id: 3, parent_id: 2, body: 'Recent answer', created_at: '2026-08-23 10:00:00',
    deleted_at: null, handle: 'recent', reply_count: 0, parent: branch }
  const html = renderToStaticMarkup(React.createElement(FeedThreads, {
    user: null,
    returnPath: '/for-you',
    posts: [recent],
    promoteAncestors: true,
  }))

  expect(html).toContain('Deep branch')
  expect(html).toContain('Recent answer')
  expect(html).toContain('<blockquote class="parent-quote tappable-parent">')
  expect(html).toContain('Old root')
  expect(html).not.toContain('aria-label="Earlier replies omitted">…</div>')
})

test('admin metrics use locale-aware number formatting', () => {
  const html = renderToStaticMarkup(React.createElement(AdminDashboard, {
    user: { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' },
    stats: {
      users: 1234567,
      usersOnline: 12,
      anonymousOnline: 34,
      suspendedUsers: 0,
      activePosts: 2469134,
      notesPerUser: 2,
      averageNotesPerUser: 2.5,
      replies: 0,
      openReports: 0,
      activeUsersYesterday: 0,
      dau: 56,
      mau: 789,
      activatedNewUsersYesterday: 1,
      usersYesterday: 2,
      users24h: 1,
      users7d: 0,
      posts24h: 0,
      postsYesterday: 0,
      posts7d: 0,
      visitorsToday: 3,
      visitorsYesterday: 3,
      visitors7d: 0,
      redditVisitors: 1234,
      redditNewUsers: 12,
    },
    reports: [],
    actions: [],
    status: 'open',
    page: 1,
    total: 0,
    ipRequests: [
      { hash: 'a'.repeat(64), obfuscated: 'aaaaa', requests: 250, blocked: false },
      { hash: 'b'.repeat(64), obfuscated: 'bbbbb', requests: 100, blocked: true },
    ],
  }))

  expect(html).toContain(`<strong>${(1234567).toLocaleString()}</strong><span>users</span>`)
  expect(html).toContain('<strong>12</strong><span>users online · 30m</span>')
  expect(html).toContain('<strong>56</strong><span>active users · 24h</span>')
  expect(html).toContain('<strong>789</strong><span>active users · 1mo</span>')
  expect(html).toContain(
    `<strong>${
      (200 / 3).toLocaleString(undefined, { maximumFractionDigits: 2 })
    }%</strong><span>Conversion rate · yesterday</span>`,
  )
  expect(html).toContain('<strong>50%</strong><span>Signup-to-active conversion · yesterday</span>')
  expect(html).toContain('<strong>34</strong><span>anonymous online · 30m</span>')
  expect(html).toContain('<strong>2/2.5</strong><span>median/avg notes per user</span>')
  expect(html).toContain('class="account-settings-heading admin-header"')
  expect(html).toContain('class="profile-edit-link" href="/admin/email">send email</a>')
  expect(html).toContain(
    '<section class="admin-section admin-ip-requests"><details><summary>top IPs today <span>2</span>',
  )
  expect(html).not.toContain('<section class="admin-section admin-ip-requests"><details open=""')
  expect(html).toContain('<code>aaaaa</code><div class="admin-ip-actions"><span>250 requests</span>')
  expect(html).toContain('action="/admin/ip-blocks"')
  expect(html).not.toContain('a'.repeat(64) + '</code>')
  expect(html).toContain(
    '<code>bbbbb</code><div class="admin-ip-actions"><span>100 requests</span><span class="danger">blocked today</span>',
  )
})

test('pages advertise the dynamic favicon, touch icon, and manifest', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).toContain('href="/favicon-theme.svg?v=system.theme" type="image/svg+xml" sizes="any"')
  expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
  expect(html).toContain('rel="manifest" href="/site.webmanifest"')
  expect(html).not.toContain('rel="icon" href="/textlog.svg')
})

test('pagination requests instant scrolling without client-side scripts', () => {
  const html = renderToStaticMarkup(React.createElement(Pagination, {
    path: '/latest?view=flat',
    page: 2,
    totalPages: 3,
  }))
  expect(html).not.toContain('name="_scroll"')
  expect(html).toContain('page=1')
  expect(html).not.toContain('<script')
})

test('latest renders conversations only as trees', () => {
  const post = {
    id: 42,
    user_id: 2,
    parent_id: null,
    body: 'A latest note',
    created_at: '2026-08-23 10:00:00',
    deleted_at: null,
    handle: 'writer',
    reply_count: 0,
  }
  const tree = renderToStaticMarkup(React.createElement(PublicFeed, {
    user: null,
    path: '/latest',
    feed: { posts: [post], page: 1, totalItems: 1, totalPages: 1 },
  }))
  expect(tree).toContain('class="post-page-thread feed-thread"')
  expect(tree).not.toContain('view=flat')
  expect(tree).not.toContain('>flat</a>')
  expect(tree).not.toContain('>tree</a>')
})

test('hot feed conversations preserve selected ancestor context', () => {
  const root = { id: 494, user_id: 4, parent_id: null, body: 'Conversation root',
    created_at: '2026-08-08 14:20:43', deleted_at: null, handle: 'root', reply_count: 3 }
  const ancestor = { id: 496, user_id: 1, parent_id: root.id, body: 'Earlier context',
    created_at: '2026-08-08 14:25:42', deleted_at: null, handle: 'ancestor', reply_count: 2, parent: root }
  const parent = { id: 2516, user_id: 2, parent_id: ancestor.id, body: 'Quoted parent',
    created_at: '2026-08-26 05:27:01', deleted_at: null, handle: 'parent', reply_count: 1, parent: ancestor }
  const reply = { id: 2582, user_id: 3, parent_id: parent.id, body: 'Current reply',
    created_at: '2026-08-26 18:34:27', deleted_at: null, handle: 'reply', reply_count: 0, parent }
  const html = renderToStaticMarkup(React.createElement(HotFeed, {
    user: null,
    feed: { posts: [reply, parent], page: 1, totalItems: 1, totalPages: 1 },
  }))

  expect(html.match(/Conversation root/g)).toHaveLength(1)
  expect(html.match(/Earlier context/g)).toHaveLength(1)
  expect(html).toContain('Quoted parent')
  expect(html).toContain('Current reply')
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

test('appearance misc tab hides page size and forces 100', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    selectedPageSize: 40,
    selectedDensity: 'relaxed',
    selectedCorners: 'round',
    tab: 'misc',
  }))
  expect(html).toContain('aria-current="page">misc</a>')
  expect(html).toContain('<input type="hidden" name="pageSize" value="100"/>')
  expect(html).not.toContain('<legend>page size</legend>')
  expect(html).toContain('name="density" value="compact"')
  expect(html).toContain('name="corners" value="sharp"')
  expect(html).toContain('name="corners" checked="" value="round"')
  expect(html).toContain('name="density" value="regular"')
  expect(html).toContain('name="density" checked="" value="relaxed"')
  expect(html).toContain('class="density-preview density-preview-compact"')
  expect(html).toContain('class="density-preview density-preview-regular"')
  expect(html).toContain('class="density-preview density-preview-relaxed"')
  expect(html).toContain('name="showLinkPreviews" checked="" value="yes"')
  expect(html).toContain('<legend>ui</legend>')
  expect(html).toContain('Show link previews')
  expect(html).toContain('name="showModeratedContent" value="yes"')
  expect(html).toContain('Show moderated content')
  expect(html).not.toContain('name="showModeratedContent" checked=""')
  expect(html).toContain('name="includePeopleFollowActivity" value="yes"')
  expect(html).toContain('Include people&#x27;s follow activity in My Feed')
  expect(html).toContain('name="includeHashtagFollowActivity" value="yes"')
  expect(html).toContain('Include hashtag follow activity in My Feed')
  expect(html).not.toContain('name="includePeopleFollowActivity" checked=""')
  expect(html).not.toContain('name="includeHashtagFollowActivity" checked=""')
  expect(html).toContain('save misc →')
})

test('appearance misc tab can render link previews disabled', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    selectedLinkPreviews: false,
    tab: 'misc',
  }))
  expect(html).toContain('name="showLinkPreviews" value="yes"')
  expect(html).not.toContain('name="showLinkPreviews" checked=""')
})

test('appearance misc tab offers opt-in timestamps', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    showTimestamps: true,
    tab: 'misc',
  }))
  expect(html).toContain('name="showTimestamps" checked="" value="yes"')
  expect(html).toContain('<span>Show timestamps</span>')
})

test('appearance misc tab can enable moderated content without a consent screen', () => {
  const settings = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    showModeratedContent: true,
    tab: 'misc',
  }))
  expect(settings).toContain('name="showModeratedContent" checked="" value="yes"')

  const post = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', show_moderated_content: 1 },
    p: { id: 2, user_id: 2, parent_id: null, body: 'Sensitive note', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null, moderation_category: 'self-harm/intent',
      moderation_score: 0.72 },
  }))
  expect(post).toContain('Sensitive note')
  expect(post).not.toContain('content-warning')
})

test('appearance misc tab checks included For You follow activity', () => {
  const html = renderToStaticMarkup(React.createElement(ChangeAppearance, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    selected: { theme: 'system', accent: 'theme' },
    selectedFont: 'system',
    includePeopleFollowActivity: true,
    includeHashtagFollowActivity: true,
    tab: 'misc',
  }))
  expect(html).toContain('name="includePeopleFollowActivity" checked="" value="yes"')
  expect(html).toContain('name="includeHashtagFollowActivity" checked="" value="yes"')
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

test('account settings link to a focused recap email preference panel', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const subscribed = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: { ...user, recap_emails: 1 },
    posts: [],
    following: false,
    editing: true,
  }))
  const unsubscribed = renderToStaticMarkup(React.createElement(RecapEmails, {
    user,
    subscribed: false,
    changed: true,
  }))

  expect(subscribed).toContain('class="account-danger-zone" id="recap-emails"')
  expect(subscribed).toContain('href="/account/recap-emails">manage recap emails</a>')
  expect(unsubscribed).toContain('class="panel-shell recap-emails-shell"')
  expect(unsubscribed).toContain('class="panel panel-surface panel-medium recap-emails-panel"')
  expect(unsubscribed).toContain('<h1 class="panel-heading">Recap emails</h1>')
  expect(unsubscribed).toContain(
    '<p class="panel-copy">You are currently unsubscribed and will not be receiving recap emails.</p>',
  )
  expect(unsubscribed).toContain('class="form-actions-secondary"><a class="secondary-action" href="/account/edit"')
  expect(unsubscribed).toContain('name="subscribed" value="1"')
  expect(unsubscribed).toContain('>subscribe</button>')
  expect(unsubscribed).toContain('You have been unsubscribed.')
})

test('account settings link to a focused interaction email preference panel', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const profile = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: { ...user, interaction_emails: 1 },
    posts: [],
    following: false,
    editing: true,
  }))
  const preference = renderToStaticMarkup(React.createElement(InteractedEmails, {
    user,
    subscribed: false,
    changed: true,
  }))

  expect(profile).toContain('id="interaction-emails"')
  expect(profile).toContain('href="/account/interacted-emails">manage interaction emails</a>')
  expect(preference).toContain('<h1 class="panel-heading">Interaction emails</h1>')
  expect(preference).toContain('action="/account/interacted-emails"')
  expect(preference).toContain('name="subscribed" value="1"')
  expect(preference).toContain('You have been unsubscribed.')
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
  expect(notifications).toContain('data-return-href="/account/edit?from=%2Flatest%3Fpage%3D2#notifications"')
  expect(notifications).toContain('class="static-page notifications-page"')
  expect(notifications).toContain('class="profile-edit-link" href="/account/edit?from=%2Flatest%3Fpage%3D2">back</a>')
  expect(notifications).toContain('enable notifications')
  expect(notifications).toContain('name="latest" checked=""')
  expect(notifications).toContain('name="forYou" checked=""')
  expect(notifications).not.toContain('name="bots"')
  expect(notifications).toContain('name="onlyToMe" checked=""')
  expect(notifications).toContain('@ only')
  expect(notifications).not.toContain('name="replies"')
  expect(notifications).not.toContain('name="mentions"')
  expect(notifications).not.toContain('name="follows"')
  expect(notifications).not.toContain('name="ownPosts"')
  expect(notifications).not.toContain('name="followActivity"')
  expect(notifications).toContain('notify @reader about')
  expect(notifications).toContain('Only notes addressed to you')
  expect(notifications).toContain('name="peopleFollowActivity"')
  expect(notifications).toContain('include people&#x27;s follow activity')
  expect(notifications).toContain('name="hashtagFollowActivity"')
  expect(notifications).toContain('name="broadcasts" checked=""')
  expect(notifications).toContain('Announcements sent by the administrators')
  expect(notifications).toContain('include hashtag follow activity')
  expect(notifications.indexOf('name="peopleFollowActivity"')).toBeLessThan(
    notifications.indexOf('name="onlyToMe"'),
  )
  expect(notifications).not.toContain('name="signups"')
  expect(notifications).toContain('save preferences</button>')
  expect(profile).toContain('href="/account/edit/notifications"')
  expect(profile).toContain('class="account-danger-zone" id="notifications"')
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

  const writeShortcut = '<a class="skip-link" href="/write?from=%2F" accessKey="w">write</a>'
  const contentShortcut = '<a class="skip-link" href="#main-content">skip to content</a>'
  expect(html).toContain(writeShortcut)
  expect(html.indexOf(writeShortcut)).toBeLessThan(html.indexOf(contentShortcut))
  expect(html).not.toContain('class="mobile-write-action"')
})

test('guest pages keep skip to content as their first shortcut', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).not.toContain('accessKey="w">write</a>')
  expect(html).toContain('<body class="density-regular"><a class="skip-link" href="#main-content">skip to content</a>')
})

test('signed-in feeds put the mobile write action outside the main scroll boundary', () => {
  const html = renderToStaticMarkup(React.createElement(PublicFeed, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    feed: { posts: [], page: 1, totalItems: 0, totalPages: 2 },
  }))

  const writeAction = '<div class="mobile-write-action"><a class="button" href="#">write</a></div>'
  expect(html).toContain('has-mobile-write-action')
  expect(html).toContain(writeAction)
  expect(html.indexOf(writeAction)).toBeLessThan(html.indexOf('<main id="main-content">'))
})

test('signed-in feed pages put the write form before the feed tabs', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '',
    email_verified_at: '2026-08-20' }
  const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }
  const pages = [
    renderToStaticMarkup(React.createElement(PublicFeed, { user, feed, path: '/all' })),
    renderToStaticMarkup(React.createElement(HotFeed, { user, feed })),
  ]

  for (const html of pages) {
    expect(html).toContain('class="panel panel-surface panel-medium compose write-compose embedded-write-compose"')
    expect(html.indexOf('compose write-compose')).toBeLessThan(html.indexOf('class="feed-tabs"'))
    expect(html).toContain('name="from"')
    expect(html).toContain('placeholder="What’s on your mind, @reader?"')
    expect(html).toContain('name="body" maxLength="500" accessKey="w"')
    expect(html).not.toContain('class="skip-link" href="/write')
    expect(html).toContain('<a class="skip-link" href="#feed-tabs">skip to content</a>')
    expect(html).not.toContain('<a class="skip-link" href="#main-content">skip to content</a>')
    expect(html).not.toContain('class="compose-heading"')
    expect(html).not.toContain('autofocus')
    expect(html).not.toContain('feed-tab-new-badge')
    expect(html).toContain(
      '<label class="secondary-action posting-help-action" for="embedded-posting-help" title="Show more writing actions and help"><input class="posting-help-toggle" id="embedded-posting-help" type="checkbox" aria-controls="embedded-posting-help-content"/>more</label>',
    )
    expect(html).toContain(
      '<div class="posting-help-controlled-summary"><span class="posting-help-limits">500 chars / 15 lines max</span> · use #hashtags, @mentions and more</div>',
    )
    expect(html).not.toContain('>cancel</a>')
    expect(html).toMatch(/class="compose-editor-row"[\s\S]*class="composefoot"[\s\S]*<\/div><\/form>/)
  }
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
  expect(latest).toContain('href="/all.rss"')
  expect(latest).toContain('href="/all.atom"')
  expect(tag).toContain('href="/tag/ascii_art.rss"')
  expect(tag).toContain('href="/tag/ascii_art.atom"')
})

test('feed tabs include the chronological top-level new feed', () => {
  const html = renderToStaticMarkup(React.createElement(PublicFeed, {
    user: null,
    feed: { posts: [], page: 1, totalItems: 0, totalPages: 1 },
    path: '/new',
  }))

  expect(html).toContain('<a class="active" aria-current="page" href="/new">')
  expect(html).toContain('<h1 class="visually-hidden">New notes</h1>')
  expect(html).not.toContain('type="application/rss+xml"')
})

test('new feed threads load replies but hide every reply while collapsed', () => {
  const root = { id: 1, user_id: 1, parent_id: null, body: 'root', created_at: '2026-08-20 10:00:00',
    deleted_at: null, handle: 'writer', reply_count: 2 }
  const replies = [
    { id: 2, user_id: 2, parent_id: 1, body: 'first reply', created_at: '2026-08-20 11:00:00',
      deleted_at: null, handle: 'reader' },
    { id: 3, user_id: 3, parent_id: 1, body: 'second reply', created_at: '2026-08-20 12:00:00',
      deleted_at: null, handle: 'another' },
  ]
  const html = renderToStaticMarkup(React.createElement(PublicFeed, {
    user: null,
    feed: { posts: [root, ...replies], page: 1, totalItems: 1, totalPages: 1 },
    path: '/new',
  }))

  expect(html).toContain('class="thread-fold-input" type="checkbox"')
  expect(html).toContain('checked=""')
  expect(html).toContain('feed-thread-collapsed-branch')
  expect(html).not.toContain('collapsed-preview-post')
})

test('latest and hot feeds label posts addressed to the viewer', () => {
  const user = { id: 2, handle: 'reader', mood: '🤸', email: 'reader@example.com', bio: '' }
  const parent = { id: 4, user_id: user.id, parent_id: null, body: 'parent', created_at: '2026-08-20 11:00:00',
    deleted_at: null, handle: user.handle, reply_count: 1 }
  const post = { id: 9, user_id: 1, parent_id: 4, body: 'hello', created_at: '2026-08-20 12:00:00', deleted_at: null,
    handle: 'writer', viewer_context: 'reply' as const, parent }
  const feed = { posts: [post], page: 1, totalItems: 1, totalPages: 1 }

  const latest = renderToStaticMarkup(React.createElement(PublicFeed, { user, feed, path: '/latest' }))
  const hot = renderToStaticMarkup(React.createElement(HotFeed, { user, feed }))

  const replyToViewerLabel = '<span class="post-context">replied to <span class="post-context-author">you'
    + '<span class="post-mood">🤸</span></span>:</span>'
  expect(latest).toContain(replyToViewerLabel)
  expect(hot).toContain(replyToViewerLabel)
})

test('posts describe whether their author wrote or replied', () => {
  const user = { id: 3, handle: 'reader', mood: '🤸', email: 'reader@example.com', bio: '' }
  const parent = { id: 4, user_id: 2, parent_id: null, body: 'Parent', created_at: '2026-08-20 11:00:00',
    deleted_at: null, handle: 'foo', mood: '🌞', reply_count: 1 }
  const base = { user_id: 1, body: 'hello', created_at: '2026-08-20 12:00:00', deleted_at: null, handle: 'writer' }

  const topLevel = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 9, parent_id: null },
    user,
  }))
  const reply = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 10, parent_id: parent.id, parent },
    user,
  }))
  const replyToViewer = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 11, parent_id: parent.id, parent, viewer_context: 'reply' },
    user,
  }))
  const continuation = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 12, parent_id: parent.id, parent: { ...parent, user_id: base.user_id } },
    user,
  }))
  const poll = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 13, parent_id: null,
      poll: { options: [], totalVotes: 0, expired: false, expiresAt: Date.now() + 60_000, viewerVoted: false } },
    user,
  }))
  const mentioned = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 14, parent_id: parent.id, parent, viewer_mentioned: true },
    user,
  }))
  const replyToDeletedUser = renderToStaticMarkup(React.createElement(Post, {
    p: { ...base, id: 15, parent_id: parent.id, parent: { ...parent, handle: 'deleted-363' } },
    user,
  }))

  expect(topLevel).toContain('<span class="post-context">wrote:</span>')
  expect(reply).toContain('<span class="post-context">replied to</span><span class="reference-menu">')
  expect(reply).toContain('class="reference-menu-trigger postauthor" href="/u/foo?from=')
  expect(reply).toContain('>@foo</a><span class="post-mood">🌞</span><span class="reference-menu-popover">')
  expect(reply).toContain('<span class="post-context post-context-punctuation">:</span>')
  expect(replyToViewer).toContain(
    '<span class="post-context">replied to <span class="post-context-author">you'
      + '<span class="post-mood">🤸</span></span>:</span>',
  )
  expect(continuation).toContain('<span class="post-context">continued:</span>')
  expect(continuation).not.toContain('replied to')
  expect(poll).toContain('<span class="post-context">created a poll:</span>')
  expect(mentioned).toContain('<span class="post-context">replied to</span><span class="reference-menu">')
  expect(mentioned).not.toContain('<span class="post-context">replied to and mentioned you:</span>')
  expect(mentioned).toContain('<span class="post-context post-context-punctuation post-context-mention-suffix">'
    + ' and mentioned you:</span>')
  expect(replyToDeletedUser).toContain('<span class="post-context">replied to</span>'
    + '<span class="post-context deleted-context">(deleted account)</span>')
  expect(replyToDeletedUser).not.toContain('<span class="post-context">replied to</span>'
    + '<span class="reference-menu"><a class="reference-menu-trigger postauthor" href="/u/deleted-363')
})

test('quoted parents use the same attribution wording', () => {
  const user = { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' }
  const root = { id: 1, user_id: 1, parent_id: null, body: 'Root', created_at: '2026-08-20 10:00:00', deleted_at: null,
    handle: 'root', reply_count: 2 }
  const quoted = { id: 2, user_id: 2, parent_id: root.id, parent: root, body: 'Reply',
    created_at: '2026-08-20 11:00:00', deleted_at: null, handle: 'foo', reply_count: 1 }
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 3, parent_id: quoted.id, parent: quoted, body: 'Current', created_at: '2026-08-20 12:00:00',
      deleted_at: null, handle: 'reader' },
    user,
  }))

  expect(html).toContain('<div class="parent-quote-top"><span class="reference-menu">')
  expect(html).toContain('<span class="post-context">replied to</span><span class="reference-menu">')
  expect(html).toContain('class="reference-menu-trigger postauthor" href="/u/root?from=')

  const deletedRootHtml = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 3, parent_id: quoted.id, parent: { ...quoted, parent: { ...root, handle: 'deleted-1' } },
      body: 'Current', created_at: '2026-08-20 12:00:00', deleted_at: null, handle: 'reader' },
    user,
  }))
  expect(deletedRootHtml).toContain('<span class="post-context">replied to</span>'
    + '<span class="post-context deleted-context">(deleted account)</span>')
  expect(deletedRootHtml).not.toContain('/u/deleted-1')
})

test('reply detail renders a placeholder for an unavailable quoted parent', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 2582, user_id: 3, parent_id: 2516, body: 'Current reply', created_at: '2026-08-26 18:34:27',
      deleted_at: null, handle: 'reply', parent: { id: 2516, body: '', translation: null,
        created_at: '2026-08-26 18:34:27', deleted_at: null, has_latex: 0, has_links: 0, has_code: 0,
        handle: '', reply_count: 0, unavailable: true } },
    user: { id: 3, handle: 'reply', email: 'reply@example.com', bio: '' },
  }))

  expect(html).toContain('<blockquote class="parent-quote deleted-parent"><span>(unavailable post)</span></blockquote>')
  expect(html).not.toContain('open quoted post')
})

test('post metadata places the author mood directly after the handle', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 1, user_id: 2, parent_id: null, body: 'Moving', created_at: '2026-08-20 10:00:00',
      deleted_at: null, handle: 'stagas', mood: '🤸' },
    user: null,
  }))

  expect(html).toContain('>@stagas</a><span class="post-mood">🤸</span>')
})

test('posts by the viewer use plain you instead of a linked handle', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const own = { id: 1, user_id: 1, parent_id: null, body: 'Mine', created_at: '2026-08-20 10:00:00', deleted_at: null,
    handle: 'reader', mood: '🤸' }
  const post = renderToStaticMarkup(React.createElement(Post, { p: own, user }))
  const quoted = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 2, user_id: 2, parent_id: own.id, parent: { ...own, reply_count: 1 }, body: 'Reply',
      created_at: '2026-08-20 11:00:00', deleted_at: null, handle: 'foo' },
    user,
  }))

  expect(post).toContain(
    '<span class="postauthor post-context-author">you<span class="post-mood">🤸</span></span>'
      + '<span class="post-context">wrote:</span>',
  )
  expect(post).not.toContain('href="/u/reader')
  expect(quoted).toContain('<div class="parent-quote-top"><span class="postauthor post-context-author">you'
    + '<span class="post-mood">🤸</span></span>'
    + '<span class="post-context">wrote:</span>')
})

test('moderators see when a post author has blocked them', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 2, user_id: 2, parent_id: null, body: 'Visible for moderation',
      created_at: '2026-08-20 11:00:00', deleted_at: null, handle: 'blocker', blocked_viewer: true },
    user: { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' },
  }))

  expect(html).toContain('<span class="post-context">(user has blocked you)</span>')
})

test('moderators can view posts on a profile that blocked them', () => {
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' },
    profile: { id: 2, handle: 'blocker', email: 'blocker@example.com', bio: '' },
    posts: [{ id: 2, user_id: 2, parent_id: null, body: 'Visible for moderation',
      created_at: '2026-08-20 11:00:00', deleted_at: null, handle: 'blocker', blocked_viewer: true }],
    following: false,
    blockedByProfile: true,
    moderatorBypass: true,
    total: 1,
  }))

  expect(html).toContain('Visible for moderation')
  expect(html).not.toContain('This profile is unavailable.')
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
  expect(html).toContain('aria-current="page" href="/tag/notes?from=%2Flatest%23post-2">')
  expect(html).toContain('href="/tag/notes?tab=followers&amp;from=%2Flatest%23post-2">followers</a>')
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

  expect(html).toContain('href="/tag/notes">notes</a>')
  expect(html).toContain('aria-current="page" href="/tag/notes?tab=followers">')
  expect(html).toContain('id="person-3"')
  expect(html).toContain(
    'href="/u/writer?from=%2Ftag%2Fnotes%3Ftab%3Dfollowers%23person-3">@writer</a>',
  )
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

  test('uses sanitized plain text for Markdown document titles', () => {
    expect(postTitle('A **bold** [link](https://example.com) with `code` <script>bad</script>'))
      .toBe('A bold link with code')
  })

  test('truncates long post text with an ellipsis', () => {
    const title = postTitle('x'.repeat(61))
    expect(title).toBe(`${'x'.repeat(59)}…`)
    expect(Array.from(title)).toHaveLength(60)
  })

  test('replaces moderated post text with the notification description', () => {
    expect(postTitle('Sensitive note', 'self-harm/intent')).toBe('(moderated due to self-harm/intent)')
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
  expect(html).toContain('href="/account/security#feed-keys" target="_blank">account security</a>')
  expect(html).toContain('href="/account/security" target="_blank">account security</a>')
  expect(html).toContain('href="/account/api-keys/new" target="_blank">generate a revocable API key</a>')
  expect(html).toContain('href="/api/embed-examples"')
  expect(html.match(/class="api-endpoints"/g)).toHaveLength(1)
  expect(html).toContain('data-method="DELETE" data-auth="true"><span class="api-auth-dot"')
  expect(html).toContain('data-method="GET" data-auth="true"><span class="api-auth-dot"')
  expect(html).toContain('class="api-path">/activities/my-feed</span>')
  expect(html).toContain('class="api-path">/feeds/all/conversations</span>')
  expect(html).toContain('class="api-path">/feeds/hot/conversations</span>')
  expect(html).toContain('class="api-path">/activities/my-feed/conversations</span>')
  expect(html).toContain('class="api-path">/activities/@/conversations</span>')
  expect(html).toContain('id="threaded-feeds"')
  expect(html).toContain('Reading these endpoints does not mark items read.')
  expect(html).toContain('class="api-path">/users/:handle/blocks</span>')
  expect(html).toContain('class="api-path">/activities/@/read-all</span>')
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
  expect(html).toContain('/embed/all?theme=light&amp;accent=sage&amp;font=menlo')
  expect(html).toContain('/embed/hot?accent=purple&amp;font=consolas')
  expect(html).toContain('/embed/user/stagas?theme=dracula&amp;accent=cyan&amp;font=jetbrains')
  expect(html).toContain('/embed/tag/notes?theme=sepia&amp;accent=amber')
  expect(html).toContain('/embed/post/42?theme=system&amp;accent=blue')
  expect(html.match(/<iframe/g)).toHaveLength(5)
})

test('footer offers the mobile app in a mobile-only row', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))
  const signedInHtml = renderToStaticMarkup(React.createElement(About, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
  }))

  expect(html).toContain(
    'class="button mobile-app-footer" href="https://github.com/Faultless/textlog_flutter/releases"',
  )
  expect(html).toContain('get mobile app</a>')
  expect(signedInHtml).toContain(
    '<a class="button footer-write-action" href="#main-content">write a note</a>',
  )
})

test('footer links to stats next to the app host', () => {
  const html = renderToStaticMarkup(React.createElement(About, { user: null }))

  expect(html).toMatch(
    /<span><a class="footer-host-link" href="\/">[^<]+<\/a> <span aria-hidden="true">\/<\/span> <a class="footer-host-link" href="\/stats">stats<\/a><\/span>/,
  )
})

test('Contact page shows collective and fiscal host details and is linked before legal in the footer', () => {
  const html = renderToStaticMarkup(React.createElement(Contact, { user: null }))

  expect(html).toContain('href="mailto:hello@textlog.cc"')
  expect(html).toContain('textlog collective')
  expect(html).toContain('href="https://opencollective.com/textlog"')
  expect(html).toContain('Open Collective Europe ASBL')
  expect(html).toContain('Avenue Louise 500, 1000 Brussels, Belgium')
  expect(html).not.toContain('href="tel:')
  expect(html).toContain('href="/report-illegal-activity"')
  expect(html.indexOf('href="/contact"')).toBeLessThan(html.indexOf('href="/legal"'))
})

test('Legal privacy disclosures cover current account settings data', () => {
  const html = renderToStaticMarkup(React.createElement(Legal, { user: null }))

  expect(html).toContain('href="https://opencollective.com/textlog"')
  expect(html).toContain('one-way password hash')
  expect(html).toContain('hashed app entry codes')
  expect(html).toContain('appearance cookie')
  expect(html).toContain('manage your password and sessions')
  expect(html).toContain('download a JSON copy of your account data')
  expect(html).toContain('occasionally email account holders a recap')
  expect(html).toContain('unsubscribe at any time')
  expect(html).toContain('Every recap includes an unsubscribe link.')
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
  test('anonymous discovery pages offer a handle-free composer', () => {
    const feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }
    const pages = [
      withAppearance(new Request('https://textlog.test/hot?page=2'),
        () => renderToStaticMarkup(React.createElement(HotFeed, { user: null, feed }))),
      withAppearance(new Request('https://textlog.test/any?seed=test'),
        () => renderToStaticMarkup(React.createElement(PublicFeed, { user: null, feed, path: '/any?seed=test' }))),
      withAppearance(new Request('https://textlog.test/all?page=2'),
        () => renderToStaticMarkup(React.createElement(PublicFeed, { user: null, feed, path: '/all' }))),
    ]

    for (const html of pages) {
      const guestNav = html.slice(html.indexOf('<nav class="guest-nav"'), html.indexOf('</nav>'))
      expect(guestNav.indexOf('href="/about"')).toBeLessThan(guestNav.indexOf('href="/explore"'))
      expect(html).toContain('anonymous-write-compose')
      expect(html).toContain('placeholder="What&#x27;s on your mind?"')
      expect(html).not.toMatch(/<textarea[^>]*name="body"[^>]*required/)
      expect(html).toContain('title="Show more writing actions and help"')
      expect(html).not.toContain('placeholder="What’s on your mind, @')
    }
  })

  test('offers guest visitors a way to join or browse notes', () => {
    const html = renderToStaticMarkup(React.createElement(About, { user: null }))

    expect(html).toContain('Small by design')
    expect(html).toContain('Your profile and notes are public')
    expect(html).toContain('download or delete your account data')
    expect(html).toContain('class="action-pair about-actions"')
    expect(html).toContain('<span class="action-separator">or</span>')
    expect(html).toContain('class="button" href="/enter" rel="nofollow">join the community</a>')
    expect(html).toContain('href="/hot">browse notes</a>')
    expect(html).not.toContain('What&#x27;s happening')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('>browse more</a>')
  })

  test('API documentation lists root feed aliases', () => {
    const html = renderToStaticMarkup(React.createElement(ApiDocs, { user: null }))
    for (const alias of ['/all.json', '/all.rss', '/all.atom', '/hot.json', '/hot.rss', '/hot.atom']) {
      expect(html).toContain(alias)
    }
  })

  test('API documentation sections are closed disclosures by default', () => {
    const html = renderToStaticMarkup(React.createElement(ApiDocs, { user: null }))
    expect(html.match(/<details class="api-docs-section">/g) || []).toHaveLength(11)
    expect(html).not.toContain('<details class="api-docs-section" open=""')
    expect(html).toContain('<summary><h2>Endpoints</h2></summary>')
    expect(html).toContain('<summary><h2>Endpoints</h2></summary><div class="api-base-url"><h3>Base URL</h3>')
  })

  test('shows a guest composer above public feed tabs', () => {
    const feed = { posts: [], page: 1, totalItems: 20, totalPages: 2 }
    const guestHot = withAppearance(new Request('https://textlog.test/hot'),
      () => renderToStaticMarkup(React.createElement(HotFeed, { user: null, feed })))
    const guestLatest = withAppearance(new Request('https://textlog.test/all'),
      () => renderToStaticMarkup(React.createElement(PublicFeed, { user: null, feed, path: '/all' })))
    const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
    const signedInHot = renderToStaticMarkup(React.createElement(HotFeed, { user }))
    const signedInLatest = renderToStaticMarkup(React.createElement(PublicFeed, { user, path: '/all' }))

    for (const html of [guestHot, guestLatest]) {
      expect(html).not.toContain('class="static-page about-page feed-about"')
      expect(html).toContain('anonymous-write-compose')
      expect(html).toContain('placeholder="What&#x27;s on your mind?"')
      expect(html).toContain(
        'class="guest-join-row"><a class="button" href="/enter" rel="nofollow">join the community</a>',
      )
      expect(html).toContain('href="/hot"')
      expect(html).toContain('href="/all"')
      expect(html).toMatch(/href="\/any\?seed=[0-9a-z]+"/)
      const joinAction = '<div class="mobile-write-action"><a class="button" href="/enter" rel="nofollow">join</a></div>'
      expect(html).toContain('has-mobile-write-action')
      expect(html).toContain(joinAction)
      expect(html.indexOf(joinAction)).toBeLessThan(html.indexOf('<main id="main-content">'))
      expect(html).not.toContain('class="button feed-tabs-join"')
      expect(html).toContain('?page=2" aria-label="Page 2"')
      expect(html).toContain('?page=2" aria-label="Next page"')
      expect(html.indexOf('anonymous-write-compose')).toBeLessThan(html.indexOf('id="feed-tabs"'))
      expect(html.lastIndexOf('aria-label="Pagination"')).toBeLessThan(html.indexOf('class="guest-join-row"'))
    }
    for (const html of [signedInHot, signedInLatest]) {
      expect(html).toMatch(/href="\/any\?seed=[0-9a-z]+"/)
    }
    for (const html of [signedInHot, signedInLatest]) {
      expect(html).not.toContain('class="static-page about-page feed-about"')
      expect(html).toContain('href="/hot"')
      expect(html).toContain('href="/all"')
      expect(html).not.toContain('class="button feed-tabs-join"')
      expect(html).not.toContain('class="guest-join-row"')
    }
  })

  test('does not show the guest calls to action to signed-in visitors', () => {
    const html = renderToStaticMarkup(React.createElement(About, {
      user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    }))

    expect(html).not.toContain('class="about-actions"')
    expect(html).not.toContain('>browse notes</a>')
    expect(html).not.toContain('class="about-hot-more"')
  })

  test('does not show the feed join action on other anonymous pages', () => {
    const html = renderToStaticMarkup(React.createElement(Contact, { user: null }))

    expect(html).not.toContain('class="guest-join-row"')
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

    expect(html).toContain('<h1>New here or returning?</h1>')
    expect(html).toContain('action="/enter"')
    expect(html).toContain('email address or handle')
    expect(html).toContain('name="identifier"')
    expect(html).toContain('placeholder="you@example.com or your_handle"')
    expect(html).not.toContain('type="password"')
  })

  test('enter welcomes returning visitors back', () => {
    const html = renderToStaticMarkup(React.createElement(Auth, { returning: true }))

    expect(html).toContain('<h1>Welcome back.</h1>')
    expect(html).not.toContain('New here or returning?')
  })

  test('handle choice explains validation without blocking the server submission', () => {
    const html = renderToStaticMarkup(React.createElement(ChooseHandle))

    expect(html).toContain('Handles must be 2–24 characters')
    expect(html).toContain('Pick the name people will see.')
    expect(html).toContain('underscores. You can change it later.')
    expect(html).toContain('aria-describedby="handle-help"')
    expect(html).toContain('class="form-control"')
    expect(html).not.toContain('pattern=')
    expect(html).toContain('action="/choose-handle"')
    expect(html).toContain('<button class="button">continue →</button>')
    expect(html).toContain('class="density-regular full-screen-page"')
    expect(html).not.toContain('<header')
    expect(html).not.toContain('<footer')
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
  expect(passwordHtml).toContain('Delete @reader?')

  const emailHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, { user }))
  expect(emailHtml).not.toContain('type="password"')
  expect(emailHtml).toContain('send confirmation link →')
  expect(emailHtml).toContain('panel-danger')
  expect(emailHtml).toContain('class="button button-danger"')

  const tokenHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, {
    handle: 'reader',
    token: 'deletion-token',
  }))
  expect(tokenHtml).toContain('type="hidden" name="token" value="deletion-token"')
  expect(tokenHtml).toContain('Delete @reader?')
  expect(tokenHtml).toContain('>delete @reader</button>')

  const sentHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, { user, sent: true }))
  expect(sentHtml).toContain('Check your email to delete @reader.')
  expect(sentHtml).toContain('r•••@example.com')
  expect(sentHtml).not.toContain('reader@example.com')
  expect(sentHtml).toContain('@reader</strong> has not been deleted.')
  expect(sentHtml).not.toContain('action="/account/delete"')

  const developmentHtml = renderToStaticMarkup(React.createElement(ConfirmAccountDelete, {
    user,
    sent: true,
    confirmationUrl: 'http://localhost:3003/account/delete?token=development-token',
  }))
  expect(developmentHtml).toContain('open development confirmation link')
  expect(developmentHtml).toContain('/account/delete?token=development-token')
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
  expect(requestHtml).toContain('class="panel-shell enable-password-shell"')
  expect(requestHtml).toContain('class="panel panel-surface panel-medium enable-password-panel"')
  expect(requestHtml).toContain('<h1 class="panel-heading">Enable password login</h1>')
  expect(requestHtml).toContain(
    '<p class="panel-copy">We’ll email you a secure link before you can set a password.</p>',
  )
  expect(requestHtml).toContain('class="form-actions-secondary"><a class="secondary-action" href="/account/security"')
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
  expect(html).toContain('You can change your handle up to two times per month.')
  expect(html).toContain('Mood can be any emoji character.')
  expect(html).toContain('aria-describedby="profile-handle-help"')
  expect(html).not.toContain('profile-mood-new-badge')
  expect(html).toContain('<details class="posting-help-details">')
  expect(html).toContain('<span class="posting-help-limits">300 chars / 10 lines max</span>')
  expect(html).toContain('300 chars / 10 lines max</span> · use #hashtags, @mentions and more</span>')
  expect(html).not.toContain('<h2>Find hashtags and people</h2>')
  expect(html).not.toContain('<h2>Formatting</h2>')
  expect(html).not.toContain('<h2>Emoji</h2>')
  expect(html).not.toContain('name="isBot"')
  expect(html).not.toContain('name="timezone"')
  expect(html).not.toContain('This account is a bot')
  expect(html).not.toContain('pattern="[A-Za-z0-9_]{2,24}"')
  expect(html).not.toContain('hidden while editing')
  expect(html).not.toContain('class="profile-user-details"')
})

test('Profile edit shows timezone choices only when timestamps are enabled', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', show_timestamps: 1,
    timezone: 'Europe/Athens' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: profile,
    profile,
    posts: [],
    following: false,
    editing: true,
  }))
  expect(html).toContain('name="timezone"')
  expect(html).toContain('<option value="Europe/Athens" selected="">UTC +02/+03 — Athens, Helsinki, Bucharest</option>')
})

test('Profile edit offers an expanded copy-paste presence badge with a safe new-tab profile link', () => {
  const profile = { id: 2, handle: 'writer', email: '', bio: 'Writes things' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: profile,
    profile,
    following: false,
    posts: [],
    editing: true,
    social: {
      description: 'Writes things',
      image: 'https://textlog.test/u/writer/og.png',
      url: 'https://textlog.test/u/writer',
      type: 'profile',
    },
  }))

  expect(html).toContain('<h2 id="profile-presence-heading">Share your presence</h2>')
  expect(html).not.toContain('<details class="profile-presence"')
  expect(html).toContain('href="https://textlog.test/u/writer" target="_blank" rel="noopener noreferrer"')
  expect(html).toContain('src="https://textlog.test/u/writer/follow.png"')
  expect(html).toContain('class="profile-presence-tabs" role="tablist" aria-label="Button palette"')
  expect(html).toContain('src="https://textlog.test/u/writer/follow.png?theme=light"')
  expect(html).toContain('src="https://textlog.test/u/writer/follow.png?theme=sepia"')
  expect(html).toContain('src="https://textlog.test/u/writer/follow.png?theme=dracula"')
  expect(html).toContain('https://textlog.test/u/writer/follow.png?theme=dracula')
  expect(html).toContain('class="form-control magic-link-value api-key-output" tabindex="0"')
  expect(html).toContain('&lt;a href=&quot;https://textlog.test/u/writer&quot; target=&quot;_blank&quot;')

  const publicHtml = renderToStaticMarkup(React.createElement(Profile, {
    user: null,
    profile,
    following: false,
    posts: [],
  }))
  expect(publicHtml).not.toContain('Share your presence')
})

test('Profile places owner actions in the handle row', () => {
  const user = { id: 1, handle: 'reader', mood: '🤸', email: 'reader@example.com', bio: '',
    created_at: '2026-08-03 12:00:00' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    posts: [],
    returnPath: '/latest#post-2',
  }))

  expect(html).toContain('class="profile-title-row"')
  expect(html).toContain(
    'class="profile-canonical-link" href="/u/reader" title="User ID: 1"><span class="identity-prefix">@</span>reader</a>',
  )
  expect(html).toContain('</a><span class="profile-mood">🤸</span></h1>')
  expect(html).not.toContain('class="profile-user-details"')
  expect(html).not.toContain('class="profile-canonical-link" href="/u/reader?from=')
  expect(html).not.toContain('href="/account/edit">account</a>')
  expect(html).toContain('href="/latest#post-2">back</a>')
  expect(html).toContain('action="/logout"')
  expect(html).not.toContain('name="returnTo"')
  expect(html).toContain('type="application/rss+xml" title="Notes by @reader (RSS)" href="/u/reader.rss"')
  expect(html).toContain('type="application/atom+xml" title="Notes by @reader (Atom)" href="/u/reader.atom"')
  expect(html).toContain('class="account-nav-row account-nav-primary"')
  expect(html).toContain('class="account-nav-row account-nav-secondary"')
  expect(html).toContain('</div><a class="button nav-write-action" href="/write?from=%2F">write</a></span>')
  expect(html).toContain('class="account-menu-handle" href="/u/reader?from=%2F">@reader'
    + '<span class="nav-mood">🤸</span></a>')
  expect(html).toContain('class="account-menu-popover"')
  expect(html).toContain('href="/u/reader?from=%2F">profile</a>')
  expect(html).toContain('href="/account/edit?from=%2F">account</a>')
  expect(html).not.toContain('href="/admin">admin</a>')
  expect(html).not.toContain('class="mobile-account-footer"')
  expect(html.indexOf('class="account-menu-handle" href="/u/reader?from=%2F"')).toBeLessThan(
    html.indexOf('class="button nav-write-action" href="/write?from=%2F"'),
  )
  expect(html).toContain('<a class="button" href="/write?from=%2F">write a note</a>')
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
  expect(html).toContain('class="profile-edit-link profile-title-back-link"')
  expect(html).not.toContain('class="profile-action profile-back-action"')
  expect(html).toContain('href="/latest#post-2">back</a>')
  expect(html).not.toContain('class="profile-user-details"')
  expect(html.indexOf('aria-label="follow @writer"')).toBeLessThan(html.indexOf('href="/latest#post-2">back</a>'))
  expect(html).toContain('href="/u/writer?from=%2Flatest%23post-2">')
  expect(html).toContain('href="/u/writer?tab=replies&amp;from=%2Flatest%23post-2">replies</a>')
  expect(html).toContain('href="/u/writer?tab=following&amp;from=%2Flatest%23post-2"')
  expect(html).toContain('href="/u/writer?tab=followers&amp;from=%2Flatest%23post-2"')
})

test('Profile shows when the viewed account follows the viewer', () => {
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: { id: 2, handle: 'visitor', email: 'visitor@example.com', bio: '' },
    profile: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' },
    following: false,
    followsViewer: true,
    posts: [],
  }))

  expect(html).toContain('<span class="follows-you">follows you</span><button class="button" '
    + 'aria-label="follow back @writer">follow back</button>')
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
  expect(html).not.toContain('<a class="button" href="/write?from=%2F">write a note</a>')
})

test('An empty replies tab offers its owner a way to browse notes', () => {
  const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user,
    profile: user,
    following: false,
    posts: [],
    tab: 'replies',
  }))

  expect(html).toContain('You haven’t posted any replies yet.')
  expect(html).toContain('<a class="button" href="/">browse notes</a>')
  expect(html).not.toContain('<a class="button" href="/write?from=%2F">write a note</a>')
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

test('Following and followers paginate every 8 people', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const person = { id: 2, handle: 'writer', email: 'writer@example.com', bio: '', posts: 1, viewerFollowing: false }
  for (const kind of ['following', 'followers'] as const) {
    const html = renderToStaticMarkup(React.createElement(Connections, {
      user: null,
      profile,
      people: [person],
      kind,
      page: 1,
      total: 9,
      noteCount: 0,
      followerCount: 9,
      followingCount: 9,
      followingTagCount: 0,
      following: false,
    }))

    expect(html).toContain(`href="/u/reader?tab=${kind}&amp;page=2${
      kind === 'following' ? '&amp;_scroll=instant' : ''
    }#connections-people-heading"`)
    expect(html.indexOf('aria-label="People pagination"')).toBeLessThan(html.indexOf('connection-people'))
    expect(html.lastIndexOf('aria-label="People pagination"')).toBeGreaterThan(html.indexOf('connection-people'))
  }
})

test('following renders a person mood next to their username', () => {
  const profile = { id: 1, handle: 'reader', email: '', bio: '' }
  const person = { id: 2, handle: 'writer', mood: '🌞', email: '', bio: '', posts: 1, viewerFollowing: false }
  const html = renderToStaticMarkup(React.createElement(Connections, {
    user: null,
    profile,
    people: [person],
    kind: 'following',
    page: 1,
    total: 1,
    noteCount: 0,
    followerCount: 0,
    followingCount: 1,
    followingTagCount: 0,
    following: false,
  }))

  expect(html).toContain('>@writer</a><span class="post-mood">🌞</span>')
})

test('Connection sorting can only be changed on the viewer’s own profile', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const person = { id: 2, handle: 'writer', email: 'writer@example.com', bio: '', posts: 1, viewerFollowing: false }
  const own = renderToStaticMarkup(React.createElement(Connections, {
    user: profile,
    profile,
    people: [person],
    kind: 'followers',
    sort: 'abc',
    page: 1,
    total: 1,
    noteCount: 0,
    followerCount: 1,
    followingCount: 0,
    followingTagCount: 0,
    following: false,
  }))
  const recent = renderToStaticMarkup(React.createElement(Connections, {
    user: profile,
    profile,
    people: [person],
    kind: 'following',
    sort: 'recent',
    page: 2,
    total: 11,
    tagsPage: 3,
    tagsTotal: 21,
    tags: [],
    noteCount: 0,
    followerCount: 0,
    followingCount: 11,
    followingTagCount: 21,
    following: false,
  }))
  const other = renderToStaticMarkup(React.createElement(Connections, {
    user: { ...profile, id: 3 },
    profile,
    people: [person],
    kind: 'followers',
    page: 1,
    total: 1,
    noteCount: 0,
    followerCount: 1,
    followingCount: 0,
    followingTagCount: 0,
    following: false,
  }))

  expect(own).toContain('href="/u/reader?tab=followers">recent</a>')
  expect(recent).toContain('href="/u/reader?tab=following&amp;sort=abc&amp;tagsPage=3">abc</a>')
  expect(recent).toContain(
    'href="/u/reader?tab=following&amp;tagsPage=3&amp;page=1&amp;_scroll=instant#connections-people-heading"',
  )
  expect(other).not.toContain('>recent</a>')
  expect(other).not.toContain('>abc</a>')
  expect(other).toContain('<h2 id="connections-people-heading">People</h2>')
})

test('Following and follower links return to the originating connection', () => {
  const profile = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }
  const person = { id: 2, handle: 'writer', email: 'writer@example.com', bio: '', posts: 1, viewerFollowing: false }
  const following = renderToStaticMarkup(React.createElement(Connections, {
    user: profile,
    profile,
    people: [person],
    tags: [{ tag: 'notes', count: 1, viewerFollowing: true }],
    kind: 'following',
    page: 2,
    total: 11,
    tagsPage: 3,
    tagsTotal: 25,
    noteCount: 0,
    followerCount: 0,
    followingCount: 11,
    followingTagCount: 25,
    following: false,
  }))
  const followers = renderToStaticMarkup(React.createElement(Connections, {
    user: profile,
    profile,
    people: [person],
    kind: 'followers',
    page: 2,
    total: 11,
    noteCount: 0,
    followerCount: 11,
    followingCount: 0,
    followingTagCount: 0,
    following: false,
  }))

  expect(following).toContain(
    '<div class="explore-tag-card" id="tag-notes"><form action="/tag-follow/notes" method="post"><input type="hidden" name="from" '
      + 'value="/u/reader?tab=following&amp;page=2&amp;tagsPage=3#tag-notes"/>',
  )
  expect(following).toContain(
    'class="explore-tag-link" href="/tag/notes?from=%2Fu%2Freader%3Ftab%3Dfollowing%26page%3D2%26tagsPage%3D3%23tag-notes" '
      + 'title="View #notes"',
  )
  expect(following).toContain(
    '<div class="explore-section-heading"><h2 id="connections-tags-heading">Tags</h2>'
      + '<nav class="pagination pagination-compact"',
  )
  expect(following.indexOf('aria-label="Tags pagination"')).toBeLessThan(
    following.indexOf('class="explore-tag-chips"'),
  )
  expect(following).toContain(
    'href="/u/writer?from=%2Fu%2Freader%3Ftab%3Dfollowing%26page%3D2%26tagsPage%3D3%23person-2"',
  )
  expect(followers).toContain(
    'href="/u/writer?from=%2Fu%2Freader%3Ftab%3Dfollowers%26page%3D2%23person-2"',
  )
})

test('Connection bios render enriched mention and hashtag hover cards', () => {
  const html = renderToStaticMarkup(React.createElement(ConnectionPeople, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    people: [{
      id: 2,
      handle: 'writer',
      email: 'writer@example.com',
      bio: 'Reading @friend and #notes',
      posts: 1,
      viewerFollowing: false,
      bioReference: {
        linkPreviews: {},
        mentionBios: { friend: 'A friendly bio' },
        mentionNoteCounts: { friend: 3 },
        mentionProfileStats: { friend: { notes: 3, replies: 1, followers: 2, following: 4, followingTags: 1 } },
        mentionFollowing: { friend: false },
        mentionFollowsViewer: { friend: false },
        hashtagCounts: { notes: 5 },
        hashtagFollowerCounts: { notes: 2 },
        hashtagFollowing: { notes: false },
      },
    }],
  }))

  expect(html).toContain('class="reference-menu-popover"')
  expect(html).toContain('A friendly bio')
  expect(html).toContain('class="reference-menu-popover reference-menu-popover-tag"')
  expect(html.match(/A friendly bio/g)).toHaveLength(2)
})

test('Connection people do not render a zero when they do not follow the viewer', () => {
  const html = renderToStaticMarkup(React.createElement(ConnectionPeople, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    people: [{
      id: 2,
      handle: 'writer',
      email: 'writer@example.com',
      bio: '',
      posts: 0,
      viewerFollowing: false,
      followsViewer: 0,
    } as unknown as import('./types').PersonView],
  }))

  expect(html).not.toContain('follows you')
  expect(html).not.toContain('<form method="post" action="/follow/writer">0')
  expect(html).not.toContain('profile-bio')
  expect(html).not.toContain('No bio yet.')
  expect(html).toContain('<button class="button">follow</button>')
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

test('Pagination headings use the backend mobile user-agent signal for full-width controls', () => {
  const mobileRequest = new Request('https://textlog.test/explore', {
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36' },
  })
  expect(withAppearance(mobileRequest, paginationHeadingClass))
    .toBe('explore-section-heading explore-section-heading-mobile')
  expect(withAppearance(new Request('https://textlog.test/explore'), paginationHeadingClass))
    .toBe('explore-section-heading')
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

test('Followed tags paginate every 24 tags', () => {
  const html = renderToStaticMarkup(React.createElement(Connections, {
    user: null,
    profile: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' },
    people: [],
    tags: [{ tag: 'notes', count: 1, viewerFollowing: false }],
    kind: 'following',
    page: 1,
    total: 0,
    tagsTotal: 25,
    noteCount: 0,
    followerCount: 0,
    followingCount: 0,
    followingTagCount: 13,
    following: false,
  }))

  expect(html).toContain(
    'href="/u/reader?tab=following&amp;tagsPage=2&amp;_scroll=instant#connections-tags-heading"',
  )
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
    bioReference: {
      hashtagCounts: { textlog: 1 },
      hashtagFollowerCounts: { textlog: 1 },
      hashtagFollowing: { textlog: false },
      mentionBios: {},
      mentionNoteCounts: {},
      mentionProfileStats: {},
      mentionFollowing: {},
      linkPreviews: {},
    },
  }))

  expect(html).toContain('<span class="reference-menu"><input class="mobile-popover-toggle" type="checkbox" '
    + 'aria-label="Toggle reference details"><a class="reference-menu-trigger" '
    + 'href="/tag/textlog">#TextLog</a><span class="reference-menu-popover reference-menu-popover-tag">')
  expect(html).not.toContain('reference-profile-tabs')
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
        parent_id: null,
        body: 'parent [link](https://example.com/post)',
        handle: 'author',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
        link_previews: {
          'https://example.com/post': { imageUrl: 'https://example.com/post.jpg', title: 'Parent preview',
            imageWidth: 1200, imageHeight: 630 },
        },
      },
    },
  }))
  expect(html).not.toContain('· replies</span>')
  expect(html).not.toContain('2 replies')
  expect(html).toContain('@author')
  expect(html).toContain('parent')
  expect(html).toContain(
    'href="https://example.com/reply" title="https://example.com/reply" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>',
  )
  expect(html).toContain(
    'href="https://example.com/post" title="https://example.com/post" target="_blank" rel="nofollow ugc noopener noreferrer">link</a>',
  )
  expect(html).toContain('class="remote-link-popover" href="https://example.com/post"')
  expect(html).toContain('<strong class="remote-link-title">Parent preview</strong>')
  expect(html).not.toContain('enter to reply')
  expect(html).not.toContain('post-reply-link')
})

test('Post uses the full Post component for internal link hover cards', () => {
  const url = 'https://textlog.test/post/12'
  const html = renderToStaticMarkup(React.createElement(Post, { user: {
    id: 1,
    handle: 'writer',
    email: 'writer@example.com',
    bio: '',
    suspended_at: null,
  }, p: {
    id: 1,
    user_id: 2,
    parent_id: null,
    body: url,
    created_at: '2026-08-24 10:00:00',
    deleted_at: null,
    handle: 'linker',
    reply_count: 0,
    link_previews: { [url]: { imageUrl: url, linkedPost: {
      id: 12,
      user_id: 1,
      parent_id: null,
      body: 'The linked note',
      execution_output: 'result: 42',
      handle: 'writer',
      reply_count: 2,
      thread_locked: false,
    } } },
  } }))
  const card = html.slice(html.indexOf('class="remote-link-popover internal-post-popover"'))
  expect(html.slice(0, html.indexOf('class="remote-link-popover internal-post-popover"')))
    .toContain('href="https://textlog.test/post/12?from=%2Fpost%2F1%23post-1"')
  expect(card).toContain('class="post internal-post-card tappable-post"')
  expect(card).toContain('class="post-hit-area" href="/post/12?from=%2Fpost%2F1%23post-1"')
  expect(card).toContain('<span class="postauthor post-context-author">you</span>')
  expect(card).toContain('<span class="post-context">wrote:</span>')
  expect(card).toContain('The linked note')
  expect(card).toContain('<code class="code-fence execution-output ascii-art">result: 42</code>')
  expect(card).not.toContain('post-reply-link')
  expect(card).toContain('>more</a>')
  expect(card).not.toContain('>read</a>')
})

test('Post renders internal link hover cards inside quoted parents', () => {
  const url = 'https://textlog.test/post/12'
  const html = renderToStaticMarkup(React.createElement(Post, { user: null, p: {
    id: 2,
    user_id: 2,
    parent_id: 1,
    body: 'reply',
    created_at: '2026-08-24 11:00:00',
    deleted_at: null,
    handle: 'replier',
    reply_count: 0,
    parent: {
      id: 1,
      user_id: 1,
      parent_id: null,
      body: url,
      created_at: '2026-08-24 10:00:00',
      deleted_at: null,
      handle: 'author',
      reply_count: 1,
      link_previews: { [url]: { imageUrl: url, linkedPost: {
        id: 12,
        user_id: 3,
        parent_id: null,
        body: 'Linked from the quoted parent',
        handle: 'linked-author',
        reply_count: 0,
      } } },
    },
  } }))
  const quote = html.slice(html.indexOf('class="parent-quote'))
  expect(quote).toContain('class="remote-link-menu internal-post-link-menu"')
  expect(quote).toContain('class="remote-link-popover internal-post-popover"')
  expect(quote).toContain('Linked from the quoted parent')
})

test('internal post hover cards preserve moderation consent masks', () => {
  const url = 'https://textlog.test/post/12'
  const html = renderToStaticMarkup(React.createElement(Post, { user: null, p: {
    id: 1, user_id: 2, parent_id: null, body: url, handle: 'linker',
    created_at: '2026-08-24 10:00:00', deleted_at: null,
    link_previews: { [url]: { imageUrl: url, linkedPost: {
      id: 12, user_id: 1, parent_id: null, body: 'Sensitive hovercard', handle: 'writer',
      reply_count: 0, thread_locked: false, moderation_category: 'violence', moderation_score: 0.8,
    } } },
  } }))
  const card = html.slice(html.indexOf('class="remote-link-popover internal-post-popover"'))
  expect(card).toContain('class="content-warning"')
  expect(card).toContain('class="content-warning-mask" aria-hidden="true">░░░░░░░░░ ░░░░░░░░░</div>')
  expect(card).toContain('possible violence content')
})

test('internal post hover cards render linked quizzes with the full Post component', () => {
  const url = 'https://textlog.test/post/12'
  const html = renderToStaticMarkup(React.createElement(Post, { user: null, p: {
    id: 1,
    user_id: 2,
    parent_id: null,
    body: url,
    created_at: '2026-08-24 10:00:00',
    deleted_at: null,
    handle: 'linker',
    reply_count: 0,
    link_previews: { [url]: { imageUrl: url, linkedPost: {
      id: 12,
      user_id: 3,
      parent_id: null,
      body: '#quiz\nMercury\n* Venus\nEarth',
      handle: 'quizzer',
      reply_count: 0,
      thread_locked: false,
      poll: { kind: 'quiz', totalVotes: 0, expired: false, expiresAt: null, viewerVoted: false, options: [
        { id: 1, label: 'Mercury', votes: 0, selected: false, correct: false },
        { id: 2, label: 'Venus', votes: 0, selected: false, correct: true },
        { id: 3, label: 'Earth', votes: 0, selected: false, correct: false },
      ] },
    } } },
  } }))
  const card = html.slice(html.indexOf('class="remote-link-popover internal-post-popover"'))
  expect(card).toContain('class="poll quiz" aria-label="Quiz"')
  expect(card).toContain('action="/post/12/poll"')
  expect(card).toContain('>Mercury</button>')
  expect(card).toContain('>Venus</button>')
})

test('internal post hover cards mark linked ASCII art for preserved formatting', () => {
  const url = 'https://textlog.test/post/12'
  const html = renderToStaticMarkup(React.createElement(Post, { user: null, p: {
    id: 1,
    user_id: 2,
    parent_id: null,
    body: url,
    created_at: '2026-08-24 10:00:00',
    deleted_at: null,
    handle: 'linker',
    reply_count: 0,
    link_previews: { [url]: { imageUrl: url, linkedPost: {
      id: 12,
      user_id: 3,
      parent_id: null,
      body: ' /\\_/\\\n( o.o )\n #ascii',
      handle: 'artist',
      reply_count: 0,
      thread_locked: false,
    } } },
  } }))
  const card = html.slice(html.indexOf('class="remote-link-popover internal-post-popover"'))
  expect(card).toContain('class="post-body ascii-art"')
  expect(card).toContain(' /\\_/\\\n( o.o )')
})

test('Profile and hashtag feeds show no reply metadata beside post dates', () => {
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
  const profileRepliesHtml = renderToStaticMarkup(React.createElement(Profile, {
    user: null,
    profile,
    following: false,
    posts: [{ ...post, parent_id: 1 }],
    tab: 'replies',
  }))
  const tagHtml = renderToStaticMarkup(React.createElement(TagFeed, {
    user: null,
    tag: 'notes',
    following: false,
    posts: [post],
    page: 1,
    total: 1,
  }))

  expect(profileHtml).not.toContain('· replies</span>')
  expect(tagHtml).not.toContain('· replies</span>')
  expect(profileHtml).not.toContain('3 replies')
  expect(tagHtml).not.toContain('3 replies')
  expect(profileHtml).not.toContain('class="postfoot')
  expect(profileHtml).toContain(
    'class="post-page-thread feed-thread profile-feed-thread profile-notes-feed-thread"',
  )
  expect(profileRepliesHtml).toContain(
    'class="post-page-thread feed-thread profile-feed-thread profile-replies-feed-thread"',
  )
  expect(profileRepliesHtml).not.toContain('class="postfoot')
  expect(tagHtml).not.toContain('class="postfoot')
  expect(profileHtml).not.toContain('class="posttop')
  expect(profileHtml).toContain('post-without-top-meta')
  expect(profileRepliesHtml).toContain('class="posttop')
  expect(profileRepliesHtml).not.toContain('post-without-top-meta')
  expect(tagHtml).toContain('class="posttop')
})

test('Profile posts link back to their originating feed entries', () => {
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
    'href="/post/2?from=%2Fu%2Fwriter%3Fpage%3D2%23post-2"',
  )
  expect(replies).toContain(
    'href="/post/2?from=%2Fu%2Fwriter%3Ftab%3Dreplies%26page%3D2%23post-2"',
  )
})

test('Profile reply cards open their topmost displayed ancestor thread at the reply anchor', () => {
  const parent = {
    id: 1,
    user_id: 2,
    parent_id: null,
    body: 'A conversation parent',
    handle: 'reader',
    created_at: '2026-08-03 11:00:00',
    deleted_at: null,
    reply_count: 2,
  }
  const reply = (id: number) => ({
    id,
    user_id: 1,
    parent_id: parent.id,
    body: `Profile reply ${id}`,
    handle: 'writer',
    created_at: `2026-08-03 1${id}:00:00`,
    deleted_at: null,
    parent,
  })
  const html = renderToStaticMarkup(React.createElement(Profile, {
    user: null,
    profile: { id: 1, handle: 'writer', email: 'writer@example.com', bio: '' },
    following: false,
    posts: [reply(2), reply(3)],
    tab: 'replies',
  }))

  expect(html).toContain(
    'class="post-hit-area" href="/post/1?from=%2Fu%2Fwriter%3Ftab%3Dreplies%23post-2#post-2"',
  )
  expect(html).toContain(
    'class="post-hit-area" href="/post/1?from=%2Fu%2Fwriter%3Ftab%3Dreplies%23post-3#post-3"',
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

  expect(html.match(/class="post-body ascii-art"/g)).toHaveLength(2)
  expect(html).toContain('class="parent-quote ascii-art"')

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

test('execution output uses ASCII-art styling in posts, previews, and quoted parents', () => {
  const post = {
    id: 2,
    user_id: 1,
    parent_id: 1,
    body: 'reply',
    execution_output: 'reply output',
    handle: 'writer',
    created_at: '2026-08-03 12:00:00',
    deleted_at: null,
    parent: {
      id: 1,
      user_id: 2,
      parent_id: null,
      body: 'parent',
      execution_output: 'parent output',
      handle: 'author',
      created_at: '2026-08-03 11:00:00',
      deleted_at: null,
      reply_count: 1,
    },
  }
  const html = renderToStaticMarkup(React.createElement(Post, { user: null, p: post }))
  const preview = renderToStaticMarkup(React.createElement(PreviewPost, { p: post }))

  expect(html.match(/class="code-fence execution-output ascii-art"/g)).toHaveLength(2)
  expect(preview).toContain('class="code-fence execution-output ascii-art"')
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
  expect(feedHtml).not.toContain('class="postdate"')
  expect(detailHtml).not.toContain('post-hit-area')
  expect(detailHtml).toContain('class="postdate" href="/post/2"')
})

test('Post carries its originating cursor into detail and edit links', () => {
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
  expect(html).not.toContain('post-reply-link')
  expect(html).toContain('href="/post/2/edit?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).toContain('<input type="hidden" name="from" value="/latest?cursor=abc#post-2"/>')
  expect(html).toContain('id="post-2-user-friend" action="/follow/friend" method="post"')
  expect(html).toContain('id="post-2-tag-topic" action="/tag-follow/topic" method="post"')
  expect(html).not.toContain('reference-profile-tabs')
  expect(html).not.toContain('/post/2/delete')
})

test('Post pages use the context text as the canonical permalink', () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString()
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 2, user_id: 1, parent_id: null, body: 'A note', handle: 'writer', created_at: thirtyMinutesAgo,
      deleted_at: null },
    user: null,
    returnPath: '/latest?page=2#post-2',
    canonicalTimestamp: true,
  }))
  expect(html).toContain('<a class="post-context" href="/post/2" title="')
  expect(html).toContain('just now">wrote just now</a>'
    + '<span class="post-context post-context-punctuation">:</span>')
  expect(html).not.toContain('post-context-age')
  expect(html).not.toContain('href="/post/2">wrote:</a>')
  expect(html).not.toContain('>permalink</a>')

  const continuation = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 1, parent_id: 2, body: 'More', handle: 'writer', created_at: thirtyMinutesAgo,
      deleted_at: null,
      parent: { id: 2, user_id: 1, parent_id: null, body: 'First', handle: 'writer',
        created_at: thirtyMinutesAgo, deleted_at: null, reply_count: 1 } },
    user: null,
    canonicalTimestamp: true,
  }))
  expect(continuation).toContain('just now">continued just now</a>')

  const reply = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 4, user_id: 1, parent_id: 2, body: 'Reply', handle: 'writer', created_at: thirtyMinutesAgo,
      deleted_at: null,
      parent: { id: 2, user_id: 2, parent_id: null, body: 'Parent', handle: 'parent',
        created_at: thirtyMinutesAgo, deleted_at: null, reply_count: 1 } },
    user: null,
    canonicalTimestamp: true,
  }))
  expect(reply).toContain('just now">replied to</a>')
  expect(reply).toContain('\u00a0just now:</span>')
})

test('Post page ages use aligned approximate wording buckets', () => {
  const now = Date.parse('2026-08-25T12:00:00Z')
  const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString()

  expect(approximatePostAge(ago(30 * 60_000), now)).toEqual({ label: '30mins', wording: 'just' })
  expect(approximatePostAge(ago(6 * 60 * 60_000), now)).toEqual({ label: '6h', wording: 'recently' })
  expect(approximatePostAge(ago(11 * 60 * 60_000), now)).toEqual({ label: '11h', wording: 'recently' })
  expect(approximatePostAge(ago(12 * 60 * 60_000), now)).toEqual({ label: '1d', wording: 'earlier' })
  expect(approximatePostAge(ago(2 * 24 * 60 * 60_000), now)).toEqual({ label: '2d', wording: 'earlier' })
  expect(approximatePostAge(ago(3 * 24 * 60 * 60_000), now)).toEqual({ label: '3d', wording: 'a while ago' })
  expect(approximatePostAge(ago(13 * 24 * 60 * 60_000), now)).toEqual({ label: '13d', wording: 'a while ago' })
  expect(approximatePostAge(ago(14 * 24 * 60 * 60_000), now)).toEqual({ label: '14d', wording: 'some time ago' })
  expect(approximatePostAge(ago(89 * 24 * 60 * 60_000), now)).toEqual({ label: '89d', wording: 'some time ago' })
  expect(approximatePostAge(ago(90 * 24 * 60 * 60_000), now)).toEqual({ label: 'older', wording: 'a long time ago' })
  expect(postAgeTitle(ago(30 * 60_000), now)).toBe('Aug 2026, just now')
  expect(postAgeTitle('2026-08-25T05:00:00Z', now)).toBe('Aug 2026, recently')
  expect(postAgeTitle(ago(18 * 60 * 60_000), now)).toBe('Aug 2026, earlier')
  expect(postAgeTitle(ago(24 * 60 * 60_000), now)).toBe('Aug 2026, 1d ago')
  expect(postAgeTitle(ago(8 * 24 * 60 * 60_000), now)).toBe('Aug 2026, 1w ago')
  expect(postAgeTitle(ago(14 * 24 * 60 * 60_000), now)).toBe('Aug 2026, 2w ago')
  expect(postAgeTitle(ago(60 * 24 * 60 * 60_000), now)).toBe('Jun 2026, 2mo ago')
  expect(postAgeTitle(ago(2 * 365 * 24 * 60 * 60_000), now)).toBe('Aug 2024, 2y ago')
})

test('Public post pages end with join and browse actions', () => {
  const html = renderToStaticMarkup(React.createElement(PublicThread, {
    post: { id: 2, user_id: 1, parent_id: null, body: 'A note', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
  }))

  expect(html).toContain('class="post-page-thread public-post-page-thread"')
  expect(html).toContain('class="action-pair post-page-actions"')
  expect(html).toContain('class="button" href="/enter" rel="nofollow">join the community</a>')
  expect(html).toContain('href="/hot">browse more notes</a>')
  expect(html).not.toContain('post-reply-link')
  expect(html).toContain('anonymous-reply-compose')
})

test('Anonymous post pages show the full reply composer when reply is requested', () => {
  const html = renderToStaticMarkup(React.createElement(PublicThread, {
    post: { id: 2, user_id: 1, parent_id: null, body: 'A note', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
    showForm: true,
    returnPath: '/hot',
  }))

  expect(html).toContain('anonymous-reply-compose')
  expect(html).toContain('action="/post/2/reply#post-2"')
  expect(html).toContain('placeholder="Reply to @writer…"')
  expect(html).toContain('title="Show more writing actions and help"')
})

test('Anonymous reply detail places the composer beneath the clicked reply without a reply link', () => {
  const reply = { id: 11, user_id: 2, parent_id: 10, body: 'Reply', handle: 'replier',
    created_at: '2026-08-03 12:01:00', deleted_at: null }
  const html = renderToStaticMarkup(React.createElement(PublicThread, { post: reply }))

  expect(html).not.toContain('post-reply-link')
  expect(html).toContain('action="/post/11/reply#post-11"')
  expect(html).toContain('placeholder="Reply to @replier…"')
  expect(html.indexOf('id="post-11"')).toBeLessThan(html.indexOf('anonymous-reply-compose'))
})

test('Anonymous conversation uses the clicked feed reply as the inline composer target', () => {
  const root = { id: 10, user_id: 1, parent_id: null, body: 'Root', handle: 'root',
    created_at: '2026-08-03 12:00:00', deleted_at: null }
  const reply = { id: 11, user_id: 2, parent_id: 10, body: 'Reply', handle: 'replier',
    created_at: '2026-08-03 12:01:00', deleted_at: null }
  const html = renderToStaticMarkup(React.createElement(PublicThread, {
    post: root,
    replies: [reply],
    replyTo: reply,
    returnPath: '/hot#post-11',
  }))

  expect(html).not.toContain('post-reply-link')
  expect(html).toContain('class="inline-reply-compose"')
  expect(html).toContain('replybox reply-compose anonymous-reply-compose')
  expect(html).not.toContain('reply-compose root-reply-compose anonymous-reply-compose')
  expect(html).toContain('action="/post/11/reply#post-11"')
  expect(html.indexOf('id="post-11"')).toBeLessThan(html.indexOf('anonymous-reply-compose'))
})

test('Anonymous tag and people pages end with join and browse actions', () => {
  const profile = {
    id: 1, handle: 'writer', email: 'writer@example.com', bio: '', created_at: '2026-08-03 12:00:00',
  }
  const pages = [
    React.createElement(TagFeed, {
      user: null, tag: 'writing', following: false, posts: [], page: 1, total: 0,
    }),
    React.createElement(Profile, {
      user: null, profile, posts: [], following: false,
    }),
    React.createElement(Connections, {
      user: null, profile, people: [], kind: 'followers', page: 1, total: 0, noteCount: 0,
      followerCount: 0, followingCount: 0, followingTagCount: 0, following: false,
    }),
  ]

  for (const page of pages) {
    const html = renderToStaticMarkup(page)
    expect(html).toContain('class="action-pair post-page-actions"')
    expect(html).toContain('class="button" href="/enter" rel="nofollow">join the community</a>')
    expect(html).toContain('href="/hot">browse more notes</a>')
  }
})

test('Thread pages show approximate wording only on the primary post', () => {
  const createdAt = new Date(Date.now() - 6 * 60 * 60_000).toISOString()
  const html = renderToStaticMarkup(React.createElement(PublicThread, {
    post: { id: 1, user_id: 1, parent_id: null, body: 'Root', handle: 'root', created_at: createdAt, deleted_at: null },
    replies: [
      { id: 2, user_id: 2, parent_id: 1, body: 'First', handle: 'one', created_at: createdAt, deleted_at: null },
      { id: 3, user_id: 3, parent_id: 2, body: 'Second', handle: 'two', created_at: createdAt, deleted_at: null },
    ],
  }))

  expect(html).not.toContain('post-context-age')
  expect(html).toContain('>wrote recently</a><span class="post-context post-context-punctuation">:</span>')
  expect(html.match(/wrote recently/g)).toHaveLength(1)
})

test('Thread pages also place back after the timestamp of its targeted reply', () => {
  const html = renderToStaticMarkup(React.createElement(Reply, {
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', show_timestamps: 1 },
    post: { id: 10, user_id: 2, parent_id: null, body: 'Root', handle: 'root',
      created_at: '2026-08-30 11:00:00', deleted_at: null },
    replies: [{ id: 11, user_id: 3, parent_id: 10, body: 'Target reply', handle: 'writer',
      created_at: '2026-08-30 12:00:00', deleted_at: null }],
    showForm: false,
    returnPath: '/latest?expand=10#post-11',
  }))
  const root = html.slice(html.indexOf('id="post-10"'), html.indexOf('id="post-11"'))
  const reply = html.slice(html.indexOf('id="post-11"'), html.indexOf('</article>', html.indexOf('id="post-11"')))

  expect(root).toContain('class="quiet post-back-link" href="/latest?expand=10#post-11">back</a>')
  expect(reply).toMatch(
    /<time class="post-relative-time"[^>]*>.*?<\/time><a class="quiet post-back-link" href="\/latest\?expand=10#post-11">back<\/a>/,
  )
})

test('Reply pages show a top link after the linked reply context', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 1, parent_id: 2, body: 'A reply', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null,
      parent: { id: 2, user_id: 2, parent_id: null, body: 'Parent', handle: 'parent', created_at: '2026-08-03 11:00:00',
        deleted_at: null, reply_count: 1 } },
    user: null,
    canonicalTimestamp: true,
    topHref: '/post/1?from=%2Flatest%23post-3',
    backHref: '/latest#post-3',
  }))
  expect(html).toContain('<a class="post-context" href="/post/3" title="')
  expect(html).toContain('ago">replied to</a>')
  expect(html).toContain('<div class="post-navigation-actions"><a class="quiet post-top-link" '
    + 'href="/post/1?from=%2Flatest%23post-3">top</a><a class="quiet post-back-link" '
    + 'href="/latest#post-3">back</a></div>')
  expect(html).not.toContain('>permalink</a>')
})

test('opt-in timestamps are compact, muted, localized, and precede top actions', () => {
  expect(shortPostAge('2026-08-30 12:00:00', Date.parse('2026-08-30T12:00:05Z'))).toBe('5s')
  expect(shortPostAge('2026-08-30 12:00:00', Date.parse('2026-08-30T12:15:00Z'))).toBe('15m')
  expect(shortPostAge('2026-08-29 12:00:00', Date.parse('2026-08-30T12:00:00Z'))).toBe('1d')
  expect(shortPostAge('2026-08-16 12:00:00', Date.parse('2026-08-30T12:00:00Z'))).toBe('2w')

  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 2, parent_id: null, body: 'A note', handle: 'writer',
      created_at: '2026-08-30 12:00:00', deleted_at: null },
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', show_timestamps: 1 },
    topHref: '/post/1',
  }))
  expect(html).toMatch(/<time class="post-relative-time"[^>]*title="Aug 30, 2026, 12:00 PM \(UTC \+00\)"[^>]*>.*?<\/time><a class="quiet post-top-link"/)
})

test('opt-in timestamps tolerate feed entries without a creation time', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    p: { id: 3, user_id: 2, parent_id: null, body: 'A synthetic feed note', handle: 'writer',
      created_at: undefined as unknown as string, deleted_at: null },
    user: { id: 1, handle: 'reader', email: 'reader@example.com', bio: '', show_timestamps: 1 },
    tappable: true,
  }))
  expect(html).not.toContain('post-relative-time')
  expect(html).toContain('A synthetic feed note')
})

test('Conversation roots show a flat link in the top-link action slot', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 1, user_id: 1, parent_id: null, body: 'Root', handle: 'author', created_at: '2026-08-03 10:00:00',
      deleted_at: null },
    canonicalTimestamp: true,
    flatHref: '/post/1?flat=1',
  }))
  expect(html).toContain('<a class="quiet post-top-link" href="/post/1?flat=1">flat</a>')
})

test('Flat conversations show a tree link in the same action slot', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 1, user_id: 1, parent_id: null, body: 'Root', handle: 'author', created_at: '2026-08-03 10:00:00',
      deleted_at: null },
    canonicalTimestamp: true,
    treeHref: '/post/1?from=%2Flatest%23post-1',
  }))
  expect(html).toContain('<a class="quiet post-top-link" href="/post/1?from=%2Flatest%23post-1">tree</a>')
})

test('Flat thread replies render descendants in depth-first order without nested branches', () => {
  const reply = (id: number, parentId: number, body: string) => ({
    id,
    user_id: 1,
    parent_id: parentId,
    body,
    handle: 'author',
    created_at: `2026-08-03 1${id}:00:00`,
    deleted_at: null,
  })
  const html = renderToStaticMarkup(React.createElement(ThreadReplies, {
    parentId: 1,
    replies: [reply(2, 1, 'first'), reply(3, 1, 'second'), reply(4, 2, 'first child')],
    user: null,
    flat: true,
  }))

  expect(html.match(/class="reply-branch/g)).toHaveLength(1)
  expect(html.indexOf('id="post-2"')).toBeLessThan(html.indexOf('id="post-4"'))
  expect(html.indexOf('id="post-4"')).toBeLessThan(html.indexOf('id="post-3"'))
})

test('Deleted replies render as tombstones above their indented descendants', () => {
  const reply = (id: number, parentId: number, body: string, deletedAt: string | null = null) => ({
    id,
    user_id: 1,
    parent_id: parentId,
    body,
    handle: 'author',
    created_at: `2026-08-03 1${id}:00:00`,
    deleted_at: deletedAt,
  })
  const html = renderToStaticMarkup(React.createElement(ThreadReplies, {
    parentId: 1,
    replies: [
      reply(2, 1, '(deleted)', '2026-08-03 12:30:00'),
      reply(3, 2, 'visible child'),
      reply(4, 1, '(deleted leaf)', '2026-08-03 13:30:00'),
    ],
    user: null,
  }))

  expect(html).toContain('id="post-2"')
  expect(html).toContain('(deleted post)')
  expect(html).toContain('post-3')
  expect(html).not.toContain('post-4')
  expect(html.match(/class="reply-branch/g)).toHaveLength(2)
})

test('Post threads show stored translations on replies', () => {
  const html = renderToStaticMarkup(React.createElement(ThreadReplies, {
    parentId: 1,
    replies: [{ id: 2, user_id: 1, parent_id: 1, body: 'Ελληνικό κείμενο', translation: 'Greek text', handle: 'author',
      created_at: '2026-08-03 12:00:00', deleted_at: null }],
    user: null,
  }))

  expect(html).toContain('<div class="post-body post-translation"><div class="post-quote">Greek text</div></div>')
})

test('conversation top links return to the deep reply and preserve its original back path', () => {
  expect(conversationTopPath(1, 3)).toBe('/post/1?from=%2Fpost%2F3%23post-3&reply_to=post#post-1')
  expect(conversationTopPath(1, 3, '/latest#post-3'))
    .toBe('/post/1?from=%2Fpost%2F3%3Ffrom%3D%252Flatest%2523post-3%23post-3&reply_to=post#post-1')
})

test('thread replies use their own permanent anchor as the next return path', () => {
  expect(replyAnchorReturnPath(2, 7)).toBe('/post/2#post-7')
  expect(replyAnchorReturnPath(2, 7, '/latest?cursor=abc#post-2'))
    .toBe('/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2#post-7')
})

test('a posted reply returns to its originating thread and preserves that thread back path', () => {
  const thread = '/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2#post-7'
  expect(postedReplyPath(7, 9, thread))
    .toBe('/post/2?from=%2Flatest%3Fcursor%3Dabc%23post-2&to=9&back=9#post-9')
  expect(postedReplyPath(7, 9, '/latest#post-7'))
    .toBe('/post/7?from=%2Flatest%23post-7&to=9&back=9#post-9')
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
        parent_id: null,
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
  expect(html).toContain(
    'class="parent-hit-area" href="/post/1?reply_to=post&amp;from=%2Flatest%3Fcursor%3Dabc%23post-2"',
  )
  expect(html).toContain('class="reference-menu-trigger postauthor" '
    + 'href="/u/parent?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).not.toContain('class="postdate" href="/post/1?from=%2Flatest%3Fcursor%3Dabc%23post-2"')
  expect(html).not.toContain('post-reply-link')
  expect(html).toContain(
    'href="/post/1?from=%2Flatest%3Fcursor%3Dabc%23post-2&amp;reply_to=post#post-1">top</a>',
  )
})

test('Nested feed posts link to the conversation top from the descendant metadata only', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 9, handle: 'reader', email: 'reader@example.com', bio: '' },
    tappable: true,
    returnPath: '/latest#post-3',
    p: {
      id: 3,
      user_id: 1,
      parent_id: 2,
      body: 'nested reply',
      handle: 'writer',
      created_at: '2026-08-03 13:00:00',
      deleted_at: null,
      parent: {
        id: 2,
        parent_id: 1,
        top_id: 1,
        body: 'quoted reply',
        handle: 'parent',
        created_at: '2026-08-03 12:00:00',
        deleted_at: null,
        reply_count: 0,
      },
    },
  }))

  expect(html).toContain('<div class="posttop posttop-context"><span class="reference-menu">')
  const top = 'href="/post/1?from=%2Flatest%23post-3&amp;reply_to=post#post-1">top</a>'
  expect(html).toContain(`${top}</div>`)
  expect(html.match(/>top<\/a>/g)).toHaveLength(1)
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
        parent_id: null,
        body: 'quoted note',
        handle: 'parent',
        created_at: '2026-08-03 11:00:00',
        deleted_at: null,
        reply_count: 1,
      },
    },
  }))

  expect(html).toContain('class="parent-hit-area" href="/post/1?reply_to=post"')
  expect(html).not.toContain('class="post-hit-area"')
})

test('Post detail places report in the footer', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' },
    p: { id: 2, user_id: 1, parent_id: null, body: 'note', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
    reportHref: '/post/2?report=1',
  }))

  const footer = html.slice(html.indexOf('<div class="postfoot">'), html.indexOf('</div></article>'))
  expect(footer).not.toContain('post-reply-link')
  expect(footer).toContain('class="quiet report-link" href="/post/2?report=1"')
  expect(html.slice(0, html.indexOf('<div class="postfoot">'))).not.toContain('class="quiet report-link"')
})

test('stored post translations render in the note', () => {
  expect(isProbablyNonEnglish('An English note with emoji 🎉 and numbers 123')).toBe(false)
  expect(isProbablyNonEnglish('One accent: café')).toBe(false)
  expect(isProbablyNonEnglish('Two accents: café señor')).toBe(false)
  expect(isProbablyNonEnglish('Three accents: café señor à Paris')).toBe(true)
  expect(isProbablyNonEnglish('Ελληνικό κείμενο')).toBe(true)

  const body = 'Información española: acción'
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' },
    p: { id: 2, user_id: 1, parent_id: null, body,
      translation: 'Spanish information: #action from @reader at example.com', handle: 'writer',
      mention_bios: { reader: '' }, created_at: '2026-08-03 12:00:00', deleted_at: null },
    highlightTerms: ['information'],
    reportHref: '/post/2?report=1',
  }))

  const translation = html.slice(html.indexOf('<div class="post-body post-translation">'),
    html.indexOf('<div class="postfoot">'))
  expect(translation).toContain('<div class="post-quote">Spanish <mark>information</mark>: ')
  expect(translation).toContain('href="/tag/action?from=')
  expect(translation).toContain('href="/u/reader?from=')
  expect(translation).toContain('href="https://example.com" class="raw-link"')
  expect(html).not.toContain('translate-link')
})

test('English posts do not offer translation', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 2, user_id: 1, parent_id: null, body: 'Just an English note 🎉', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null },
  }))

  expect(html).not.toContain('translate-link')
})

test('provider-positive posts render behind an accessible content warning', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 2, user_id: 1, parent_id: null, body: 'Sensitive note', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null, moderation_category: 'self-harm/intent',
      moderation_score: 0.72 },
  }))

  expect(html).toContain('class="content-warning-toggle"')
  expect(html).toContain('type="checkbox"')
  expect(html).toContain('class="content-warning-body"')
  expect(html).toContain('class="content-warning-mask" aria-hidden="true">░░░░░░░░░ ░░░░</div>')
  expect(html).toContain('class="content-warning-label">warning:</span> possible self-harm/intent content<br/>')
  expect(html).toContain('click to view anyway')
  expect(html.indexOf('content-warning-label')).toBeLessThan(html.indexOf('Sensitive note'))
})

test('moderated replies and quoted parents suppress consent screens only while replying', () => {
  const warning = { moderation_category: 'self-harm/intent', moderation_score: 0.72 }
  const reply = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 3, user_id: 2, parent_id: 1, body: 'Moderated reply', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null, ...warning },
  }))
  const quoted = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    p: { id: 4, user_id: 2, parent_id: 1, body: 'Ordinary reply', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null,
      parent: { id: 1, user_id: 1, parent_id: null, body: 'Moderated parent', handle: 'parent',
        created_at: '2026-08-03 11:00:00', deleted_at: null, reply_count: 1, ...warning } },
  }))

  const replying = renderToStaticMarkup(React.createElement(Post, {
    user: null,
    suppressContentWarning: true,
    p: { id: 4, user_id: 2, parent_id: 1, body: 'Ordinary reply', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null, ...warning,
      parent: { id: 1, user_id: 1, parent_id: null, body: 'Moderated parent', handle: 'parent',
        created_at: '2026-08-03 11:00:00', deleted_at: null, reply_count: 1, ...warning } },
  }))

  expect(reply).toContain('content-warning')
  expect(quoted).toContain('content-warning')
  expect(replying).toContain('Ordinary reply')
  expect(replying).toContain('Moderated parent')
  expect(replying).not.toContain('content-warning')
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
    showOwnerActions: true,
  }))
  const userDetailHtml = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 3, handle: 'reader', email: 'reader@example.com', bio: '' },
    p,
    showModerateAction: true,
  }))

  expect(adminFeedHtml).not.toContain('/admin/posts/2/delete')
  expect(adminDetailHtml).toContain('/admin/posts/2/delete')
  expect(adminDetailHtml).toContain('href="/admin/posts/2/translate?from=%2Fpost%2F2"')
  expect(adminDetailHtml).toContain('aria-label="translate this post with Google">translate</a>')
  expect(adminDetailHtml).toContain('href="/post/2/edit" aria-label="edit this post">edit</a>')
  expect(adminDetailHtml.indexOf('href="/post/2/edit"')).toBeLessThan(adminDetailHtml.indexOf('<div class="postfoot">'))
  expect(userDetailHtml).not.toContain('/admin/posts/2/delete')
  expect(userDetailHtml).not.toContain('/admin/posts/2/translate')
  expect(userDetailHtml).not.toContain('href="/post/2/edit"')
})

test('Post detail places moderate immediately before report for admins', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' },
    p: { id: 2, user_id: 2, parent_id: null, body: 'note', handle: 'writer', created_at: '2026-08-03 12:00:00',
      deleted_at: null },
    showModerateAction: true,
    reportHref: '/post/2?report=1',
  }))

  const footer = html.slice(html.indexOf('<div class="postfoot">'), html.indexOf('</div></article>'))
  expect(footer.indexOf('moderate')).toBeLessThan(footer.indexOf('report'))
  expect(html.slice(0, html.indexOf('<div class="postfoot">'))).not.toContain('moderate this post')
})

test('Post detail shows translation moderation for a reply opened as the primary post', () => {
  const html = renderToStaticMarkup(React.createElement(Post, {
    user: { id: 1, handle: 'admin', email: 'GSTAGAS@gmail.com', bio: '' },
    p: { id: 2716, user_id: 2, parent_id: 20, body: 'reply', handle: 'writer',
      created_at: '2026-08-03 12:00:00', deleted_at: null,
      parent: { id: 20, user_id: 3, parent_id: null, body: 'parent', handle: 'parent-author',
        created_at: '2026-08-03 11:00:00', deleted_at: null, reply_count: 1 } },
    showModerateAction: true,
  }))

  expect(html).toContain('href="/admin/posts/2716/translate?from=%2Fpost%2F2716"')
  expect(html.match(/\/admin\/posts\/2716\/translate/g)).toHaveLength(1)
  expect(html.indexOf('/admin/posts/2716/translate')).toBeGreaterThan(html.indexOf('class="parent-quote"'))
})
