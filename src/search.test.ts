import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { runMigrations } from './migrations'
import { searchExpression, searchPosts } from './search'

function testDatabase() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.com','x'),(2,'bob','bob@example.com','x'),(3,'carol','carol@example.com','x');
    INSERT INTO posts(id,user_id,body) VALUES
    (1,1,'Building a quiet searchable text log'),
    (2,2,'Search engines and SQLite are useful'),
    (3,3,'An unrelated note');`)
  return database
}

describe('post search', () => {
  test('turns ordinary input into safe prefix terms', () => {
    expect(searchExpression('search sqlite')).toBe('"search"* AND "sqlite"*')
    expect(searchExpression('  !!! ')).toBe('')
    expect(searchExpression('café')).toBe('"café"*')
  })

  test('indexes existing changes and ranks matching visible posts', () => {
    const database = testDatabase()
    expect(searchPosts(database, 'sear').rows.map(post => post.id)).toEqual([2, 1])

    database.run("UPDATE posts SET body='Now contains a telescope' WHERE id=3")
    expect(searchPosts(database, 'telescope').rows.map(post => post.id)).toEqual([3])
    database.run('DELETE FROM posts WHERE id=3')
    expect(searchPosts(database, 'telescope').total).toBe(0)
  })

  test('applies blocks blocked hashtags and deletion visibility', () => {
    const database = testDatabase()
    database.run(`INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,2);
      INSERT INTO post_hashtags(post_id,tag) VALUES(1,'quiet');
      INSERT INTO blocked_hashtags(user_id,tag) VALUES(1,'quiet');`)
    expect(searchPosts(database, 'search', 1).total).toBe(0)
    expect(searchPosts(database, 'search', -1).total).toBe(2)
    database.run('UPDATE posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=2')
    expect(searchPosts(database, 'search', -1).rows.map(post => post.id)).toEqual([1])
  })
})
