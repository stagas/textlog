import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PeoplePicker, shouldShowPeoplePicker, shuffledPeople } from './components/people-picker'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'
import type { User } from './types'

const user = {
  id: 1,
  handle: 'alice',
  email: 'alice@example.com',
  bio: '',
  handle_chosen_at: '2026-09-01',
  mood_prompt_dismissed_at: '2026-09-01',
  tag_prompt_completed_at: '2026-09-01',
} as User

test('people prompt follows the tag prompt and stops after completion or dismissal', () => {
  expect(shouldShowPeoplePicker(user)).toBe(true)
  expect(shouldShowPeoplePicker({ ...user, tag_prompt_completed_at: null })).toBe(false)
  expect(shouldShowPeoplePicker({ ...user, people_prompt_completed_at: '2026-09-01' })).toBe(false)
})

test('people prompt renders whole-card multi-select choices and dismissal', () => {
  const html = renderToStaticMarkup(<PeoplePicker user={user} returnTo="/@" people={[
    { id: 2, handle: 'bob', mood: '😊', bio: 'Writes about **small**, useful things.' },
  ]} />)
  expect(html).toContain('<b aria-hidden="true">@</b>bob')
  expect(html).toContain('type="checkbox" name="people" value="2"')
  expect(html).toContain('action="/pick-people/dismiss"')
  expect(html).toContain('Writes about <strong>small</strong>, useful things.')
})

test('people prompt shuffles ten people from the top thirty candidates', () => {
  const people = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    handle: `person${index + 1}`,
    bio: '',
  }))
  const displayed = shuffledPeople(people, 10, () => 0)

  expect(displayed).toHaveLength(10)
  expect(new Set(displayed.map(person => person.id)).size).toBe(10)
  expect(displayed.map(person => person.id)).not.toEqual(people.slice(0, 10).map(person => person.id))
  expect(people.map(person => person.id)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
})

test('loads popular people and follows all selected people', async () => {
  const database = new Database(':memory:')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,handle_chosen_at) VALUES
    (1,'alice','alice@example.com','x',CURRENT_TIMESTAMP),
    (2,'bob','bob@example.com','x',CURRENT_TIMESTAMP),
    (3,'carol','carol@example.com','x',CURRENT_TIMESTAMP),
    (4,'reader','reader@example.com','x',CURRENT_TIMESTAMP);
    INSERT INTO follows(follower_id,following_id) VALUES(4,3);
    INSERT INTO posts(user_id,body) VALUES(2,'one'),(2,'two');`)
  const people = await executeDatabaseDomain(database, 'account.popularPeople', { userId: 1, limit: 12 })
  expect(people[0]?.handle).toBe('bob')
  const result = await executeDatabaseDomain(database, 'account.completePeoplePrompt', { userId: 1, people: [2, 3] })
  expect(result.followed).toEqual([{ id: 2, handle: 'bob' }, { id: 3, handle: 'carol' }])
  expect(database.query('SELECT following_id FROM follows WHERE follower_id=1 ORDER BY following_id').all()).toEqual([
    { following_id: 2 },
    { following_id: 3 },
  ])
  const repeated = await executeDatabaseDomain(database, 'account.completePeoplePrompt', { userId: 1, people: [2] })
  expect(repeated.followed).toEqual([])
})
