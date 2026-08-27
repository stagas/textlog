import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { runMigrations } from './migrations'

function database() {
  const db = new Database(':memory:', { strict: true })
  db.run('PRAGMA foreign_keys=ON')
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.test','x'),(2,'bob','bob@example.test','x'),
    (3,'charlie','charlie@example.test','x'),(4,'dave','dave@example.test','x')`)
  return db
}

test('personalized candidates fan posts out to followers and thread participants', () => {
  const db = database()
  db.run(`INSERT INTO follows(follower_id,following_id,created_at)
      VALUES(3,1,'2026-08-01 09:00:00');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'root','2026-08-01 10:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(11,2,10,'reply','2026-08-01 11:00:00');`)

  expect(db.query(`SELECT viewer_id,post_id FROM personalized_post_candidates
    WHERE post_id IN (10,11) ORDER BY post_id,viewer_id`).all()).toEqual([
    { viewer_id: 1, post_id: 10 },
    { viewer_id: 3, post_id: 10 },
    { viewer_id: 1, post_id: 11 },
    { viewer_id: 2, post_id: 11 },
    { viewer_id: 3, post_id: 11 },
  ])
})

test('mentions and followed ancestor tags extend candidate delivery', () => {
  const db = database()
  db.run(`INSERT INTO posts(id,user_id,body,created_at) VALUES
      (10,1,'private topic','2026-08-01 10:00:00');
    INSERT INTO post_hashtags(post_id,tag) VALUES(10,'topic');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(3,'topic','2026-08-01 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(11,2,10,'continuation','2026-08-01 11:00:00');
    INSERT INTO post_mentions(post_id,user_id) VALUES(11,4);`)

  expect(db.query(`SELECT viewer_id FROM personalized_post_candidates
    WHERE post_id=11 ORDER BY viewer_id`).all()).toEqual([
    { viewer_id: 1 }, { viewer_id: 2 }, { viewer_id: 3 }, { viewer_id: 4 },
  ])
})
