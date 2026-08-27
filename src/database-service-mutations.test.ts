import { expect, test } from 'bun:test'
import { configureDatabaseService, databaseService, subscribeToFeedMutations } from './database-service'

test('HTML relationship toggles invalidate in-memory personalized feeds', async () => {
  configureDatabaseService({ call: async () => null as never })
  const mutations: string[] = []
  const unsubscribe = subscribeToFeedMutations(operation => mutations.push(operation))

  await databaseService().call('interactions.toggleFollow', { userId: 1, handle: 'friend' })
  await databaseService().call('interactions.toggleTagFollow', { userId: 1, tag: 'topic' })
  await databaseService().call('interactions.toggleBlock', { userId: 1, handle: 'blocked' })
  await databaseService().call('interactions.toggleTagBlock', { userId: 1, tag: 'muted' })
  unsubscribe()

  expect(mutations).toEqual([
    'interactions.toggleFollow',
    'interactions.toggleTagFollow',
    'interactions.toggleBlock',
    'interactions.toggleTagBlock',
  ])
})
