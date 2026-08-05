import type { User } from '../db'
import { ErrorPage } from './error-page'

export function NotFound({ user }: { user: User | null }) {
  return <ErrorPage user={user} status={404} />
}
