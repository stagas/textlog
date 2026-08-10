import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicArchive } from './public-archive'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('public archive', () => {
  test('paginates public data and excludes private and unavailable data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'textlog-public-archive-'))
    directories.push(directory)
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT,password TEXT,
        created_at TEXT,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER,body TEXT,created_at TEXT,deleted_at TEXT);
      CREATE TABLE follows(follower_id INTEGER,following_id INTEGER,created_at TEXT);
      CREATE TABLE hashtag_follows(user_id INTEGER,tag TEXT);
      CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
      CREATE TABLE post_mentions(post_id INTEGER,user_id INTEGER);
      CREATE TABLE blocks(blocker_id INTEGER,blocked_id INTEGER);
      INSERT INTO users VALUES
        (1,'alice','alice@private.test','hello','secret-hash','2026-01-01',NULL,NULL),
        (2,'bob','bob@private.test','','other-secret','2026-01-02',NULL,NULL),
        (3,'gone','gone@private.test','','gone-secret','2026-01-03','2026-02-01',NULL),
        (4,'banned','banned@private.test','','ban-secret','2026-01-04',NULL,'2026-02-01');
      INSERT INTO posts VALUES
        (10,1,NULL,'first','2026-01-01',NULL),(11,2,10,'reply','2026-01-02',NULL),
        (12,3,NULL,'deleted account content','2026-01-03',NULL),(13,1,NULL,'deleted post','2026-01-04','2026-02-01');
      INSERT INTO follows VALUES(1,2,'2026-01-05'),(1,3,'2026-01-05');
      INSERT INTO hashtag_follows VALUES(1,'bun');
      INSERT INTO post_hashtags VALUES(10,'archive');
      INSERT INTO post_mentions VALUES(11,1);
      INSERT INTO blocks VALUES(1,2);`)
    const path = join(directory, 'dump.zip')
    await createPublicArchive(database, path, new Date('2026-08-10T00:00:00Z'), 1)

    const zip = await JSZip.loadAsync(Bun.file(path).arrayBuffer())
    const names = Object.keys(zip.files)
    expect(names).toContain('users/000002.json')
    expect(names).toContain('posts/000002.json')
    const jsonFiles = names.filter(name => !zip.files[name]!.dir)
    const bytes = await Promise.all(jsonFiles.map(name => zip.files[name]!.async('uint8array')))
    const contents = bytes.map(value => new TextDecoder('utf-8', { fatal: true }).decode(value)).join('\n')
    expect(contents).toContain('alice')
    expect(contents).toContain('reply')
    expect(contents).not.toContain('@private.test')
    expect(contents).not.toContain('secret')
    expect(contents).not.toContain('created_at')
    expect(contents).not.toContain('updated_at')
    expect(contents).not.toContain('blocked')
    expect(contents).not.toContain('deleted account content')
    expect(contents).not.toContain('deleted post')
    expect(contents).not.toContain('banned')
    database.close()
  })
})
