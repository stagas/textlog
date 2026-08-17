import { db } from '../src/db'
import { runPostOgPreviewRefetch } from '../src/link-preview-backfill'

await runPostOgPreviewRefetch(db)
