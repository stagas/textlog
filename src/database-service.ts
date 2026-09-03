import type { DatabaseDomainInput, DatabaseDomainOperation, DatabaseDomainOutput } from './database-contract'

export interface DatabaseService {
  call<K extends DatabaseDomainOperation>(operation: K, input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
  callBackground?<K extends DatabaseDomainOperation>(operation: K,
    input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
}

let configuredService: DatabaseService | null = null
const feedMutationListeners = new Set<(operation: DatabaseDomainOperation) => void>()
const feedMutations = new Set<DatabaseDomainOperation>([
  'auth.claimInitialHandle',
  'admin.deletePost',
  'admin.translatePost',
  'admin.addTagAliases',
  'admin.removeTagAlias',
  'admin.setTagDisplayName',
  'admin.removeTagDisplayName',
  'account.updateProfile',
  'account.updateProfileFlags',
  'account.completePeoplePrompt',
  'account.delete',
  'api.createPost',
  'api.persistPostLocation',
  'api.publishDraft',
  'api.updatePost',
  'api.deletePost',
  'api.markActivitiesRead',
  'api.markAllActivitiesRead',
  'api.markLatestRead',
  'api.markAllLatestRead',
  'api.unpublishPost',
  'api.relationshipMutation',
  'api.tagRelationshipMutation',
  'api.updateBio',
  'drafts.save',
  'drafts.delete',
  'feeds.markLatestRead',
  'feeds.markPersonalizedSnapshotPageRead',
  'feeds.markRead',
  'feeds.personalizedPage',
  'interactions.toggleFollow',
  'interactions.toggleTagFollow',
  'interactions.toggleBlock',
  'interactions.toggleTagBlock',
  'posts.votePoll',
])

export function subscribeToFeedMutations(listener: (operation: DatabaseDomainOperation) => void) {
  feedMutationListeners.add(listener)
  return () => feedMutationListeners.delete(listener)
}

function notifyFeedMutation(operation: DatabaseDomainOperation, input: unknown, result: unknown) {
  if (!feedMutations.has(operation)) return
  if (operation === 'feeds.markPersonalizedSnapshotPageRead' && result === 0) return
  if (operation === 'feeds.personalizedPage') {
    const request = input as DatabaseDomainInput<'feeds.personalizedPage'>
    const page = result as DatabaseDomainOutput<'feeds.personalizedPage'>
    if (request.markRead === false || !page.timeline.some(row => row.unread)) return
  }
  for (const listener of feedMutationListeners) listener(operation)
}

export function configureDatabaseService(service: DatabaseService) {
  configuredService = {
    async call(operation, input) {
      const result = await service.call(operation, input)
      notifyFeedMutation(operation, input, result)
      return result
    },
    ...(service.callBackground
      ? {
        async callBackground(operation, input) {
          const result = await service.callBackground!(operation, input)
          notifyFeedMutation(operation, input, result)
          return result
        },
      }
      : {}),
  }
}

export function databaseService(): DatabaseService {
  if (!configuredService) throw new Error('Database service has not been configured')
  return configuredService
}

export function backgroundDatabaseCall<K extends DatabaseDomainOperation>(operation: K, input: DatabaseDomainInput<K>) {
  const service = databaseService()
  return service.callBackground ? service.callBackground(operation, input) : service.call(operation, input)
}
