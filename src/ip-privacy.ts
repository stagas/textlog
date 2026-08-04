import { createHmac, randomBytes } from 'node:crypto'

const ephemeralSecret = randomBytes(32).toString('hex')

function rotationDay(at: Date) {
  return at.toISOString().slice(0, 10)
}

export function ipPseudonym(address: string, purpose: 'http-log' | 'visitor-count', at = new Date(),
  secret = Bun.env.IP_PSEUDONYM_SECRET || ephemeralSecret)
{
  if (!address || address === '-') return '-'
  return createHmac('sha256', secret)
    .update(`root.mx\0${purpose}\0${rotationDay(at)}\0${address}`)
    .digest('hex')
}

export function logIpPseudonym(address: string, at = new Date()) {
  const digest = ipPseudonym(address, 'http-log', at)
  return digest === '-' ? digest : digest.slice(0, 5)
}
