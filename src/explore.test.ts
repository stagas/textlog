import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { explorePivot, suggestedPeople } from './explore'

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
