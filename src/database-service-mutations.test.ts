import { expect, test } from 'bun:test'
import { configureDatabaseService, databaseService, subscribeToFeedMutations } from './database-service'

test('HTML mutations that change cached feed chrome invalidate in-memory pages', async () => {
  configureDatabaseService({ call: async () => null as never })
  const mutations: string[] = []
  const unsubscribe = subscribeToFeedMutations(operation => mutations.push(operation))

  await databaseService().call('interactions.toggleFollow', { userId: 1, handle: 'friend' })
  await databaseService().call('interactions.toggleTagFollow', { userId: 1, tag: 'topic' })
  await databaseService().call('interactions.toggleBlock', { userId: 1, handle: 'blocked' })
  await databaseService().call('interactions.toggleTagBlock', { userId: 1, tag: 'muted' })
  await databaseService().call('drafts.save', { id: null, userId: 1, parentId: null, body: 'A draft' })
  await databaseService().call('drafts.delete', { id: 'opaque-draft-id', userId: 1 })
  await databaseService().call('admin.translatePost', { id: 42, translation: 'Translated text' })
  unsubscribe()

  expect(mutations).toEqual([
    'interactions.toggleFollow',
    'interactions.toggleTagFollow',
    'interactions.toggleBlock',
    'interactions.toggleTagBlock',
    'drafts.save',
    'drafts.delete',
    'admin.translatePost',
  ])
})
