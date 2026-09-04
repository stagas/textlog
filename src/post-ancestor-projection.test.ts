import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { runMigrations } from './migrations'

test('post ancestor projection follows inserts and rethreading', () => {
  const database = new Database(':memory:', { strict: true })
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'first','first@example.test','x'),(2,'second','second@example.test','x');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES
      (1,1,NULL,'root'),(2,2,1,'reply'),(3,2,2,'nested'),(4,1,NULL,'other');`)

  expect(database.query(`SELECT ancestor_id,ancestor_user_id,depth FROM post_ancestors
    WHERE post_id=3 ORDER BY depth`).all()).toEqual([
    { ancestor_id: 2, ancestor_user_id: 2, depth: 1 },
    { ancestor_id: 1, ancestor_user_id: 1, depth: 2 },
  ])

  database.query('UPDATE posts SET parent_id=4 WHERE id=2').run()
  expect(database.query(`SELECT ancestor_id,ancestor_user_id,depth FROM post_ancestors
    WHERE post_id=3 ORDER BY depth`).all()).toEqual([
    { ancestor_id: 2, ancestor_user_id: 2, depth: 1 },
    { ancestor_id: 4, ancestor_user_id: 1, depth: 2 },
  ])
  database.close()
})
