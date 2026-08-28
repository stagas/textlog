import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createPost, enrichPosts, isThreadLocked, loadThreadReplies, rewireVisibleAncestorGaps } from './posts'
import type { PostView } from './types'
import { displayPostBody, linkify } from './utils'

function database() {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, bio TEXT DEFAULT '', deleted_at TEXT,
      suspended_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, parent_id INTEGER,
      body TEXT NOT NULL, translation TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
      has_latex INTEGER,has_links INTEGER,has_code INTEGER);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL, tag TEXT NOT NULL CHECK(tag != 'fail'), PRIMARY KEY(post_id,tag));
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(post_id,user_id));
    CREATE TABLE for_you_reads (user_id INTEGER NOT NULL, event_key TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,event_key));
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE follows (follower_id INTEGER NOT NULL,following_id INTEGER NOT NULL,
      PRIMARY KEY(follower_id,following_id));
    CREATE TABLE hashtag_follows (user_id INTEGER NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(user_id,tag));
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(user_id,tag));
    CREATE TRIGGER reject_failed_tag BEFORE INSERT ON post_hashtags WHEN NEW.tag='fail'
      BEGIN SELECT RAISE(ABORT, 'metadata failure'); END;
    INSERT INTO users(id,handle) VALUES(1,'author'),(2,'reader');
  `)
  return db
}

describe('post persistence', () => {
  test('trims trailing whitespace when displaying post bodies', () => {
    expect(displayPostBody('first line\nsecond line  \n\n')).toBe('first line\nsecond line')
  })

  test('hides lines below a spoiler tag behind a reveal control', () => {
    expect(linkify('visible\n#spoiler\nhidden https://example.com'))
      .toBe('visible\n<a href="/tag/spoiler">#spoiler</a><span class="post-spoiler">'
        + '<label class="post-spoiler-summary"><input class="post-spoiler-input" type="checkbox">'
        + '<span>reveal</span></label><span class="post-spoiler-content">'
        + '<span class="post-spoiler-content-inner">hidden <a href="https://example.com" class="raw-link" '
        + 'title="https://example.com" target="_blank" rel="nofollow ugc noopener noreferrer">example.com</a>'
        + '</span></span></span>')
    expect(linkify('visible #spoilers\nstill visible')).not.toContain('class="post-spoiler"')
    expect(linkify('https://example.com/#spoiler\nstill visible')).not.toContain('class="post-spoiler"')
    expect(linkify('#SPOILER')).not.toContain('class="post-spoiler"')
  })

  test('adds escaped bios to linkified post mentions', () => {
    expect(linkify('hello @Reader', { reader: 'Builder & "tester"' }))
      .toContain('<a href="/u/reader" title="0 notes\n\nBuilder &amp; &quot;tester&quot;">@Reader</a>')
    expect(linkify('hello @Reader', { reader: '' }))
      .toContain('<a href="/u/reader" title="0 notes">@Reader</a>')
    expect(linkify('@Reader', { reader: 'Bio' }, [], undefined, undefined, '', {}, { reader: 1234 }))
      .toContain(`title="${(1234).toLocaleString()} notes\n\nBio"`)
    expect(linkify('@Reader', { reader: 'Bio  \n' }))
      .toContain('title="0 notes\n\nBio"')
  })
  test('does not linkify handles that were not found', () => {
    expect(linkify('hello @Missing and @Reader', { reader: '' }))
      .toBe('hello @Missing and <a href="/u/reader" title="0 notes">@Reader</a>')
  })
  test('keeps apostrophes in linkified URLs', () => {
    expect(linkify('read https://example.com/people/O\'Brien/profile'))
      .toBe(
        'read <a href="https://example.com/people/O&#39;Brien/profile" class="raw-link" title="https://example.com/people/O&#39;Brien/profile" target="_blank" rel="nofollow ugc noopener noreferrer">example.com<span class="raw-link-rest">/people/O&#39;Brien/profile</span></a>',
      )
  })
  test('hides protocols in raw links adjacent to reference punctuation', () => {
    for (const prefix of ['!', '#', '@']) {
      expect(linkify(`${prefix}https://example.com/path`))
        .toBe(`${prefix}<a href="https://example.com/path" class="raw-link" title="https://example.com/path" `
          + 'target="_blank" rel="nofollow ugc noopener noreferrer">example.com'
          + '<span class="raw-link-rest">/path</span></a>')
    }
  })
  test('shortens long URL labels without changing their destinations', () => {
    expect(linkify('https://www.example.com/a/very/long/path/final-part/?tracking=123'))
      .toBe(
        '<a href="https://www.example.com/a/very/long/path/final-part/?tracking=123" class="raw-link" title="https://www.example.com/a/very/long/path/final-part/?tracking=123" target="_blank" rel="nofollow ugc noopener noreferrer">www.example.com<span class="raw-link-rest">/…/final-part/</span></a>',
      )
    expect(linkify('https://example.com/short')).toContain('>example.com<span class="raw-link-rest">/short</span></a>')
    expect(linkify('https://example.com/short')).toContain('class="raw-link"')
    expect(linkify('example.com/short')).toContain('class="raw-link"')
    expect(linkify('[test](https://example.com/short)')).not.toContain('class="raw-link"')
    expect(linkify('https://example.com/archive/a-very-long-final-segment-with-important-ending/'))
      .toContain('>example.com<span class="raw-link-rest">/…/a-very-long-final-…with-important-ending/</span></a>')
    expect(linkify('https://example.com/archive/intro.section-containing-several-words.and-a-useful-ending/'))
      .toContain('>example.com<span class="raw-link-rest">/…/intro.section-containing-…and-a-useful-ending/</span></a>')
  })
  test('supports Markdown links', () => {
    expect(linkify('[test](https://example.com/)'))
      .toBe(
        '<a href="https://example.com/" title="https://example.com/" target="_blank" rel="nofollow ugc noopener noreferrer">test</a>',
      )
    expect(linkify('[test](example.com/docs)'))
      .toBe(
        '<a href="https://example.com/docs" title="https://example.com/docs" target="_blank" rel="nofollow ugc noopener noreferrer">test</a>',
      )
    expect(linkify('[test](example.invalid)')).toBe('[test](example.invalid)')
    expect(linkify('[Anthropic Risk August 2026 \\[pdf\\]](www-cdn.anthropic.com/reports/Risk%20Report.pdf)'))
      .toBe(
        '<a href="https://www-cdn.anthropic.com/reports/Risk%20Report.pdf" title="https://www-cdn.anthropic.com/reports/Risk%20Report.pdf" target="_blank" rel="nofollow ugc noopener noreferrer">Anthropic Risk August 2026 [pdf]</a>',
      )
    expect(linkify('![https://ibb.co/WpfV1DbH](https://ibb.co/WpfV1DbH)'))
      .toBe(
        '<a href="https://ibb.co/WpfV1DbH" title="https://ibb.co/WpfV1DbH" target="_blank" rel="nofollow ugc noopener noreferrer">https://ibb.co/WpfV1DbH</a>',
      )
  })
  test('renders Markdown strikethrough in posts', () => {
    expect(linkify('Keep ~~remove~~ revise')).toBe('Keep <del>remove</del> revise')
    expect(linkify('hey ~strike through~')).toBe('hey <del>strike through</del>')
    expect(linkify('Keep ~~remove~~ revise', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('Keep <del>remove</del> revise')
    expect(linkify('hey ~strike through~', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('hey <del>strike through</del>')
    expect(linkify('Keep \\~~literal~~')).toBe('Keep \\~~literal~~')
    expect(linkify('Keep \\~literal~')).toBe('Keep \\~literal~')
  })
  test('linkifies numerical ampersand post references without conflicting with strikethrough', () => {
    expect(linkify('see &123 and ~strike through~', {}, [], 'https://textlog.test')).toBe(
      'see <a href="/post/123">&amp;123</a> and <del>strike through</del>',
    )
    expect(linkify('see &123', {}, [], 'https://textlog.test', { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('see <a href="/post/123">&amp;123</a>')
    expect(linkify('escaped \\&123 and word&123 and old ~123', {}, [], 'https://textlog.test'))
      .toBe('escaped \\&amp;123 and word&amp;123 and old ~123')
  })
  test('renders single and double Markdown bold and underline markers in posts', () => {
    expect(linkify('*bold* and **also bold**')).toBe('<strong>bold</strong> and <strong>also bold</strong>')
    expect(linkify('_underlined_ and __also underlined__')).toBe('<u>underlined</u> and <u>also underlined</u>')
    expect(linkify('*bold* _underlined_', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('<strong>bold</strong> <u>underlined</u>')
    expect(linkify('\\*literal* and \\_literal_')).toBe('\\*literal* and \\_literal_')
  })
  test('renders consecutive greater-than lines as a quote while preserving inline formatting', () => {
    expect(linkify('before\n> quoted *bold*\n> with #notes\nafter')).toBe(
      'before<span class="post-quote">quoted <strong>bold</strong>\nwith '
        + '<a href="/tag/notes">#notes</a></span>after',
    )
  })
  test('renders slash-delimited italics in posts without affecting URLs', () => {
    expect(linkify('/italics/ and https://example.com/a/b'))
      .toBe(
        '<em>italics</em> and <a href="https://example.com/a/b" class="raw-link" title="https://example.com/a/b" target="_blank" rel="nofollow ugc noopener noreferrer">example.com<span class="raw-link-rest">/a/b</span></a>',
      )
    expect(linkify('/italics/', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('<em>italics</em>')
    expect(linkify('Keep \\/literal/')).toBe('Keep \\/literal/')
  })
  test('renders pipe-delimited redacted text for hover, focus, and mobile taps', () => {
    expect(linkify('The answer is |classified|.'))
      .toBe('The answer is <span class="redacted" tabindex="0">classified</span>.')
    expect(linkify('|hidden words|', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('<span class="redacted" tabindex="0">hidden words</span>')
    expect(linkify('Keep \\|literal|')).toBe('Keep \\|literal|')
    expect(linkify('Use `|literal|`')).toBe('Use <code>|literal|</code>')
  })
  test('keeps ASCII-art markup literal while linking tags and handles', () => {
    const body = '[eye](https://example.com) $x^2$ <nose> @Reader #ascii example.org/art'
    expect(linkify(body, { reader: 'Reader bio' })).toBe(
      '[eye](https://example.com) $x^2$ &lt;nose&gt; '
        + '<a href="/u/reader" title="0 notes\n\nReader bio">@Reader</a> <a href="/tag/ascii">#ascii</a> '
        + '<a href="https://example.org/art" class="raw-link" target="_blank" rel="nofollow ugc noopener noreferrer">'
        + 'example.org<span class="raw-link-rest">/art</span></a>',
    )
  })
  test('linkifies protocol-less domains using the public TLD list', () => {
    expect(linkify('visit example.com or docs.example.dev/guide?q=links.'))
      .toBe(
        'visit <a href="https://example.com" class="raw-link" target="_blank" rel="nofollow ugc noopener noreferrer">example.com</a> or <a href="https://docs.example.dev/guide?q=links" class="raw-link" target="_blank" rel="nofollow ugc noopener noreferrer">docs.example.dev<span class="raw-link-rest">/guide?q=links</span></a>.',
      )
    expect(linkify('not links: version 1.2.3, example.invalid, or a@example.com'))
      .toBe('not links: version 1.2.3, example.invalid, or a@example.com')
  })
  test('does not treat references inside protocol-less URLs as mentions or tags', () => {
    expect(linkify('example.com/@reader#notes', { reader: 'Reader' }))
      .toBe(
        '<a href="https://example.com/@reader#notes" class="raw-link" target="_blank" rel="nofollow ugc noopener noreferrer">example.com<span class="raw-link-rest">/@reader#notes</span></a>',
      )
  })
  test('opens links starting with APP_URL in the current tab', () => {
    expect(linkify('https://textlog.cc', {}, [], 'https://textlog.cc'))
      .toBe(
        '<a href="https://textlog.cc" class="raw-link" title="https://textlog.cc" rel="nofollow ugc">textlog.cc</a>',
      )
    expect(linkify('https://textlog.cc/', {}, [], 'https://textlog.cc'))
      .toBe(
        '<a href="https://textlog.cc/" class="raw-link" title="https://textlog.cc/" rel="nofollow ugc">textlog.cc</a>',
      )
    expect(linkify('https://textlog.test/post/1', {}, [], 'https://textlog.test'))
      .toBe(
        '<a href="https://textlog.test/post/1" class="raw-link" title="https://textlog.test/post/1" rel="nofollow ugc"><span class="raw-link-rest">/post/1</span></a>',
      )
    expect(linkify('[post](https://textlog.test/post/1)', {}, [], 'https://textlog.test'))
      .toBe('<a href="https://textlog.test/post/1" title="https://textlog.test/post/1" rel="nofollow ugc">post</a>')
    expect(linkify('textlog.cc/post/1', {}, [], 'https://textlog.cc'))
      .toBe(
        '<a href="https://textlog.cc/post/1" class="raw-link" title="https://textlog.cc/post/1" rel="nofollow ugc"><span class="raw-link-rest">/post/1</span></a>',
      )
  })
  test('normalizes literal APP_URL links when APP_URL has a trailing slash', () => {
    expect(linkify('https://textlog.test/', {}, [], 'https://textlog.test/'))
      .toBe(
        '<a href="https://textlog.test/" class="raw-link" title="https://textlog.test/" rel="nofollow ugc">textlog.test</a>',
      )
    expect(linkify('https://textlog.test/post/1', {}, [], 'https://textlog.test/'))
      .toBe(
        '<a href="https://textlog.test/post/1" class="raw-link" title="https://textlog.test/post/1" rel="nofollow ugc"><span class="raw-link-rest">/post/1</span></a>',
      )
  })
  test('escapes Markdown link labels and destinations', () => {
    expect(linkify('[<test>](https://example.com/a\'b)'))
      .toBe(
        '<a href="https://example.com/a&#39;b" title="https://example.com/a&#39;b" target="_blank" rel="nofollow ugc noopener noreferrer">&lt;test&gt;</a>',
      )
  })

  test('renders inline code without linkifying its contents', () => {
    expect(linkify('run `curl https://example.com/@reader` now'))
      .toBe('run <code>curl https://example.com/@reader</code> now')
  })

  test('uses persisted flags while preserving plain-text escaping', () => {
    expect(linkify('plain <text>', {}, [], undefined, { has_latex: 0, has_links: 0, has_code: 0 }))
      .toBe('plain &lt;text&gt;')
    expect(linkify('visit example.com', {}, [], undefined, { has_latex: 0, has_links: 1, has_code: 0 }))
      .toContain('href="https://example.com"')
  })

  test('wraps emoji without changing the surrounding text font', () => {
    expect(linkify('fast ⚡ launch 👩🏽‍💻')).toBe(
      'fast <span class="emoji">⚡</span> launch <span class="emoji">👩🏽‍💻</span>',
    )
  })

  test('renders fenced code without linkifying its contents', () => {
    expect(linkify('before\n```ts\nconst tag = "#notes"\n```\nafter'))
      .toBe('before\n<code class="code-fence">const tag = &quot;#notes&quot;</code>\nafter')
    expect(linkify('```text\n> quoted-looking code\n```'))
      .toBe('<code class="code-fence">&gt; quoted-looking code</code>')
  })

  test('syntax highlights JavaScript and Python fences only', () => {
    const javascript = linkify('```js\nconst answer = 42\n```')
    expect(javascript).toContain('<code class="code-fence hljs language-javascript">')
    expect(javascript).toContain('<span class="hljs-keyword">const</span>')
    expect(javascript).toContain('<span class="hljs-number">42</span>')

    const python = linkify('```python\ndef answer():\n    return 42\n```')
    expect(python).toContain('<code class="code-fence hljs language-python">')
    expect(python).toContain('<span class="hljs-keyword">def</span>')
    expect(python).toContain('<span class="hljs-keyword">return</span>')

    expect(linkify('```ts\nconst answer = 42\n```'))
      .toBe('<code class="code-fence">const answer = 42</code>')
  })

  test('renders inline TeX as native MathML', () => {
    const html = linkify('Energy: $E = mc^2$.')
    expect(html).toStartWith('Energy: <math xmlns="http://www.w3.org/1998/Math/MathML">')
    expect(html).toContain('<msup>')
    expect(html).toEndWith('</math>.')
  })

  test('renders display TeX as native block MathML', () => {
    const html = linkify('$$\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$')
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">')
    expect(html).toContain('<mfrac>')
    expect(html).toContain('<msqrt>')
  })

  test('renders fenced LaTeX and TeX blocks as display MathML', () => {
    for (const language of ['latex', 'tex']) {
      const html = linkify(`\`\`\`${language}\n\\frac{1}{2}\n\`\`\``)
      expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">')
      expect(html).toContain('<mfrac>')
    }
  })

  test('falls back to a code block for malformed fenced LaTeX', () => {
    expect(linkify('```latex\n\\frac{\n```')).toBe('<code class="code-fence">\\frac{</code>')
  })

  test('does not interpret dollar amounts as math', () => {
    expect(linkify('It costs $20, or $30 tomorrow.')).toBe('It costs $20, or $30 tomorrow.')
  })

  test('turns escaped math delimiters into literal dollars', () => {
    expect(linkify('Pay \\$20; write \\$x\\$ literally.')).toBe('Pay $20; write $x$ literally.')
  })

  test('renders multiple equations independently', () => {
    const html = linkify('$x^2$ plus $y^2$')
    expect(html.match(/<math\b/g)).toHaveLength(2)
  })

  test('ignores math delimiters in code spans and blocks', () => {
    expect(linkify('`$x$`\n```js\n$$y$$\n```'))
      .toBe('<code>$x$</code>\n<code class="code-fence hljs language-javascript">$$y$$</code>')
  })

  test('falls back to escaped source for malformed TeX', () => {
    expect(linkify('bad $\\frac{$ source')).toBe('bad $\\frac{$ source')
  })

  test('does not allow TeX or fallback text to inject HTML', () => {
    const html = linkify('$\\text{</math><script>alert(1)</script>}$ <img src=x>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;')
  })

  test('highlights search terms without breaking escaping or links', () => {
    expect(linkify('Search <notes> at #Searchable', {}, ['sear']))
      .toBe('<mark>Sear</mark>ch &lt;notes&gt; at <a href="/tag/searchable">#<mark>Sear</mark>chable</a>')
  })

  test('linkifies Unicode hashtags with an encoded normalized URL', () => {
    const html = linkify('Tags #Ελλάδα and #cafe\u0301')
    expect(html).toContain('<a href="/tag/%CE%B5%CE%BB%CE%BB%CE%AC%CE%B4%CE%B1">#Ελλάδα</a>')
    expect(html).toContain('<a href="/tag/caf%C3%A9">#café</a>')
  })

  test('links hashtags without exposing note counts in titles', () => {
    expect(linkify('#Topic #empty', {}, [], undefined, undefined, '', { topic: 1, empty: 0 }))
      .toBe('<a href="/tag/topic">#Topic</a> <a href="/tag/empty">#empty</a>')
  })

  test('renders hover popovers with bios and standard follow buttons', () => {
    const html = linkify('@Reader #Topic', { reader: 'Builds things' }, [], undefined, undefined, '', { topic: 20 }, {
      reader: 20,
    }, { signedIn: true, currentHandle: 'author', formPrefix: 'post-1', mentionFollowing: { reader: true },
      mentionFollowsViewer: { reader: true }, hashtagFollowing: { topic: false }, hashtagFollowerCounts: { topic: 8 },
      mentionProfileStats: {
        reader: { notes: 20, replies: 34, followers: 8, following: 5, followingTags: 2 },
      } })
    expect(html).toContain('<span class="reference-menu-popover">'
      + '<span class="reference-popover-bio">Builds things</span>')
    expect(html).not.toContain('reference-profile-tabs')
    expect(html).toContain('<button class="button button-muted" type="submit" '
      + 'form="post-1-user-reader">unfollow</button>')
    expect(html).toContain('<span class="follows-you">follows you</span>')
    expect(html).toContain('<button class="quiet danger" type="submit" '
      + 'form="post-1-user-reader-block">block</button>')
    expect(html).toContain('<span class="reference-menu-popover reference-menu-popover-tag">'
      + '<span class="reference-popover-actions">')
    expect(html).toContain('<button class="button" type="submit" form="post-1-tag-topic">follow</button>')
    expect(html).toContain('<button class="quiet danger" type="submit" '
      + 'form="post-1-tag-topic-block">block</button>')
  })

  test('omits the bio row from hover popovers when the bio is blank', () => {
    const html = linkify('@Reader', { reader: '  \n' }, [], undefined, undefined, '', {}, { reader: 2 }, {
      signedIn: false,
      formPrefix: 'post-1',
    })
    expect(html).toContain('<span class="reference-menu-popover">')
    expect(html).not.toContain('reference-popover-bio')
    expect(html).not.toContain('No bio yet.')
  })

  test('renders a muted empty bio without a divider in the current user hover popover', () => {
    const html = linkify('@Reader', { reader: '' }, [], undefined, undefined, '', {}, { reader: 2 }, {
      signedIn: true,
      currentHandle: 'reader',
      formPrefix: 'post-1',
    })
    expect(html).toContain('<span class="reference-popover-bio reference-popover-bio-own bio-empty">No bio yet</span>')
    expect(html).not.toContain('reference-popover-actions')
  })

  test('keeps handles flat while allowing tag and link popovers inside a bio popover', () => {
    const url = 'https://example.com/about'
    const html = linkify(`Talks with @friend about #Topic at ${url}`, { friend: 'Nested bio' }, [], undefined,
      undefined, '', { topic: 3 }, { friend: 2 }, {
      signedIn: false,
      formPrefix: 'handle-writer-bio',
      hashtagFollowerCounts: { topic: 1 },
      linkPreviews: { [url]: { imageUrl: 'https://cdn.example.com/about.jpg', title: 'About' } },
      mentionPopovers: false,
    })
    expect(html).toContain('<a href="/u/friend">@friend</a>')
    expect(html).toContain('<span class="reference-menu-popover reference-menu-popover-tag">')
    expect(html).toContain('class="remote-link-popover"')
    expect(html.match(/reference-popover-bio/g)).toBeNull()
  })

  test('stops handle popover nesting after the nested handle bio', () => {
    const html = linkify('@friend', {
      friend: 'Knows @third and follows #topic at example.com',
    }, [], undefined, undefined, '', {}, { friend: 2 }, {
      signedIn: false,
      formPrefix: 'handle-writer-bio',
      mentionProfileStats: {
        friend: { notes: 2, replies: 1, followers: 1, following: 1, followingTags: 1 },
      },
    })
    expect(html.match(/class="reference-menu"/g)).toHaveLength(1)
    expect(html).toContain('<span class="reference-popover-bio">Knows @third and follows '
      + '<a href="/tag/topic">#topic</a> at ')
    expect(html).toContain('<a href="https://example.com" class="raw-link" target="_blank" '
      + 'rel="nofollow ugc noopener noreferrer">example.com</a>')
  })

  test('renders a stored remote link image as a hover-only CSS variable', () => {
    const html = linkify('read https://example.com/story', {}, [], undefined, undefined, '', {}, {}, {
      signedIn: false,
      formPrefix: 'post-1',
      linkPreviews: {
        'https://example.com/story': { imageUrl: 'https://cdn.example.com/card.jpg?x=1&y=2', title: 'A useful story',
          description: 'The story description', siteName: 'Example', imageWidth: 1200, imageHeight: 630 },
      },
    })
    expect(html).toContain('class="remote-link-menu"')
    expect(html).toContain('class="remote-link-popover" href="https://example.com/story"')
    expect(html).toContain('--preview-image:url(&quot;https://cdn.example.com/card.jpg?x=1&amp;y=2&quot;)')
    expect(html).toContain('--preview-ratio:1.9047619047619047')
    expect(html).toContain('--preview-width:380.95238095238096px')
    expect(html).toContain('class="remote-link-image remote-link-image-sized"')
    expect(html).toContain('<span class="remote-link-site">Example</span>')
    expect(html).toContain('<strong class="remote-link-title">A useful story</strong>')
    expect(html).toContain('<span class="remote-link-description">The story description</span>')
    expect(html).not.toContain('background-image')
  })

  test('does not enlarge a link preview image shorter than the hover card maximum', () => {
    const url = 'https://example.com/small-image'
    const html = linkify(url, {}, [], undefined, undefined, '', {}, {}, {
      signedIn: false,
      formPrefix: 'post-1',
      linkPreviews: {
        [url]: { imageUrl: 'https://cdn.example.com/small.jpg', imageWidth: 120, imageHeight: 60 },
      },
    })
    expect(html).toContain('--preview-ratio:2;--preview-width:120px')
  })

  test('renders audio link previews without preloading media', () => {
    const url = 'https://example.com/episode.mp3'
    const html = linkify(url, {}, [], undefined, undefined, '', {}, {}, {
      signedIn: false,
      formPrefix: 'post-1',
      linkPreviews: { [url]: { imageUrl: url, mimeType: 'audio/mpeg' } },
    })
    expect(html).toContain('class="remote-link-popover remote-link-audio-popover"')
    expect(html).toContain(`<audio controls preload="none" src="${url}"></audio>`)
    expect(html).not.toContain('--preview-image')
  })

  test('renders Vocaroo links as direct MP3 audio previews', () => {
    const url = 'https://voca.ro/140JOkFnkmRv'
    const html = linkify(`[recording](${url})`, {}, [], undefined, undefined, '', {}, {}, {
      signedIn: false,
      formPrefix: 'post-1',
    })
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('class="remote-link-popover remote-link-audio-popover"')
    expect(html).toContain('<audio controls preload="none" src="/media/vocaroo/140JOkFnkmRv"></audio>')
  })

  test('opens local link previews in the current tab like their post links', () => {
    const url = 'https://textlog.test/post/1'
    const html = linkify(url, {}, [], 'https://textlog.test', undefined, '', {}, {}, {
      signedIn: false,
      formPrefix: 'post-1',
      linkPreviews: { [url]: { imageUrl: 'https://textlog.test/post/1/og.png', title: 'A local note' } },
    })
    expect(html).toContain(`class="remote-link-popover" href="${url}" rel="nofollow ugc"`)
    expect(html).not.toMatch(/class="remote-link-popover"[^>]+target="_blank"/)
  })

  test('inserts server-rendered posts into local hover cards', () => {
    const url = 'https://textlog.test/post/12'
    const html = linkify(url, {}, [], 'https://textlog.test', undefined, '', {}, {}, {
      signedIn: true,
      currentHandle: 'writer',
      formPrefix: 'post-1',
      linkPreviews: {
        [url]: { imageUrl: url,
          renderedPostHtml: '<article class="post internal-post-card tappable-post">rendered post</article>' },
      },
    })
    expect(html).toContain('class="remote-link-popover internal-post-popover"')
    expect(html).toContain('<article class="post internal-post-card tappable-post">rendered post</article>')
    expect(html).not.toContain('--preview-image')
  })

  test('uses internal post hover cards for numerical ampersand references', () => {
    const url = 'https://textlog.test/post/12'
    const html = linkify('see &12', {}, [], 'https://textlog.test', undefined, '', {}, {}, {
      signedIn: true,
      formPrefix: 'post-1',
      linkPreviews: {
        [url]: { imageUrl: url, renderedPostHtml: '<article class="post">referenced post</article>',
          linkedPostReturnPath: '/post/1#post-1' },
      },
    })
    expect(html).toContain('class="remote-link-menu internal-post-link-menu"')
    expect(html).toContain('href="https://textlog.test/post/12?from=%2Fpost%2F1%23post-1"')
    expect(html).toContain('<article class="post">referenced post</article>')
  })

  test('trims trailing whitespace from bios in user popovers', () => {
    const html = linkify('@reader', { reader: 'Builds things  \n' }, [], undefined, undefined, '', {}, { reader: 1 }, {
      signedIn: false,
      formPrefix: 'post-1',
    })
    expect(html).toContain('<span class="reference-popover-bio">Builds things</span>')
  })

  test('linkifies bios inside user popovers', () => {
    const html = linkify('@Reader', { reader: 'Writes about #TypeScript\n\nat example.com' }, [], undefined, undefined,
      '', {}, { reader: 2 }, { signedIn: false, formPrefix: 'post-1' })
    expect(html).toContain('<span class="reference-popover-bio">Writes about '
      + '<a href="/tag/typescript">#TypeScript</a>\n\nat '
      + '<a href="https://example.com" class="raw-link" target="_blank" rel="nofollow ugc noopener noreferrer">example.com</a></span>')
  })

  test('linkifies only the first ten hashtags', () => {
    const html = linkify('#one #two #three #four #five #six #seven #eight #nine #ten #eleven')
    expect(html.match(/href="\/tag\//g)).toHaveLength(10)
    expect(html).toContain('</a> #eleven')
  })

  test('writes content and metadata atomically', () => {
    const db = database()
    expect(() => createPost(db, 1, 'rollback #fail @reader')).toThrow()
    expect(db.query('SELECT count(*) count FROM posts').get()).toEqual({ count: 0 })

    const result = createPost(db, 1, 'hello #build @reader')
    expect(result).toHaveProperty('id')
    expect(db.query('SELECT tag FROM post_hashtags').all()).toEqual([{ tag: 'build' }])
    expect(db.query('SELECT user_id FROM post_mentions').all()).toEqual([{ user_id: 2 }])
    expect(db.query('SELECT user_id,event_key FROM for_you_reads').all()).toEqual([
      { user_id: 1, event_key: 'post:00000000000000000001' },
    ])
  })

  test('resolves mentions made with a previous handle', () => {
    const db = database()
    db.run('INSERT INTO handle_history(handle,user_id) VALUES(\'old_reader\',2)')

    createPost(db, 1, 'hello @old_reader')

    expect(db.query('SELECT user_id FROM post_mentions').all()).toEqual([{ user_id: 2 }])
  })

  test('preloads visible reply counts and parent summaries', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'parent','2026-08-03 10:00:00'),
      (2,2,1,'visible','2026-08-03 11:00:00'),
      (3,2,1,'deleted','2026-08-03 12:00:00');
      UPDATE posts SET deleted_at='2026-08-03 12:30:00' WHERE id=3;`)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    const [view] = enrichPosts(db, [child])
    expect(view.parent?.reply_count).toBe(1)
    expect(view.parent?.body).toBe('parent')
  })

  test('rewires a feed reply across an unavailable parent to its nearest visible ancestor', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body) VALUES
      (494,1,NULL,'root'),(496,1,494,'visible ancestor'),(2516,1,496,'hidden parent'),
      (2582,2,2516,'visible reply')`)
    const visible = [
      { id: 2582, user_id: 2, parent_id: 2516, body: 'visible reply', handle: 'reader',
        created_at: '2026-08-26 18:34:27', deleted_at: null, parent: null },
      { id: 496, user_id: 1, parent_id: 494, body: 'visible ancestor', handle: 'author',
        created_at: '2026-08-08 14:25:42', deleted_at: null },
      { id: 494, user_id: 1, parent_id: null, body: 'root', handle: 'author',
        created_at: '2026-08-08 14:20:43', deleted_at: null },
    ] as PostView[]

    expect(rewireVisibleAncestorGaps(db, visible)[0]).toMatchObject({
      id: 2582,
      parent_id: 496,
    })
    expect(rewireVisibleAncestorGaps(db, visible)[0].feed_ancestor_gap).toBeUndefined()
  })

  test('loads stored translations for replies in a post thread', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,translation) VALUES
      (1,1,NULL,'root',NULL),(2,2,1,'Ελληνικό κείμενο','Greek text')`)

    expect(loadThreadReplies(db, 1)[0]).toMatchObject({
      id: 2,
      body: 'Ελληνικό κείμενο',
      translation: 'Greek text',
    })
  })

  test('enriches mentions and hashtags that appear only in a translation', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,body,translation) VALUES
      (1,1,'original','Translated for @reader with #topic')`)
    const post = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView

    expect(enrichPosts(db, [post])[0]).toMatchObject({
      mention_bios: { reader: '' },
      mention_note_counts: { reader: 0 },
      hashtag_counts: { topic: 0 },
    })
  })

  test('locks a note and all of its descendants when an ancestor has #lock', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body) VALUES
      (1,1,NULL,'root #lock'),(2,2,1,'child'),(3,1,2,'grandchild'),(4,2,NULL,'open');
      INSERT INTO post_hashtags(post_id,tag) VALUES(1,'lock');`)
    const posts = db.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.id IN (1,2,3,4) ORDER BY p.id`).all() as PostView[]

    expect(enrichPosts(db, posts).map(post => !!post.thread_locked)).toEqual([true, true, true, false])
    expect(enrichPosts(db, [posts[2]])[0].parent?.thread_locked).toBe(true)
    expect(isThreadLocked(db, 3)).toBe(true)
    expect(isThreadLocked(db, 4)).toBe(false)
  })

  test('classifies replies and mentions addressed to the viewer', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,2,NULL,'viewer note','2026-08-03 10:00:00'),
      (2,1,1,'reply mentioning @reader','2026-08-03 11:00:00'),
      (3,1,NULL,'mentioning @reader','2026-08-03 12:00:00'),
      (4,1,NULL,'ordinary note','2026-08-03 13:00:00');
      INSERT INTO post_mentions VALUES(2,2),(3,2);`)
    const posts = db.query(
      'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (2,3,4) ORDER BY p.id',
    ).all() as PostView[]

    expect(enrichPosts(db, posts, 2).map(post => post.viewer_context))
      .toEqual(['reply', 'mention', undefined])
  })

  test('counts the full visible descendant tree as replies', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'root','2026-08-03 10:00:00'),
      (2,2,1,'child','2026-08-03 11:00:00'),
      (3,1,2,'grandchild','2026-08-03 12:00:00'),
      (4,2,3,'deleted descendant','2026-08-03 13:00:00'),
      (5,1,4,'visible below tombstone','2026-08-03 14:00:00');
      UPDATE posts SET deleted_at='2026-08-03 13:30:00' WHERE id=4;`)
    const posts = db.query(
      'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (1,2,3) ORDER BY p.id',
    )
      .all() as PostView[]
    const [root, child, grandchild] = enrichPosts(db, posts)

    expect(root.reply_count).toBe(3)
    expect(child.reply_count).toBe(2)
    expect(child.parent?.reply_count).toBe(3)
    expect(grandchild.parent).toMatchObject({ id: 2, parent_id: 1, top_id: 1 })
  })

  test('excludes blocked replies and parent summaries for the viewer', () => {
    const db = database()
    db.run(`INSERT INTO users(id,handle) VALUES(3,'blocked');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'parent','2026-08-03 10:00:00'),
        (2,2,1,'visible reply','2026-08-03 11:00:00'),
        (3,3,1,'blocked reply','2026-08-03 12:00:00');
      INSERT INTO blocks VALUES(2,3);`)
    const parentPost = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView
    expect(enrichPosts(db, [parentPost], 2)[0].reply_count).toBe(1)

    db.query('INSERT INTO blocks VALUES(?,?)').run(2, 1)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    expect(enrichPosts(db, [child], 2)[0].parent).toBeNull()
  })

  test('excludes a blocker reply and every reply beneath it from threads', () => {
    const db = database()
    db.run(`INSERT INTO users(id,handle) VALUES(3,'blocker'),(4,'descendant');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'parent','2026-08-03 10:00:00'),
        (2,3,1,'blocker reply','2026-08-03 11:00:00'),
        (3,4,2,'reply to blocker','2026-08-03 12:00:00'),
        (4,4,1,'visible sibling','2026-08-03 13:00:00');
      INSERT INTO blocks VALUES(3,2);`)

    expect(loadThreadReplies(db, 1, 2).map(post => post.id)).toEqual([4])
  })

  test('shows blocker replies to moderators and marks who blocked them', () => {
    const db = database()
    db.run(`ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
      UPDATE users SET email='gstagas@gmail.com' WHERE id=2;
      INSERT INTO users(id,handle,email) VALUES(3,'blocker','blocker@example.com');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (1,1,NULL,'parent','2026-08-03 10:00:00'),
        (2,3,1,'blocker reply','2026-08-03 11:00:00');
      INSERT INTO blocks VALUES(3,2);`)

    const replies = loadThreadReplies(db, 1, 2)
    expect(replies.map(post => post.id)).toEqual([2])
    expect(replies[0].blocked_viewer).toBeTrue()
  })

  test('excludes replies and parent summaries carrying a blocked hashtag', () => {
    const db = database()
    db.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'parent #spoilers','2026-08-03 10:00:00'),
      (2,2,1,'visible reply','2026-08-03 11:00:00'),
      (3,1,1,'hidden reply #spoilers','2026-08-03 12:00:00');
      INSERT INTO post_hashtags VALUES(1,'spoilers'),(3,'spoilers');
      INSERT INTO blocked_hashtags VALUES(2,'spoilers');`)
    const parentPost = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView
    expect(enrichPosts(db, [parentPost], 2)[0].reply_count).toBe(1)
    const child = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=2')
      .get() as PostView
    expect(enrichPosts(db, [child], 2)[0].parent).toBeNull()
  })

  test('counts public hashtag notes visible through viewer blocks', () => {
    const db = database()
    db.run(`INSERT INTO users(id,handle) VALUES(3,'blocked');
      INSERT INTO posts(id,user_id,body,created_at) VALUES
        (1,1,'visible #topic','2026-08-03 10:00:00'),
        (2,3,'blocked author #topic','2026-08-03 11:00:00'),
        (3,1,'blocked tag #topic #spoilers','2026-08-03 12:00:00'),
        (4,1,'deleted #topic','2026-08-03 13:00:00');
      UPDATE posts SET deleted_at='2026-08-03 14:00:00' WHERE id=4;
      INSERT INTO post_hashtags VALUES(1,'topic'),(2,'topic'),(3,'topic'),(3,'spoilers'),(4,'topic');
      INSERT INTO blocks VALUES(2,3);
      INSERT INTO blocked_hashtags VALUES(2,'spoilers');
      INSERT INTO follows VALUES(2,1);
      INSERT INTO hashtag_follows VALUES(2,'topic');`)
    const post = db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=1')
      .get() as PostView

    expect(enrichPosts(db, [post])[0]).toMatchObject({ hashtag_counts: { topic: 3 }, note_count: 2 })
    expect(enrichPosts(db, [post], 2)[0]).toMatchObject({ hashtag_counts: { topic: 1 }, note_count: 2,
      viewer_following: true, hashtag_following: { topic: true } })
  })
})
