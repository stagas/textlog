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
