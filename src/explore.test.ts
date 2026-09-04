import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { explorePivot, preserveSuggestedPeopleOrder, suggestedPeople, suggestedPeopleCount, trendingTagCount,
  trendingTags } from './explore'

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT,bio TEXT,email TEXT,created_at TEXT,deleted_at TEXT,
      handle_chosen_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,deleted_at TEXT);
    CREATE TABLE follows (follower_id INTEGER,following_id INTEGER,created_at TEXT);
    CREATE TABLE hashtag_follows (user_id INTEGER,tag TEXT,created_at TEXT);
    CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
    INSERT INTO users(id,handle,bio,handle_chosen_at) VALUES
      (1,'viewer','',CURRENT_TIMESTAMP),(2,'two','Bio two',CURRENT_TIMESTAMP),
      (3,'three','Bio three',CURRENT_TIMESTAMP),(4,'four','Bio four',CURRENT_TIMESTAMP),
      (5,'five','Bio five',CURRENT_TIMESTAMP),(6,'six','Bio six',CURRENT_TIMESTAMP);
    INSERT INTO posts(id,user_id,created_at) VALUES
      (2,2,'2026-08-01'),(3,3,'2026-08-02'),(4,4,'2026-08-03'),(5,5,'2026-08-04'),(6,6,'2026-08-05');
    INSERT INTO follows(follower_id,following_id) VALUES(1,3);
    INSERT INTO blocks VALUES(1,4);
  `)
  return database
}

describe('explore suggestions', () => {
  test('preserves the visible order after follow state changes', () => {
    const people = [
      { id: 2, followsViewer: true },
      { id: 3, followsViewer: false },
      { id: 5, followsViewer: true },
    ]

    expect(preserveSuggestedPeopleOrder(people, [5, 3, 2]).map(person => person.id)).toEqual([5, 3, 2])
  })

  test('uses a stable daily pivot', () => {
    expect(explorePivot(100, 7, '2026-08-04')).toBe(explorePivot(100, 7, '2026-08-04'))
    expect(explorePivot(100, 7, '2026-08-04')).not.toBe(explorePivot(100, 7, '2026-08-05'))
  })

  test('sorts by latest post while respecting blocks', () => {
    const database = fixture()
    const first = suggestedPeople(database, 1, 6, '2026-08-04')
    const second = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(first.map(person => person.id)).toEqual(second.map(person => person.id))
    expect(first.map(person => person.id)).toEqual([6, 5, 3, 2])
  })

  test('includes people without bios without using profile quality for sorting', () => {
    const database = fixture()
    database.run(`UPDATE users SET bio='' WHERE id=5; UPDATE posts SET created_at='2026-08-01'`)
    const people = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(people.map(person => person.id)).toContain(5)
    expect(people.map(person => person.id)).toEqual([2, 3, 5, 6])
  })

  test('excludes newly joined people without notes', () => {
    const database = fixture()
    database.run(`
      INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
        (7,'newcomer','Just joined','2026-08-03 12:00:00',CURRENT_TIMESTAMP),
        (8,'inactive','Joined a while ago','2026-07-01 12:00:00',CURRENT_TIMESTAMP);
    `)

    const people = suggestedPeople(database, 1, 8, '2026-08-04')
    expect(people.map(person => person.id)).not.toContain(7)
    expect(people.map(person => person.id)).not.toContain(8)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('excludes people who have neither a bio nor notes', () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
      (7,'empty','','2026-08-04 12:00:00',CURRENT_TIMESTAMP)`)

    expect(suggestedPeople(database, 1, 8, '2026-08-04').map(person => person.id)).not.toContain(7)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('excludes followed people when they have no posts', () => {
    const database = fixture()
    database.run(`
      INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
        (7,'quiet','','2026-07-01 12:00:00',CURRENT_TIMESTAMP);
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,7,'2026-08-01 12:00:00');
    `)

    expect(suggestedPeople(database, 1, 8, '2026-08-04').map(person => person.id)).not.toContain(7)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('excludes people without posts after any number of follows', () => {
    const database = fixture()
    database.run(`
      INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
        (7,'peoplefan','','2026-07-01 12:00:00',CURRENT_TIMESTAMP),
        (8,'mixedfan','','2026-07-01 12:00:00',CURRENT_TIMESTAMP),
        (9,'singlefollow','','2026-07-01 12:00:00',CURRENT_TIMESTAMP);
      INSERT INTO follows(follower_id,following_id) VALUES(7,2),(7,5),(8,2);
      INSERT INTO hashtag_follows(user_id,tag) VALUES(8,'notes');
      INSERT INTO hashtag_follows(user_id,tag) VALUES(9,'notes');
    `)

    const people = suggestedPeople(database, 1, 8, '2026-08-04')
    expect(people.map(person => person.id)).not.toContain(7)
    expect(people.map(person => person.id)).not.toContain(8)
    expect(people.map(person => person.id)).not.toContain(9)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('excludes accounts that have not chosen a handle', () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,bio,created_at) VALUES
      (7,'anon123456789abc','','2026-08-04 12:00:00')`)

    expect(suggestedPeople(database, 1, 8, '2026-08-04').map(person => person.id)).not.toContain(7)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('uses the id only to break equal latest-post timestamps', () => {
    const database = fixture()
    database.run(`
      UPDATE posts SET created_at='2026-08-01';
      INSERT INTO posts(id,user_id) VALUES(7,5),(8,2),(9,2),(10,2),(11,5);
      INSERT INTO follows(follower_id,following_id) VALUES(2,5),(4,5),(2,6);
    `)

    expect(suggestedPeople(database, 1, 6, '2026-08-04').map(person => person.id)).toEqual([2, 3, 5, 6])
  })

  test('reports when a suggested person follows the viewer', () => {
    const database = fixture()
    database.run('INSERT INTO follows(follower_id,following_id) VALUES(6,1)')

    const people = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(people.find(person => person.id === 6)?.followsViewer).toBeTruthy()
  })

  test('ranks only by latest post regardless of follow activity or state', () => {
    const database = fixture()
    database.run(`
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,5,'2026-08-10 12:00:00');
      INSERT INTO posts(id,user_id,created_at) VALUES
        (7,2,'2026-08-08 12:00:00'),(8,3,'2026-08-10 11:00:00');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(6,'active','2026-08-09 12:00:00');
    `)

    const people = suggestedPeople(database, 1, 8, '2026-08-10')
    expect(people.map(person => person.id)).toEqual([3, 2, 6, 5])
    expect(people.map(person => !!person.following)).toEqual([true, false, false, true])
  })
})

describe('trending tags', () => {
  function tagFixture() {
    const database = new Database(':memory:')
    database.run(`
      CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,created_at TEXT,deleted_at TEXT);
      CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
      CREATE TABLE hashtag_follows (user_id INTEGER,tag TEXT);
      CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
      CREATE TABLE blocked_hashtags (user_id INTEGER,tag TEXT);
      INSERT INTO posts VALUES
        (1,2,'2026-08-07 23:00:00',NULL),(2,2,'2026-08-07 22:00:00',NULL),
        (3,3,'2026-08-06 00:00:00',NULL),(4,3,'2026-08-06 00:00:00',NULL),
        (5,3,'2026-08-06 00:00:00',NULL),(6,3,'2026-08-06 00:00:00',NULL),
        (7,4,'2026-07-01 00:00:00',NULL),(8,5,'2026-08-07 23:30:00','2026-08-08 00:00:00'),
        (9,4,'2026-07-30 00:00:00',NULL);
      INSERT INTO post_hashtags VALUES
        (1,'fresh'),(2,'fresh'),(3,'busy'),(4,'busy'),(5,'busy'),(6,'busy'),
        (7,'historical'),(8,'deleted'),(9,'older');
      INSERT INTO hashtag_follows VALUES(1,'fresh');
    `)
    return database
  }

  test('ranks activity across the extended window and excludes stale and deleted notes', () => {
    const tags = trendingTags(tagFixture(), 1, 12, '2026-08-08T00:00:00.000Z')
    expect(tags.map(tag => tag.tag)).toEqual(['fresh', 'busy', 'older'])
    expect(tags.map(tag => tag.count)).toEqual([2, 4, 1])
    expect(tags[0].following).toBeTruthy()
  })

  test('rewards participation by different authors over repetition by one author', () => {
    const database = tagFixture()
    database.run(`
      INSERT INTO posts VALUES
        (10,6,'2026-08-07 20:00:00',NULL),(11,6,'2026-08-07 19:00:00',NULL),
        (12,6,'2026-08-07 18:00:00',NULL),(13,6,'2026-08-07 17:00:00',NULL),
        (14,7,'2026-08-07 16:00:00',NULL),(15,8,'2026-08-07 15:00:00',NULL),
        (16,9,'2026-08-07 14:00:00',NULL);
      INSERT INTO post_hashtags VALUES
        (10,'repeated'),(11,'repeated'),(12,'repeated'),(13,'repeated'),
        (14,'community'),(15,'community'),(16,'community');
    `)

    const tags = trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')
    expect(tags.findIndex(tag => tag.tag === 'community'))
      .toBeLessThan(tags.findIndex(tag => tag.tag === 'repeated'))
  })

  test('keeps meaningful activity from the last few days competitive', () => {
    const database = tagFixture()
    database.run(`
      INSERT INTO posts VALUES
        (10,6,'2026-08-05 00:00:00',NULL),(11,7,'2026-08-05 00:00:00',NULL),
        (12,8,'2026-08-05 00:00:00',NULL);
      INSERT INTO post_hashtags VALUES(10,'sustained'),(11,'sustained'),(12,'sustained');
    `)

    expect(trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')[0].tag).toBe('sustained')
  })

  test('boosts tags participating in hot conversations without making engagement unbounded', () => {
    const database = tagFixture()
    database.run(`
      CREATE TABLE post_conversations (post_id INTEGER PRIMARY KEY,conversation_id INTEGER);
      CREATE TABLE hot_feed_projection (post_id INTEGER,conversation_id INTEGER,hot_score REAL);
      INSERT INTO posts VALUES
        (10,6,'2026-08-07 20:00:00',NULL),(11,7,'2026-08-07 20:00:00',NULL),
        (12,8,'2026-08-07 20:00:00',NULL);
      INSERT INTO post_hashtags VALUES(10,'cold'),(11,'engaged'),(12,'viral');
      INSERT INTO post_conversations VALUES(10,10),(11,11),(12,12);
      INSERT INTO hot_feed_projection VALUES(10,10,0),(11,11,15),(12,12,1000000);
    `)

    const tags = trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')
    expect(tags.findIndex(tag => tag.tag === 'engaged')).toBeLessThan(tags.findIndex(tag => tag.tag === 'cold'))
    const engaged = tags.find(tag => tag.tag === 'engaged') as typeof tags[number] & { trend_score: number }
    const viral = tags.find(tag => tag.tag === 'viral') as typeof tags[number] & { trend_score: number }
    expect(viral.trend_score).toBeCloseTo(engaged.trend_score * 4 / 3)
  })

  test('respects blocked people and hashtags', () => {
    const database = tagFixture()
    database.run(`INSERT INTO blocks VALUES(1,2); INSERT INTO blocked_hashtags VALUES(1,'busy'),(1,'older');`)
    expect(trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')).toEqual([])
  })

  test('canonicalizes aliases and counts each post once under the primary tag', () => {
    const database = tagFixture()
    database.run(`
      CREATE TABLE tag_aliases (alias TEXT PRIMARY KEY, primary_tag TEXT NOT NULL);
      INSERT INTO tag_aliases VALUES('tlog','meta'),('textlog','meta');
      INSERT INTO post_hashtags VALUES(1,'meta'),(1,'tlog'),(2,'textlog'),(3,'meta');
      INSERT INTO hashtag_follows VALUES(1,'meta');
    `)
    const tags = trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')
    expect(tags.find(tag => tag.tag === 'meta')).toMatchObject({ count: 3, following: 1 })
    expect(tags.some(tag => tag.tag === 'tlog' || tag.tag === 'textlog')).toBe(false)
    expect(trendingTagCount(database, 1, '2026-08-08T00:00:00.000Z')).toBe(4)
  })
})
