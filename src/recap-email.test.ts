import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { recapEmail, recapEmailV2 } from './recap-email'

test('recap email renders the launch highlights as a standalone email document', () => {
  const database = new Database(':memory:')
  database.run('CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL)')
  database.run(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, body TEXT NOT NULL, deleted_at TEXT
  )`)
  const html = recapEmail(database, 'https://preview.textlog.test/recap-email', 'recipient-token')

  expect(html).toStartWith('<!doctype html>')
  expect(html).toContain('A lot has happened.<br>Quietly, of course.')
  expect(html).toContain('Write it your way')
  expect(html).toContain('Find your people')
  expect(html).toContain('Follow the conversation')
  expect(html).toContain('Make it feel like yours')
  expect(html).toContain('Stay close, anywhere')
  expect(html).toContain('Built to travel')
  expect(html).toContain('Textlog in your pocket')
  expect(html).toContain('href="https://github.com/Faultless/textlog_flutter"')
  expect(html).toContain('>A mobile app for Android phones</a>')
  expect(html).toContain('href="https://frontendienst.nl/"')
  expect(html).toContain('>Serge Kamel aka Faultless</a>')
  expect(html).toContain('/write"')
  expect(html).toContain('/search"')
  expect(html).toContain('/explore"')
  expect(html).toContain('/my-feed"')
  expect(html).toContain('/@"')
  expect(html).toContain('/account/edit/appearance"')
  expect(html).toContain('/account/edit/notifications"')
  expect(html).toContain('account/edit/notifications" style="color:#55734a')
  expect(html).toContain('>Notifications</a>')
  expect(html).toContain('/account/accounts"')
  expect(html).toContain('/account/security"')
  expect(html).toContain('/all.rss"')
  expect(html).toContain('/all.atom"')
  expect(html).toContain('/api/embed-examples"')
  expect(html).toContain('/api"')
  expect(html).toContain('>a documented API with write access</a>')
  expect(html).toContain('/dump.zip"')
  expect(html).toContain('/account/recap-emails/unsubscribe?token=recipient-token"')
  expect(html).toContain('>Unsubscribe from recap emails</a>')
  expect(html).toContain('/hot"')
  expect(html).not.toContain('Notes we kept thinking about')
})

test('v2 recap email renders the complete recap and popular conversations', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,handle TEXT NOT NULL,deleted_at TEXT,suspended_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
    created_at TEXT,deleted_at TEXT
  );
  CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
  INSERT INTO users VALUES(1,'writer',NULL,NULL);
  INSERT INTO posts VALUES(10,1,NULL,'A conversation starter','2026-01-01',NULL);
  INSERT INTO posts VALUES(11,1,10,'A reply','2026-01-02',NULL);`)

  const html = recapEmailV2(database, 'https://preview.textlog.test/recap-email-v2', 'recipient-token')

  expect(html).toStartWith('<!doctype html>')
  expect(html).toContain('More ways to connect.<br>Still quietly.')
  expect(html).toContain('What textlog has become')
  expect(html).toContain('Feeds with a point of view')
  expect(html).toContain('The conversations that grew')
  expect(html).toContain('@writer')
  expect(html).toContain('A reply')
  expect(html).not.toContain('recent replies')
  expect(html).toContain('/post/10')
  expect(html).toContain('/blog/recap-v2')
  expect(html).toContain('/account/recap-emails/unsubscribe?token=recipient-token')
})
