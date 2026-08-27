import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'

test('post creation durably enqueues, leases, and reschedules push delivery', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,email_verified_at)
    VALUES(1,'author','author@example.com','!',CURRENT_TIMESTAMP)`)

  const created = await executeDatabaseDomain(database, 'api.createPost', {
    userId: 1,
    body: 'durable notification',
    parentId: null,
    origin: 'https://example.com',
    translation: null,
  })
  expect(created.status).toBe('ready')
  if (created.status !== 'ready') throw new Error('post was not created')

  const claimed = await executeDatabaseDomain(database, 'push.claimPostJobs', {
    now: 1_000,
    limit: 10,
    leaseMs: 60_000,
  })
  expect(claimed).toEqual([{
    postId: created.id,
    actorId: 1,
    actorHandle: 'author',
    attempts: 0,
  }])
  expect(await executeDatabaseDomain(database, 'push.claimPostJobs', {
    now: 2_000,
    limit: 10,
    leaseMs: 60_000,
  })).toEqual([])

  await executeDatabaseDomain(database, 'push.retryPostJob', {
    postId: created.id,
    attempts: 1,
    nextAttemptAt: 10_000,
    error: 'provider unavailable',
  })
  expect(await executeDatabaseDomain(database, 'push.claimPostJobs', {
    now: 9_999,
    limit: 10,
    leaseMs: 60_000,
  })).toEqual([])
  expect(await executeDatabaseDomain(database, 'push.claimPostJobs', {
    now: 10_000,
    limit: 10,
    leaseMs: 60_000,
  })).toHaveLength(1)

  await executeDatabaseDomain(database, 'push.completePostJob', { postId: created.id })
  expect(database.query('SELECT count(*) count FROM post_push_jobs').get()).toEqual({ count: 0 })
})
