import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { exportUserData } from './data-export'
import { runMigrations } from './migrations'

test('account download includes user-owned content and private bookmark data without credential hashes', () => {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.com','secret-password'),(2,'bob','bob@example.com','other-secret');
    INSERT INTO posts(id,user_id,body,translation,execution_output) VALUES
    (1,2,'saved public note','translation','output'),(2,1,'my poll',NULL,NULL);
    INSERT INTO drafts(user_id,parent_id,body) VALUES(1,1,'private draft');
    INSERT INTO post_bookmarks(user_id,post_id) VALUES(1,1);
    INSERT INTO poll_options(id,post_id,position,label) VALUES(1,2,0,'yes');
    INSERT INTO poll_votes(post_id,option_id,user_id) VALUES(2,1,1);
    INSERT INTO post_locations(post_id,query,latitude,longitude,display_name)
      VALUES(2,'Athens',37.98,23.72,'Athens, Greece');
    INSERT INTO api_keys(token_hash,user_id,name,created_at) VALUES('api-secret',1,'phone',1);
    INSERT INTO feed_keys(token_hash,user_id,name,created_at) VALUES('feed-secret',1,'reader',1);`)

  const exported = exportUserData(database, 1) as any
  expect(exported.drafts).toMatchObject([{ body: 'private draft', parent_id: 1 }])
  expect(exported.bookmarks).toMatchObject([{ post_id: 1, author: 'bob', body: 'saved public note' }])
  expect(exported.poll_votes).toMatchObject([{ post_id: 2, option_id: 1, label: 'yes' }])
  expect(exported.post_locations).toMatchObject([{ post_id: 2, display_name: 'Athens, Greece' }])
  expect(exported.api_keys).toMatchObject([{ name: 'phone' }])
  expect(exported.feed_keys).toMatchObject([{ name: 'reader' }])
  expect(JSON.stringify(exported)).not.toContain('api-secret')
  expect(JSON.stringify(exported)).not.toContain('feed-secret')
  expect(JSON.stringify(exported)).not.toContain('secret-password')
  database.close()
})
