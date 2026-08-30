import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'

function testDatabase() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.com','x'),(2,'bob','bob@example.com','x');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (1,2,NULL,'A quoted parent','2026-01-01 10:00:00'),
    (2,1,1,'Earlier searchable bookmark','2026-01-02 10:00:00'),
    (3,2,NULL,'Later searchable bookmark','2026-01-03 10:00:00');`)
  return database
}

describe('bookmarks', () => {
  test('toggles bookmarks and returns them newest-first with quoted parents', async () => {
    const database = testDatabase()
    expect(await executeDatabaseDomain(database, 'interactions.toggleBookmark', { userId: 1, postId: 2 }))
      .toEqual({ status: 'ready', bookmarked: true })
    await executeDatabaseDomain(database, 'interactions.toggleBookmark', { userId: 1, postId: 3 })
    database.run(`UPDATE post_bookmarks SET created_at=CASE post_id
      WHEN 2 THEN '2026-02-02 10:00:00' ELSE '2026-02-01 10:00:00' END WHERE user_id=1`)

    const page = await executeDatabaseDomain(database, 'bookmarks.page', {
      userId: 1, query: '', page: 1, pageSize: 20,
    })
    expect(page.posts.map(post => post.id)).toEqual([2, 3])
    expect(page.posts[0]?.parent).toMatchObject({ id: 1, body: 'A quoted parent' })

    expect(await executeDatabaseDomain(database, 'interactions.toggleBookmark', { userId: 1, postId: 2 }))
      .toEqual({ status: 'ready', bookmarked: false })
  })

  test('full-text search is limited to the current account bookmarks', async () => {
    const database = testDatabase()
    await executeDatabaseDomain(database, 'interactions.toggleBookmark', { userId: 1, postId: 2 })
    await executeDatabaseDomain(database, 'interactions.toggleBookmark', { userId: 2, postId: 3 })

    const matching = await executeDatabaseDomain(database, 'bookmarks.page', {
      userId: 1, query: 'searchable', page: 1, pageSize: 20,
    })
    expect(matching.posts.map(post => post.id)).toEqual([2])
    expect(matching.highlights).toEqual(['searchable'])
  })
})
