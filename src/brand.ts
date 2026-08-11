export const appName = () => Bun.env.APP_NAME?.trim() || 'textlog'

export const appIdentifier = () => appName().toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'app'

export const sessionCookieName = () => appIdentifier()

export const clientIpHeaderName = () => `x-${appIdentifier()}-client-ip`

export const appOrigin = () => Bun.env.APP_URL?.trim().replace(/\/$/, '') || ''

export const appHost = () => {
  const origin = appOrigin()
  return origin ? new URL(origin).host : appName()
}

export const appHostname = () => {
  const origin = appOrigin()
  return origin ? new URL(origin).hostname : 'invalid.local'
}
