import { expect, test } from 'bun:test'
import { cachedAnonymousPostPage, materializeAnonymousPostPage } from './anonymous-post-page-cache'
import { configureDatabaseService, databaseService, subscribeToFeedMutations } from './database-service'
import { cachedOgResponse, cacheOgResponse } from './og-response-cache'

test('HTML mutations that change cached feed chrome invalidate in-memory pages', async () => {
  configureDatabaseService({ call: async () => null as never })
  await materializeAnonymousPostPage('/post/42', new Response('stale post'))
  cacheOgResponse('post:42', new Uint8Array([42]), {})
  const mutations: string[] = []
  const unsubscribe = subscribeToFeedMutations(operation => mutations.push(operation))

  await databaseService().call('auth.claimInitialHandle', { userId: 2, handle: 'new_user' })
  await databaseService().call('account.completePeoplePrompt', { userId: 1, people: [2] })
  await databaseService().call('interactions.toggleFollow', { userId: 1, handle: 'friend' })
  await databaseService().call('interactions.toggleTagFollow', { userId: 1, tag: 'topic' })
  await databaseService().call('interactions.toggleBlock', { userId: 1, handle: 'blocked' })
  await databaseService().call('interactions.toggleTagBlock', { userId: 1, tag: 'muted' })
  await databaseService().call('drafts.save', { id: null, userId: 1, parentId: null, body: 'A draft' })
  await databaseService().call('drafts.delete', { id: 'opaque-draft-id', userId: 1 })
  await databaseService().call('admin.deletePost', { id: 42, actorId: 1, note: '' })
  expect(cachedAnonymousPostPage('/post/42')).toBeNull()
  expect(cachedOgResponse('post:42')).toBeNull()
  await databaseService().call('admin.translatePost', { id: 42, translation: 'Translated text' })
  unsubscribe()

  expect(mutations).toEqual([
    'auth.claimInitialHandle',
    'account.completePeoplePrompt',
    'interactions.toggleFollow',
    'interactions.toggleTagFollow',
    'interactions.toggleBlock',
    'interactions.toggleTagBlock',
    'drafts.save',
    'drafts.delete',
    'admin.deletePost',
    'admin.translatePost',
  ])
})
