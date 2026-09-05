import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { feedSnapshotPage } from './feed-snapshots'
import { runMigrations } from './migrations'

function fixture() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`
    INSERT INTO users(id,handle,email,password) VALUES(1,'writer','writer@example.com','x');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES
      (1,1,NULL,'old pinned note #pin'),
      (2,1,NULL,'ordinary note'),
      (3,1,NULL,'current pinned note #pin'),
      (4,1,NULL,'newest ordinary note'),
      (5,1,1,'old pinned reply #pin'),
      (6,1,1,'ordinary reply'),
      (7,1,1,'current pinned reply #pin'),
      (8,1,1,'newest ordinary reply');
    INSERT INTO post_hashtags(post_id,tag) VALUES(1,'pin'),(3,'pin'),(5,'pin'),(7,'pin');
  `)
  return database
}

describe('profile pinning', () => {
  test('puts only the latest #pin first independently for notes and replies', async () => {
    const database = fixture()
    feedSnapshotPage(database, 'profile:1:notes', -1, 1, () => [{ id: 99 }], 20, database)
    const input = { profileId: 1, viewerId: -1, page: 1, pageSize: 20 as const }
    const notes = await executeDatabaseDomain(database, 'profiles.postsPage', { ...input, kind: 'notes' })
    const replies = await executeDatabaseDomain(database, 'profiles.postsPage', { ...input, kind: 'replies' })

    expect(notes.posts.map(post => post.id)).toEqual([3, 4, 2, 1])
    expect(notes.posts.filter(post => post.profile_pinned).map(post => post.id)).toEqual([3])
    expect(replies.posts.map(post => post.id)).toEqual([7, 8, 6, 5])
    expect(replies.posts.filter(post => post.profile_pinned).map(post => post.id)).toEqual([7])
  })

  test('hides dropped-username profiles from others but keeps their posts for moderators', async () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(2,'moderator','gstagas@gmail.com','x');
      UPDATE users SET handle='anon123456789abc',handle_chosen_at=NULL WHERE id=1;
      INSERT INTO banned_usernames(username,dropped_user_id,dropped_by) VALUES('writer',1,2)`)
    const page = { profileId: 1, page: 1, pageSize: 20 as const, kind: 'notes' as const }

    const publicPosts = await executeDatabaseDomain(database, 'profiles.postsPage', { ...page, viewerId: -1 })
    const moderatorPosts = await executeDatabaseDomain(database, 'profiles.postsPage', { ...page, viewerId: 2 })
    const publicDetail = await executeDatabaseDomain(database, 'posts.detail', { id: 1, viewerId: -1 })
    const moderatorDetail = await executeDatabaseDomain(database, 'posts.detail', { id: 1, viewerId: 2 })

    expect(publicPosts.posts).toEqual([])
    expect(moderatorPosts.posts.map(post => post.id)).toEqual([3, 4, 2, 1])
    expect(moderatorPosts.posts.every(post => post.hidden_post)).toBeTrue()
    expect(publicDetail.status).toBe('not_found')
    expect(moderatorDetail.status).toBe('ready')
    if (moderatorDetail.status === 'ready') expect(moderatorDetail.post.hidden_post).toBeTrue()
  })
})
