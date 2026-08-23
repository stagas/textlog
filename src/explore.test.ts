import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { explorePivot, suggestedPeople, suggestedPeopleCount, trendingTags } from './explore'

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
  test('uses a stable daily pivot', () => {
    expect(explorePivot(100, 7, '2026-08-04')).toBe(explorePivot(100, 7, '2026-08-04'))
    expect(explorePivot(100, 7, '2026-08-04')).not.toBe(explorePivot(100, 7, '2026-08-05'))
  })

  test('samples deterministically around the id range while respecting relationships', () => {
    const database = fixture()
    const first = suggestedPeople(database, 1, 6, '2026-08-04')
    const second = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(first.map(person => person.id)).toEqual(second.map(person => person.id))
    expect(new Set(first.map(person => person.id))).toEqual(new Set([2, 3, 5, 6]))
  })

  test('includes people without bios but ranks comparable completed profiles first', () => {
    const database = fixture()
    database.run(`UPDATE users SET bio='' WHERE id=5; UPDATE posts SET created_at='2026-08-01'`)
    const people = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(people.map(person => person.id)).toContain(5)
    expect(people.findIndex(person => person.id === 5)).toBeGreaterThan(
      people.findIndex(person => person.id === 2),
    )
  })

  test('includes newly joined people without notes in the rotation', () => {
    const database = fixture()
    database.run(`
      INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
        (7,'newcomer','Just joined','2026-08-03 12:00:00',CURRENT_TIMESTAMP),
        (8,'inactive','Joined a while ago','2026-07-01 12:00:00',CURRENT_TIMESTAMP);
    `)

    const people = suggestedPeople(database, 1, 8, '2026-08-04')
    expect(people.map(person => person.id)).toContain(7)
    expect(people.map(person => person.id)).not.toContain(8)
    expect(people.find(person => person.id === 7)?.posts).toBe(0)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(5)
  })

  test('excludes people who have neither a bio nor notes', () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
      (7,'empty','','2026-08-04 12:00:00',CURRENT_TIMESTAMP)`)

    expect(suggestedPeople(database, 1, 8, '2026-08-04').map(person => person.id)).not.toContain(7)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('includes followed people even when they would not otherwise qualify', () => {
    const database = fixture()
    database.run(`
      INSERT INTO users(id,handle,bio,created_at,handle_chosen_at) VALUES
        (7,'quiet','','2026-07-01 12:00:00',CURRENT_TIMESTAMP);
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,7,'2026-08-01 12:00:00');
    `)

    const quiet = suggestedPeople(database, 1, 8, '2026-08-04').find(person => person.id === 7)
    expect(quiet?.following).toBeTruthy()
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(5)
  })

  test('includes people without bios or notes after two combined follows', () => {
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
    expect(people.map(person => person.id)).toEqual(expect.arrayContaining([7, 8]))
    expect(people.map(person => person.id)).not.toContain(9)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(6)
  })

  test('excludes accounts that have not chosen a handle', () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,bio,created_at) VALUES
      (7,'anon123456789abc','','2026-08-04 12:00:00')`)

    expect(suggestedPeople(database, 1, 8, '2026-08-04').map(person => person.id)).not.toContain(7)
    expect(suggestedPeopleCount(database, 1, '2026-08-04')).toBe(4)
  })

  test('uses profile quality and daily rotation to break equal-activity ties', () => {
    const database = fixture()
    database.run(`
      UPDATE posts SET created_at='2026-08-01';
      INSERT INTO posts(id,user_id) VALUES(7,5),(8,2),(9,2),(10,2),(11,5);
      INSERT INTO follows(follower_id,following_id) VALUES(2,5),(4,5),(2,6);
    `)

    const boosted = suggestedPeople(database, 1, 6, '2026-08-04').map(person => person.id)
    expect(new Set(boosted.slice(0, 2))).toEqual(new Set([2, 5]))
    expect(boosted[2]).toBe(6)

    const dayPivotingToTwo = Array.from({ length: 31 }, (_, day) => `2026-08-${String(day + 1).padStart(2, '0')}`)
      .find(day => explorePivot(6, 1, day) === 2)!
    expect(suggestedPeople(database, 1, 6, dayPivotingToTwo)[0].id).toBe(2)
  })

  test('reports when a suggested person follows the viewer', () => {
    const database = fixture()
    database.run('INSERT INTO follows(follower_id,following_id) VALUES(6,1)')

    const people = suggestedPeople(database, 1, 6, '2026-08-04')
    expect(people.find(person => person.id === 6)?.followsViewer).toBeTruthy()
  })

  test('ranks everyone together by recent activity regardless of follow state', () => {
    const database = fixture()
    database.run(`
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,5,'2026-08-10 12:00:00');
      INSERT INTO posts(id,user_id,created_at) VALUES
        (7,2,'2026-08-08 12:00:00'),(8,3,'2026-08-10 11:00:00');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(6,'active','2026-08-09 12:00:00');
    `)

    const people = suggestedPeople(database, 1, 8, '2026-08-10')
    expect(people.map(person => person.id)).toEqual([3, 6, 2, 5])
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
