import { UserReference } from './components/post'
import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import render from 'preact-render-to-string'
import { Profile } from './components/profile'
import { getImageUrl } from './image-storage'
import { migrations } from './migrations'
import { linkify } from './utils'

const photoKey = 'profiles/example.png'
const profile = { id: 1, handle: 'alice', email: 'alice@example.test', bio: '', photo_key: photoKey }

test('photo migration preserves existing accounts', () => {
  const db = new Database(':memory:')
  db.run("CREATE TABLE users(id INTEGER PRIMARY KEY,handle TEXT); INSERT INTO users VALUES(1,'alice')")
  migrations.find(migration => migration.name === 'profile_photos')!.up(db)
  expect(db.query('SELECT * FROM users').get()).toEqual({ id: 1, handle: 'alice', photo_key: null })
  db.close()
})

test('account editor offers photo upload before the handle and profile displays it', () => {
  const editor = render(<Profile user={profile} profile={profile} posts={[]} following={false} editing />)
  expect(editor).toContain('enctype="multipart/form-data"')
  expect(editor.indexOf('name="photo"')).toBeLessThan(editor.indexOf('name="handle"'))
  expect(editor).toContain('name="removePhoto"')
  const page = render(<Profile user={null} profile={profile} posts={[]} following={false} />)
  expect(page).toContain(`src="${getImageUrl(photoKey)}"`)
})

test('user hovercard photo appears after follow and missing photos create no image', () => {
  const options = { signedIn: true, formPrefix: 'test', mentionProfileStats: { alice: {
    notes: 0, replies: 0, followers: 0, following: 0, followingTags: 0, photoKey,
  } } }
  const html = linkify('@alice', { alice: 'Hello' }, [], undefined, undefined, '', {}, {}, options)
  expect(html).toContain(`src="${getImageUrl(photoKey)}"`)
  expect(html.indexOf('profile-photo-hover')).toBeGreaterThan(html.indexOf('<button'))
  expect(linkify('@alice', { alice: 'Hello' }, [], undefined, undefined, '', {}, {}, {
    ...options, mentionProfileStats: {},
  })).not.toContain('profile-photo-hover')
})

 test('author hovercards display photos after the follow control', () => {
  const stats = { notes: 0, replies: 0, followers: 0, following: 0, followingTags: 0, photoKey }
  for (const user of [null, { id: 2, handle: 'bob', email: 'bob@example.test', bio: '' }]) {
    const html = render(<UserReference handle="alice" noteCount={0} stats={stats} user={user} />)
    expect(html).toContain(`src="${getImageUrl(photoKey)}"`)
    expect(html.indexOf('profile-photo-hover')).toBeGreaterThan(html.indexOf(user ? '<button' : 'rel="nofollow"'))
  }
})
