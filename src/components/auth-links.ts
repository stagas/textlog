import { activeRequest } from '../theme'

export function enterHref() {
  const url = new URL(activeRequest().url)
  return `/enter?next=${encodeURIComponent(url.pathname + url.search)}`
}
