import { validateStartupConfiguration } from './config'

const configuration = validateStartupConfiguration()
Bun.env.NODE_ENV = configuration.environment
Bun.env.DEV_RELOAD = String(configuration.devReload)
Bun.env.DEV_SEND_EMAILS = String(configuration.devSendEmails)
Bun.env.TRUST_PROXY = String(configuration.trustProxy)
Bun.env.LOG_COLOR = String(configuration.logColor)
Bun.env.MODERATION_DISABLED = String(configuration.moderationDisabled)
Bun.env.ENABLE_CAPTCHA_ALWAYS = String(configuration.enableCaptchaAlways)
Bun.env.HOST = configuration.host
Bun.env.PORT = String(configuration.port)
Bun.env.DATABASE_PATH = configuration.databasePath
Bun.env.DATABASE_BUSY_TIMEOUT_MS = String(configuration.databaseBusyTimeoutMs)
Bun.env.DATABASE_BACKUP_DIR = configuration.backupDirectory
Bun.env.DATABASE_BACKUP_RETENTION_DAYS = String(configuration.backupRetentionDays)
if (configuration.backupAlertWebhookUrl) Bun.env.BACKUP_ALERT_WEBHOOK_URL = configuration.backupAlertWebhookUrl
if (configuration.appUrl) Bun.env.APP_URL = configuration.appUrl
if (configuration.moderationDisabled && configuration.production) {
  console.warn('configuration warning  content moderation is disabled in production')
}

const application = await import('./app')
export default application.default
