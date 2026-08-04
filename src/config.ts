import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type Environment = Record<string, string | undefined>

export type StartupConfiguration = {
  environment: 'development' | 'test' | 'production'
  production: boolean
  devReload: boolean
  appUrl: string | null
  host: string
  port: number
  databasePath: string
  backupDirectory: string
  backupRetentionDays: number
  trustProxy: boolean
  logColor: boolean
  moderationDisabled: boolean
}

export class ConfigurationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid startup configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigurationError'
  }
}

function booleanValue(env: Environment, name: string, problems: string[], fallback = false) {
  const value = env[name]
  if (value === undefined || value.trim() === '') return fallback
  if (['1', 'true', 'yes'].includes(value.trim().toLowerCase())) return true
  if (['0', 'false', 'no'].includes(value.trim().toLowerCase())) return false
  problems.push(`${name} must be true or false`)
  return fallback
}

function integerValue(env: Environment, name: string, fallback: number, minimum: number, maximum: number,
  problems: string[])
{
  const value = env[name]
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    problems.push(`${name} must be an integer from ${minimum} to ${maximum}`)
    return fallback
  }
  return parsed
}

function validEmailFrom(value: string) {
  const email = value.match(/<([^<>]+)>\s*$/)?.[1] || value
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function ensureDirectory(path: string, label: string, problems: string[]) {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    if (!statSync(path).isDirectory()) throw new Error('not a directory')
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK)
  }
  catch {
    problems.push(`${label} must be a readable and writable directory`)
  }
}

function validateStorage(databasePath: string, backupDirectory: string, problems: string[]) {
  const resolvedDatabase = resolve(databasePath)
  const resolvedBackup = resolve(backupDirectory)
  ensureDirectory(dirname(resolvedDatabase), 'DATABASE_PATH parent', problems)
  ensureDirectory(resolvedBackup, 'DATABASE_BACKUP_DIR', problems)
  if (resolvedDatabase === resolvedBackup) problems.push('DATABASE_PATH must not be the backup directory')
  if (existsSync(resolvedDatabase)) {
    try {
      if (!statSync(resolvedDatabase).isFile()) throw new Error('not a file')
      accessSync(resolvedDatabase, constants.R_OK | constants.W_OK)
    }
    catch {
      problems.push('DATABASE_PATH must be a readable and writable file')
    }
  }
}

export function validateStartupConfiguration(env: Environment = Bun.env, options: {
  checkFilesystem?: boolean
} = {}): StartupConfiguration {
  const problems: string[] = []
  const devReload = booleanValue(env, 'DEV_RELOAD', problems)
  const requestedEnvironment = (env.NODE_ENV || (devReload ? 'development' : 'production')).trim().toLowerCase()
  const allowedEnvironments = ['development', 'test', 'production'] as const
  const environment = allowedEnvironments.includes(requestedEnvironment as any)
    ? requestedEnvironment as StartupConfiguration['environment']
    : 'production'
  if (!allowedEnvironments.includes(requestedEnvironment as any)) {
    problems.push('NODE_ENV must be development, test, or production')
  }
  if (environment === 'production' && devReload) problems.push('DEV_RELOAD cannot be enabled in production')

  let appUrl: string | null = null
  if (env.APP_URL?.trim()) {
    try {
      const parsed = new URL(env.APP_URL.trim())
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
      if (parsed.username || parsed.password) problems.push('APP_URL must not include credentials')
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        problems.push('APP_URL must be an origin without a path, query, or fragment')
      }
      if (environment === 'production' && parsed.protocol !== 'https:') {
        problems.push('APP_URL must use HTTPS in production')
      }
      appUrl = parsed.origin
    }
    catch {
      problems.push('APP_URL must be a valid absolute HTTP or HTTPS URL')
    }
  }
  else if (environment === 'production') problems.push('APP_URL is required in production')

  const resendConfigured = Boolean(env.RESEND_API_KEY?.trim())
  const emailFromConfigured = Boolean(env.EMAIL_FROM?.trim())
  const emailCaptureConfigured = Boolean(env.EMAIL_CAPTURE_PATH?.trim())
  if (emailCaptureConfigured && environment !== 'test') {
    problems.push('EMAIL_CAPTURE_PATH is only allowed in test')
  }
  if (emailCaptureConfigured && (resendConfigured || emailFromConfigured)) {
    problems.push('EMAIL_CAPTURE_PATH cannot be combined with RESEND_API_KEY or EMAIL_FROM')
  }
  if (resendConfigured !== emailFromConfigured) {
    problems.push('RESEND_API_KEY and EMAIL_FROM must be configured together')
  }
  if (emailFromConfigured && !validEmailFrom(env.EMAIL_FROM!)) problems.push('EMAIL_FROM must contain a valid email')
  if ((resendConfigured || emailFromConfigured) && !appUrl) problems.push('APP_URL is required when email is configured')
  if (environment === 'production' && !resendConfigured) problems.push('RESEND_API_KEY is required in production')
  if (environment === 'production' && !emailFromConfigured) problems.push('EMAIL_FROM is required in production')

  const moderationDisabled = booleanValue(env, 'MODERATION_DISABLED', problems)
  if (!moderationDisabled && environment === 'production' && !env.OPENAI_API_KEY?.trim()) {
    problems.push('OPENAI_API_KEY is required in production unless MODERATION_DISABLED=true')
  }
  const trustProxy = booleanValue(env, 'TRUST_PROXY', problems)
  const logColor = booleanValue(env, 'LOG_COLOR', problems, true)

  const host = env.HOST?.trim() || '0.0.0.0'
  if (/\s|\//.test(host)) problems.push('HOST must be a hostname or IP address')
  const port = integerValue(env, 'PORT', 3000, 1, 65535, problems)
  const databasePath = env.DATABASE_PATH?.trim() || 'storage/root.sqlite'
  const backupDirectory = env.DATABASE_BACKUP_DIR?.trim() || 'storage/backups'
  const backupRetentionDays = integerValue(env, 'DATABASE_BACKUP_RETENTION_DAYS', 14, 1, 3650, problems)
  if (options.checkFilesystem !== false) validateStorage(databasePath, backupDirectory, problems)

  if (problems.length) throw new ConfigurationError([...new Set(problems)])
  return {
    environment,
    production: environment === 'production',
    devReload,
    appUrl,
    host,
    port,
    databasePath,
    backupDirectory,
    backupRetentionDays,
    trustProxy,
    logColor,
    moderationDisabled,
  }
}
