import { expect, test } from 'bun:test'
import { cachedAnonymousPostPage, materializeAnonymousPostPage } from './anonymous-post-page-cache'
import { subscribeToFeedMutations, withFeedMutationNotifications } from './database-service'
import { cachedOgResponse, cacheOgResponse } from './og-response-cache'

test('HTML mutations that change cached feed chrome invalidate in-memory pages', async () => {
  const service = withFeedMutationNotifications({ call: async () => null as never })
  await materializeAnonymousPostPage('/post/42', new Response('stale post'))
  cacheOgResponse('post:42', new Uint8Array([42]), {})
  const mutations: string[] = []
  const unsubscribe = subscribeToFeedMutations(operation => mutations.push(operation))

  await service.call('auth.claimInitialHandle', { userId: 2, handle: 'new_user' })
  await service.call('account.completePeoplePrompt', { userId: 1, people: [2] })
  await service.call('account.select', { userId: 1, targetId: 2, sessionHash: 'session' })
  await service.call('interactions.toggleFollow', { userId: 1, handle: 'friend' })
  await service.call('interactions.toggleTagFollow', { userId: 1, tag: 'topic' })
  await service.call('interactions.toggleBlock', { userId: 1, handle: 'blocked' })
  await service.call('interactions.toggleTagBlock', { userId: 1, tag: 'muted' })
  await service.call('drafts.save', { id: null, userId: 1, parentId: null, body: 'A draft' })
  await service.call('drafts.delete', { id: 'opaque-draft-id', userId: 1 })
  await service.call('admin.moderateUser', { id: 2, actorId: 1, action: 'drop-username', note: '' })
  expect(cachedAnonymousPostPage('/post/42')).toBeNull()
  expect(cachedOgResponse('post:42')).toBeNull()
  await materializeAnonymousPostPage('/post/42', new Response('stale post'))
  cacheOgResponse('post:42', new Uint8Array([42]), {})
  await service.call('admin.deletePost', { id: 42, actorId: 1, note: '' })
  expect(cachedAnonymousPostPage('/post/42')).toBeNull()
  expect(cachedOgResponse('post:42')).toBeNull()
  await service.call('admin.translatePost', { id: 42, translation: 'Translated text' })
  await service.call('admin.addTagInvariant', { tag: 'status' })
  await service.call('admin.removeTagInvariant', { tag: 'status' })
  unsubscribe()

  expect(mutations).toEqual([
    'auth.claimInitialHandle',
    'account.completePeoplePrompt',
    'account.select',
    'interactions.toggleFollow',
    'interactions.toggleTagFollow',
    'interactions.toggleBlock',
    'interactions.toggleTagBlock',
    'drafts.save',
    'drafts.delete',
    'admin.moderateUser',
    'admin.deletePost',
    'admin.translatePost',
    'admin.addTagInvariant',
    'admin.removeTagInvariant',
  ])
})
