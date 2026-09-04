import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { runMigrations } from './migrations'
import { dashboardStats } from './stats'

test('notes per user stats exclude users with two or fewer notes', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'zero','zero@example.com','x'),
    (2,'two','two@example.com','x'),
    (3,'three','three@example.com','x'),
    (4,'seven','seven@example.com','x');
    INSERT INTO posts(user_id,body) VALUES
    (2,'1'),(2,'2'),
    (3,'1'),(3,'2'),(3,'3'),
    (4,'1'),(4,'2'),(4,'3'),(4,'4'),(4,'5'),(4,'6'),(4,'7');`)

  const stats = dashboardStats(database)

  expect(stats.notesPerUser).toBe(5)
  expect(stats.averageNotesPerUser).toBe(5)
  database.close()
})

test('post and reply totals include deleted posts from all accounts', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'person','person@example.com','x'),
    (2,'second','second@example.com','x');
    INSERT INTO posts(id,user_id,body,parent_id,created_at) VALUES
    (1,1,'person 1',NULL,datetime('now')),
    (2,1,'person 2',1,datetime('now')),
    (3,1,'person 3',NULL,datetime('now')),
    (4,2,'bot 1',NULL,datetime('now')),
    (5,2,'bot 2',4,datetime('now')),
    (6,2,'bot 3',NULL,datetime('now')),
    (7,2,'bot yesterday',NULL,datetime('now','start of day','-1 second'));`)
  database.run(`UPDATE posts SET deleted_at=datetime('now') WHERE id IN (2,3)`)

  const stats = dashboardStats(database)

  expect(stats.posts).toBe(7)
  expect(stats.replies).toBe(2)
  expect(stats.notesPerUser).toBe(4)
  expect(stats.averageNotesPerUser).toBe(4)
  expect(stats.posts24h).toBe(5)
  expect(stats.posts7d).toBe(5)
  expect(stats.postsYesterday).toBe(1)
  database.close()
})

test('DAU and MAU count distinct active users in rolling windows', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'daily','daily@example.com','x'),
    (2,'monthly','monthly@example.com','x'),
    (3,'inactive','inactive@example.com','x');
    INSERT INTO posts(user_id,body,created_at) VALUES
    (1,'first today',datetime('now','-2 hours')),
    (1,'second today',datetime('now','-1 hour')),
    (2,'this month',datetime('now','-10 days')),
    (3,'too old',datetime('now','-31 days'));`)

  const stats = dashboardStats(database)

  expect(stats.dau).toBe(1)
  expect(stats.mau).toBe(2)
  database.close()
})

test('reddit visitor stat counts unique campaign visitors', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO campaign_visitors(campaign,visitor_hash) VALUES
    ('reddit','first'),('reddit','second'),('another','first');
    INSERT INTO users(id,handle,email,password) VALUES(10,'reddit_user','reddit@example.com','x');
    INSERT INTO campaign_signups(campaign,user_id) VALUES('reddit',10)`)

  expect(dashboardStats(database).redditVisitors).toBe(2)
  expect(dashboardStats(database).redditNewUsers).toBe(1)
  database.close()
})
