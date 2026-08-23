import { createHash } from 'node:crypto'

export function activityAnchor(eventKey: string) {
  const fingerprint = createHash('sha256').update(eventKey).digest('base64url').slice(0, 12)
  return `a-${fingerprint}`
}
