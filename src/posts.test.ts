import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createPost, enrichPosts } from './posts'
import type { PostView } from './types'
import { linkify } from './utils'

function database() {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, bio TEXT DEFAULT '', deleted_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, parent_id INTEGER,
      body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
      has_latex INTEGER,has_links INTEGER,has_code INTEGER);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL, tag TEXT NOT NULL CHECK(tag != 'fail'), PRIMARY KEY(post_id,tag));
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(post_id,user_id));
    CREATE TABLE for_you_reads (user_id INTEGER NOT NULL, event_key TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,event_key));
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(user_id,tag));
    CREATE TRIGGER reject_failed_tag BEFORE INSERT ON post_hashtags WHEN NEW.tag='fail'
      BEGIN SELECT RAISE(ABORT, 'metadata failure'); END;
    INSERT INTO users(id,handle) VALUES(1,'author'),(2,'reader');
  `)
  return db
}

describe('post persistence', () => {
  test('adds escaped bios to linkified post mentions', () => {
    expect(linkify('hello @Reader', { reader: 'Builder & "tester"' }))
      .toContain('<a href="/u/reader" title="Builder &amp; &quot;tester&quot;">@Reader</a>')
    expect(linkify('hello @Reader', { reader: '' }))
      .toContain('<a href="/u/reader" title="No bio yet.">@Reader</a>')
  })
  test('keeps apostrophes in linkified URLs', () => {
    expect(linkify('read https://example.com/people/O\'Brien/profile'))
      .toBe(
        'read <a href="https://example.com/people/O&#39;Brien/profile" target="_blank" rel="nofollow ugc noopener noreferrer">https://example.com/people/O&#39;Brien/profile</a>',
      )
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
  })
  test('linkifies protocol-less domains using the public TLD list', () => {
    expect(linkify('visit example.com or docs.example.dev/guide?q=links.'))
      .toBe(
        'visit <a href="https://example.com" target="_blank" rel="nofollow ugc noopener noreferrer">example.com</a> or <a href="https://docs.example.dev/guide?q=links" target="_blank" rel="nofollow ugc noopener noreferrer">docs.example.dev/guide?q=links</a>.',
      )
    expect(linkify('not links: version 1.2.3, example.invalid, or a@example.com'))
      .toBe('not links: version 1.2.3, example.invalid, or a@example.com')
  })
  test('does not treat references inside protocol-less URLs as mentions or tags', () => {
    expect(linkify('example.com/@reader#notes', { reader: 'Reader' }))
      .toBe(
        '<a href="https://example.com/@reader#notes" target="_blank" rel="nofollow ugc noopener noreferrer">example.com/@reader#notes</a>',
      )
  })
  test('opens links starting with APP_URL in the current tab', () => {
    expect(linkify('https://textlog.test/post/1', {}, [], 'https://textlog.test'))
      .toBe('<a href="https://textlog.test/post/1" title="https://textlog.test/post/1" rel="nofollow ugc">/post/1</a>')
    expect(linkify('[post](https://textlog.test/post/1)', {}, [], 'https://textlog.test'))
      .toBe('<a href="https://textlog.test/post/1" title="https://textlog.test/post/1" rel="nofollow ugc">post</a>')
    expect(linkify('textlog.cc/post/1', {}, [], 'https://textlog.cc'))
      .toBe('<a href="https://textlog.cc/post/1" title="https://textlog.cc/post/1" rel="nofollow ugc">/post/1</a>')
  })
  test('normalizes literal APP_URL links when APP_URL has a trailing slash', () => {
    expect(linkify('https://textlog.test/post/1', {}, [], 'https://textlog.test/'))
      .toBe('<a href="https://textlog.test/post/1" title="https://textlog.test/post/1" rel="nofollow ugc">/post/1</a>')
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

  test('renders fenced code without linkifying its contents', () => {
    expect(linkify('before\n```ts\nconst tag = "#notes"\n```\nafter'))
      .toBe('before\n<code class="code-fence">const tag = &quot;#notes&quot;</code>\nafter')
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
      .toBe('<code>$x$</code>\n<code class="code-fence">$$y$$</code>')
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
      'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (1,2) ORDER BY p.id',
    )
      .all() as PostView[]
    const [root, child] = enrichPosts(db, posts)

    expect(root.reply_count).toBe(3)
    expect(child.reply_count).toBe(2)
    expect(child.parent?.reply_count).toBe(3)
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
})
