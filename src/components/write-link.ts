import { activeRequest } from '../theme'

export function writeHref() {
  const url = new URL(activeRequest().url)
  return '/write?from=' + encodeURIComponent(url.pathname + url.search)
}
