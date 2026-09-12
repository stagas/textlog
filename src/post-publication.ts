import { publishPost } from './api-broker'
import type { DatabaseService } from './database-service'
import { deleteImages, deleteImagesAfterCommit } from './image-storage'
import { discoverLinkPreviews } from './link-preview'
import { parseLocationQuery, resolveLocation } from './locations'
import { logError } from './log'
import { wakePostPushWorker } from './push'

export async function persistPostEnrichment(service: DatabaseService, postId: number, content: string,
  mode: 'save' | 'replace', locationErrorContext = 'location preview failed')
{
  const previews = await discoverLinkPreviews(content)
  const newKeys = previews.flatMap(preview => 'imageKey' in preview && preview.imageKey ? [preview.imageKey] : [])
  try {
    const result = await service.call('api.persistPostPreviews', { postId, mode, previews })
    await deleteImagesAfterCommit(result.obsoleteImageKeys)
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
  const query = parseLocationQuery(content)
  if (!query) {
    await service.call('api.persistPostLocation', { postId, query: null, location: null })
    return
  }
  try {
    const cached = await service.call('api.cachedLocation', { query })
    const location = cached === 'miss' ? null : cached || await resolveLocation(query)
    await service.call('api.persistPostLocation', { postId, query, location })
  }
  catch (error) {
    logError(`${locationErrorContext} post=${postId}`, error)
  }
}

export async function finalizePublishedPost(service: DatabaseService, result: { id: number; duplicate: boolean },
  content: string, locationErrorContext?: string)
{
  if (result.duplicate) return
  publishPost(result.id)
  await persistPostEnrichment(service, result.id, content, 'save', locationErrorContext)
  wakePostPushWorker(service)
}
