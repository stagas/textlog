import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseModerationThresholds } from './moderation'

type Environment = Record<string, string | undefined>

export type StartupConfiguration = {
  appName: string
  environment: 'development' | 'test' | 'production'
  production: boolean
  devReload: boolean
  devSendEmails: boolean
  /** @deprecated Use devSendEmails. */
  devResendEmails: boolean
  emailProvider: 'resend' | 'sendgrid' | 'google'
  appUrl: string | null
  host: string
  port: number
  databasePath: string
  databaseBusyTimeoutMs: number
  backupDirectory: string
  backupRetentionDays: number
  backupAlertWebhookUrl: string | null
  trustProxy: boolean
  logColor: boolean
  logAnonymous: boolean
  logCampaign: boolean
  logUserAgent: boolean
  moderationDisabled: boolean
  moderationCategoryThresholds: string
  enableCaptchaAlways: boolean
  pistonUrl: string | null
}

const allowedEnvironments = ['development', 'test', 'production'] as const
type StartupEnvironment = StartupConfiguration['environment']

function isStartupEnvironment(value: string): value is StartupEnvironment {
  return allowedEnvironments.some(environment => environment === value)
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

function optionalHttpsUrl(env: Environment, name: string, problems: string[]) {
  const value = env[name]?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL')
    return url.toString()
  }
  catch {
    problems.push(`${name} must be an HTTPS URL without credentials`)
    return null
  }
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
  const appName = env.APP_NAME?.trim() || 'textlog'
  if (appName.length > 80 || /[\r\n<>]/.test(appName)) {
    problems.push('APP_NAME must be at most 80 characters and cannot contain markup or newlines')
  }
  const devReload = booleanValue(env, 'DEV_RELOAD', problems)
  const legacyDevResendEmails = booleanValue(env, 'DEV_RESEND_EMAILS', problems)
  const devSendEmails = booleanValue(env, 'DEV_SEND_EMAILS', problems, legacyDevResendEmails)
  const requestedEnvironment = (env.NODE_ENV || (devReload ? 'development' : 'production')).trim().toLowerCase()
  const validEnvironment = isStartupEnvironment(requestedEnvironment)
  const environment: StartupEnvironment = validEnvironment ? requestedEnvironment : 'production'
  if (!validEnvironment) {
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
      // if (environment === 'production' && parsed.protocol !== 'https:') {
      //   problems.push('APP_URL must use HTTPS in production')
      // }
      appUrl = parsed.origin
    }
    catch {
      problems.push('APP_URL must be a valid absolute HTTP or HTTPS URL')
    }
  }
  else if (environment === 'production') problems.push('APP_URL is required in production')

  const requestedEmailProvider = env.EMAIL_PROVIDER?.trim().toLowerCase() || 'resend'
  const supportedEmailProviders = ['resend', 'sendgrid', 'google'] as const
  const emailProvider = supportedEmailProviders.find(provider => provider === requestedEmailProvider) || 'resend'
  if (!supportedEmailProviders.some(provider => provider === requestedEmailProvider)) {
    problems.push('EMAIL_PROVIDER must be resend, sendgrid, or google')
  }
  const emailFromConfigured = Boolean(env.EMAIL_FROM?.trim())
  const emailCaptureConfigured = Boolean(env.EMAIL_CAPTURE_PATH?.trim())
  const providerVariables = ['RESEND_API_KEY', 'SENDGRID_API_KEY', 'GOOGLE_SMTP_USER', 'GOOGLE_SMTP_APP_PASSWORD']
  const providerConfigured = emailProvider === 'resend'
    ? Boolean(env.RESEND_API_KEY?.trim())
    : emailProvider === 'sendgrid'
    ? Boolean(env.SENDGRID_API_KEY?.trim())
    : Boolean(env.GOOGLE_SMTP_USER?.trim() && env.GOOGLE_SMTP_APP_PASSWORD?.trim())
  const emailConfigured = providerConfigured || emailFromConfigured
  if (environment === 'development' && devSendEmails && (!providerConfigured || !emailFromConfigured)) {
    problems.push(
      `credentials for EMAIL_PROVIDER=${emailProvider} and EMAIL_FROM are required when DEV_SEND_EMAILS is enabled`,
    )
  }
  if (emailCaptureConfigured && environment !== 'test') {
    problems.push('EMAIL_CAPTURE_PATH is only allowed in test')
  }
  if (emailCaptureConfigured && (providerVariables.some(name => Boolean(env[name]?.trim())) || emailFromConfigured)) {
    problems.push('EMAIL_CAPTURE_PATH cannot be combined with email provider credentials or EMAIL_FROM')
  }
  if (emailConfigured && providerConfigured !== emailFromConfigured) {
    problems.push(`credentials for EMAIL_PROVIDER=${emailProvider} and EMAIL_FROM must be configured together`)
  }
  if (emailProvider === 'google'
    && Boolean(env.GOOGLE_SMTP_USER?.trim()) !== Boolean(env.GOOGLE_SMTP_APP_PASSWORD?.trim()))
  {
    problems.push('GOOGLE_SMTP_USER and GOOGLE_SMTP_APP_PASSWORD must be configured together')
  }
  if (emailFromConfigured && !validEmailFrom(env.EMAIL_FROM!)) problems.push('EMAIL_FROM must contain a valid email')
  if (emailConfigured && !appUrl) {
    problems.push('APP_URL is required when email is configured')
  }
  if (environment === 'production' && !providerConfigured) {
    problems.push(`credentials for EMAIL_PROVIDER=${emailProvider} are required in production`)
  }
  if (environment === 'production' && !emailFromConfigured) problems.push('EMAIL_FROM is required in production')
  if (environment === 'production' && (env.IP_PSEUDONYM_SECRET?.trim().length || 0) < 32) {
    problems.push('IP_PSEUDONYM_SECRET must be at least 32 characters in production')
  }
  const r2Variables = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_PUBLIC_URL']
  if (environment === 'production') {
    for (const name of r2Variables) {
      if (!env[name]?.trim()) problems.push(`${name} is required in production`)
    }
  }
  for (const name of ['R2_ENDPOINT', 'R2_PUBLIC_URL']) {
    const value = env[name]?.trim()
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || (url.pathname !== '/' && url.pathname !== '')) throw new Error('invalid R2 URL')
    }
    catch {
      problems.push(`${name} must be an HTTPS origin without credentials, a path, query, or fragment`)
    }
  }
  const vapidValues = ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']
    .filter(name => Boolean(env[name]?.trim()))
  if (vapidValues.length > 0 && vapidValues.length < 3) {
    problems.push('VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY must be configured together')
  }
  if (env.VAPID_SUBJECT?.trim() && !/^(mailto:|https:)/.test(env.VAPID_SUBJECT.trim())) {
    problems.push('VAPID_SUBJECT must be a mailto: or HTTPS URI')
  }

  const moderationDisabled = booleanValue(env, 'MODERATION_DISABLED', problems)
  const moderationCategoryThresholds = env.MODERATION_CATEGORY_THRESHOLDS?.trim() || ''
  try {
    parseModerationThresholds(moderationCategoryThresholds)
  }
  catch (error) {
    problems.push(`MODERATION_CATEGORY_THRESHOLDS ${error instanceof Error ? error.message : 'is invalid'}`)
  }
  const enableCaptchaAlways = booleanValue(env, 'ENABLE_CAPTCHA_ALWAYS', problems)
  let pistonUrl: string | null = null
  if (env.PISTON_URL?.trim()) {
    try {
      const parsed = new URL(env.PISTON_URL.trim())
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('invalid URL')
      }
      pistonUrl = parsed.toString()
    }
    catch {
      problems.push('PISTON_URL must be an absolute HTTP or HTTPS URL without credentials')
    }
  }
  else if (environment === 'production') problems.push('PISTON_URL is required in production')
  if (!moderationDisabled && environment === 'production' && !env.OPENAI_API_KEY?.trim()) {
    problems.push('OPENAI_API_KEY is required in production unless MODERATION_DISABLED=true')
  }
  const trustProxy = booleanValue(env, 'TRUST_PROXY', problems)
  const logColor = booleanValue(env, 'LOG_COLOR', problems, true)
  const logAnonymous = booleanValue(env, 'LOG_ANONYMOUS', problems, true)
  const logCampaign = booleanValue(env, 'LOG_CAMPAIGN', problems, false)
  const logUserAgent = booleanValue(env, 'LOG_USER_AGENT', problems, true)

  const host = env.HOST?.trim() || '0.0.0.0'
  if (/\s|\//.test(host)) problems.push('HOST must be a hostname or IP address')
  const port = integerValue(env, 'PORT', 3000, 1, 65535, problems)
  const databasePath = env.DATABASE_PATH?.trim() || 'storage/textlog.sqlite'
  const databaseBusyTimeoutMs = integerValue(env, 'DATABASE_BUSY_TIMEOUT_MS', 5000, 100, 30000, problems)
  const backupDirectory = env.DATABASE_BACKUP_DIR?.trim() || 'storage/backups'
  const backupRetentionDays = integerValue(env, 'DATABASE_BACKUP_RETENTION_DAYS', 14, 1, 3650, problems)
  const backupAlertWebhookUrl = optionalHttpsUrl(env, 'BACKUP_ALERT_WEBHOOK_URL', problems)
  if (options.checkFilesystem !== false) validateStorage(databasePath, backupDirectory, problems)

  if (problems.length) throw new ConfigurationError([...new Set(problems)])
  return {
    appName,
    environment,
    production: environment === 'production',
    devReload,
    devSendEmails,
    devResendEmails: devSendEmails,
    emailProvider,
    appUrl,
    host,
    port,
    databasePath,
    databaseBusyTimeoutMs,
    backupDirectory,
    backupRetentionDays,
    backupAlertWebhookUrl,
    trustProxy,
    logColor,
    logAnonymous,
    logCampaign,
    logUserAgent,
    moderationDisabled,
    moderationCategoryThresholds,
    enableCaptchaAlways,
    pistonUrl,
  }
}
