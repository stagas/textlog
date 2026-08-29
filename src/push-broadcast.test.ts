import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'

test('broadcast delivery uses the subscription schema and excludes disabled recipients', async () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'enabled','enabled@example.com','!'),(2,'disabled','disabled@example.com','!');
    INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,notify_broadcasts) VALUES
    ('https://push.example/enabled',1,'key-1','auth-1',1),
    ('https://push.example/disabled',2,'key-2','auth-2',0);`)

  expect(await executeDatabaseDomain(database, 'push.allDelivery', {})).toEqual([{
    endpoint: 'https://push.example/enabled',
    p256dh: 'key-1',
    auth: 'auth-1',
    username: 'enabled',
  }])
})
