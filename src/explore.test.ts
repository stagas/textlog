import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { explorePivot, suggestedPeople, trendingTags } from './explore'

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT,bio TEXT,email TEXT,deleted_at TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,deleted_at TEXT);
    CREATE TABLE follows (follower_id INTEGER,following_id INTEGER);
    CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
    INSERT INTO users(id,handle,bio) VALUES
      (1,'viewer',''),(2,'two',''),(3,'three',''),(4,'four',''),(5,'five',''),(6,'six','');
    INSERT INTO posts(id,user_id) VALUES(2,2),(3,3),(4,4),(5,5),(6,6);
    INSERT INTO follows VALUES(1,3);
    INSERT INTO blocks VALUES(1,4);
  `)
  return database
}

describe('explore suggestions', () => {
  test('uses a stable daily pivot', () => {
    expect(explorePivot(100, 7, '2026-08-04')).toBe(explorePivot(100, 7, '2026-08-04'))
    expect(explorePivot(100, 7, '2026-08-04')).not.toBe(explorePivot(100, 7, '2026-08-05'))
  })

  test('samples deterministically around the id range while respecting relationships', () => {
    const database = fixture()
    const first = suggestedPeople(database, 1, 6, '2026-08-04')
    const second = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(first.map(person => person.id)).toEqual(second.map(person => person.id))
    expect(new Set(first.map(person => person.id))).toEqual(new Set([2, 5, 6]))
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
        (7,4,'2026-07-01 00:00:00',NULL),(8,5,'2026-08-07 23:30:00','2026-08-08 00:00:00');
      INSERT INTO post_hashtags VALUES
        (1,'fresh'),(2,'fresh'),(3,'busy'),(4,'busy'),(5,'busy'),(6,'busy'),
        (7,'historical'),(8,'deleted');
      INSERT INTO hashtag_follows VALUES(1,'fresh');
    `)
    return database
  }

  test('ranks recent activity with decay and excludes stale and deleted notes', () => {
    const tags = trendingTags(tagFixture(), 1, 12, '2026-08-08T00:00:00.000Z')
    expect(tags.map(tag => tag.tag)).toEqual(['fresh', 'busy'])
    expect(tags.map(tag => tag.count)).toEqual([2, 4])
    expect(tags[0].following).toBeTruthy()
  })

  test('respects blocked people and hashtags', () => {
    const database = tagFixture()
    database.run(`INSERT INTO blocks VALUES(1,2); INSERT INTO blocked_hashtags VALUES(1,'busy');`)
    expect(trendingTags(database, 1, 12, '2026-08-08T00:00:00.000Z')).toEqual([])
  })
})
