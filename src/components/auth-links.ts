import { activeRequest } from '../theme'

export function enterHref() {
  const url = new URL(activeRequest().url)
  return `/enter?next=${encodeURIComponent(url.pathname + url.search)}`
}

export function pendingFollowHref(kind: 'user' | 'tag', target: string, returnPath?: string) {
  const url = new URL(activeRequest().url)
  const from = returnPath || url.pathname + url.search
  return `/pending-follow/${kind}/${encodeURIComponent(target)}?from=${encodeURIComponent(from)}`
}
