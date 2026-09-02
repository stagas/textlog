import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TagPicker, shouldShowTagPicker } from './components/tag-picker'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'
import type { User } from './types'

const user = {
  id: 1,
  handle: 'alice',
  email: 'alice@example.com',
  bio: '',
  handle_chosen_at: '2026-09-01 12:00:00',
  mood_prompt_dismissed_at: '2026-09-01 12:01:00',
} as User

test('tag prompt follows the mood prompt and stops after completion or dismissal', () => {
  expect(shouldShowTagPicker(user)).toBe(true)
  expect(shouldShowTagPicker({ ...user, mood_prompt_dismissed_at: null })).toBe(false)
  expect(shouldShowTagPicker({ ...user, tag_prompt_completed_at: '2026-09-01 12:02:00' })).toBe(false)
})

test('tag prompt renders popular tags as a multi-select and can be dismissed', () => {
  const html = renderToStaticMarkup(<TagPicker user={user} returnTo="/@" tags={[
    { tag: 'writing', displayName: 'Writing Life', count: 12 },
    { tag: 'books', count: 1 },
  ]} />)
  expect(html).toContain('type="checkbox" name="tags" value="writing"')
  expect(html).toContain('<b aria-hidden="true">#</b>Writing Life')
  expect(html).not.toContain('12 notes')
  expect(html).toContain('class="visually-hidden">Popular hashtags</legend>')
  expect(html).toContain('action="/pick-tags/dismiss"')
  expect(html).toContain("I&#x27;ll do it later, thanks")
})

test('loads the most-used tags and follows all selected tags when completed', async () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'alice','alice@example.com','x');
    INSERT INTO posts(id,user_id,body) VALUES(1,1,'#books #writing #meta'),(2,1,'#writing #meta');
    INSERT INTO post_hashtags(post_id,tag) VALUES
      (1,'books'),(1,'writing'),(1,'meta'),(2,'writing'),(2,'meta');
    INSERT INTO tag_display_names(tag,display_name) VALUES('writing','Writing Life');`)

  expect(await executeDatabaseDomain(database, 'account.popularTags', { limit: 12 })).toEqual([
    { tag: 'writing', displayName: 'Writing Life', count: 2 },
    { tag: 'books', displayName: null, count: 1 },
  ])
  await executeDatabaseDomain(database, 'account.completeTagPrompt', {
    userId: 1,
    tags: ['writing', 'books'],
  })
  expect(database.query('SELECT tag FROM hashtag_follows WHERE user_id=1 ORDER BY tag').all()).toEqual([
    { tag: 'books' },
    { tag: 'writing' },
  ])
  expect((database.query('SELECT tag_prompt_completed_at completed FROM users WHERE id=1').get() as {
    completed: string | null
  }).completed).not.toBeNull()
})
