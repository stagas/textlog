import type { LocationView, PostView } from '../types'

export type NotificationBanner = false | 'notifications' | 'appearance' | 'invite' | 'bio'
  | 'notification-update' | 'donate'

export type FeedComposerProps = {
  expandedRootId?: number
  writeError?: string
  writeBody?: string
  writePreview?: boolean
  writePreviewExecutionOutput?: string | null
  writePreviewLocation?: LocationView
  writeDraftId?: string
}

export type FeedChunkProps = {
  chunk?: number
  initialChunks?: number
  fetchedThread?: PostView[]
}

export type SharedFeedPageProps = FeedComposerProps & FeedChunkProps & {
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: NotificationBanner
}
