import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { runMigrations } from './migrations'

function database() {
  const db = new Database(':memory:', { strict: true })
  db.run('PRAGMA foreign_keys=ON')
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.test','x'),(2,'bob','bob@example.test','x')`)
  return db
}

test('conversation heads are incrementally maintained as replies arrive', () => {
  const db = database()
  db.run(`INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'root','2026-08-01 10:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(11,2,10,'reply','2026-08-01 11:00:00');`)

  expect(db.query('SELECT post_id,conversation_id FROM post_conversations ORDER BY post_id').all()).toEqual([
    { post_id: 10, conversation_id: 10 },
    { post_id: 11, conversation_id: 10 },
  ])
  expect(db.query('SELECT * FROM conversation_heads').get()).toEqual({
    conversation_id: 10,
    latest_post_id: 11,
    activity_at: '2026-08-01 11:00:00',
  })
})

test('conversation heads recover when activity is deleted or rethreaded', () => {
  const db = database()
  db.run(`INSERT INTO posts(id,user_id,body,created_at) VALUES
      (10,1,'first','2026-08-01 10:00:00'),(20,1,'second','2026-08-01 10:30:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(21,2,20,'reply','2026-08-01 11:00:00');
    UPDATE posts SET parent_id=10 WHERE id=21;`)

  expect(db.query('SELECT conversation_id FROM post_conversations WHERE post_id=21').get())
    .toEqual({ conversation_id: 10 })
  expect(db.query('SELECT conversation_id,latest_post_id FROM conversation_heads ORDER BY conversation_id').all())
    .toEqual([{ conversation_id: 10, latest_post_id: 21 }, { conversation_id: 20, latest_post_id: 20 }])

  db.run('UPDATE posts SET deleted_at=\'2026-08-01 12:00:00\' WHERE id=21')
  expect(db.query('SELECT latest_post_id FROM conversation_heads WHERE conversation_id=10').get())
    .toEqual({ latest_post_id: 10 })
})
