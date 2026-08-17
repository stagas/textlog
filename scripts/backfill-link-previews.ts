import { db } from '../src/db'
import { runBioLinkPreviewBackfill, runLinkPreviewBackfill, runPostOgPreviewRefetch } from '../src/link-preview-backfill'

await runLinkPreviewBackfill(db, {
  directImagesOnly: process.argv.includes('--direct-images'),
  youtubeOnly: process.argv.includes('--youtube'),
})
await runBioLinkPreviewBackfill(db)
await runPostOgPreviewRefetch(db)
