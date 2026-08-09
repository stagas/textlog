export function isDevelopment(
  environment = Bun.env.NODE_ENV,
  devReload = Bun.env.DEV_RELOAD,
) {
  return environment === 'development' || devReload === 'true'
}
