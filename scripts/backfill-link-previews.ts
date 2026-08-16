import { db } from '../src/db'
import { runLinkPreviewBackfill } from '../src/link-preview-backfill'

await runLinkPreviewBackfill(db, { directImagesOnly: process.argv.includes('--direct-images') })
