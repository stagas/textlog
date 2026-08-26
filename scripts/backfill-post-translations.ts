import { db } from '../src/db'
import { backfillPostTranslations } from '../src/translation'

const count = await backfillPostTranslations(db, {
  onTranslated(id) { console.log(`translated post ${id}`) },
})
console.log(`translation backfill complete (${count} posts translated)`)
