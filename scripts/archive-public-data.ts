import { db } from '../src/db'
import { createPublicArchive } from '../src/public-archive'

const path = Bun.env.PUBLIC_ARCHIVE_PATH || 'public/dump.zip'
const result = await createPublicArchive(db, path)
console.log(`public archive created: ${result.path} (${result.users} users, ${result.posts} posts, ${result.bytes} bytes)`)
db.close()
