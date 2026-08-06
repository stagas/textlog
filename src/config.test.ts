import { describe, expect, test } from 'bun:test'
import { ConfigurationError, validateStartupConfiguration } from './config'

const production = {
  NODE_ENV: 'production',
  APP_URL: 'https://textlog.cc',
  RESEND_API_KEY: 'configured-secret',
  EMAIL_FROM: 'textlog <hello@textlog.cc>',
  OPENAI_API_KEY: 'configured-secret',
  IP_PSEUDONYM_SECRET: 'configured-secret-at-least-32-characters',
}

describe('startup configuration', () => {
  test('accepts a complete production configuration and normalizes its public origin', () => {
    const config = validateStartupConfiguration({ ...production, APP_URL: 'https://textlog.cc/' }, {
      checkFilesystem: false,
    })

    expect(config).toMatchObject({ production: true, appUrl: 'https://textlog.cc', host: '0.0.0.0', port: 3000,
      databaseBusyTimeoutMs: 5000, backupRetentionDays: 14, moderationDisabled: false })
  })

  test('reports all missing production integrations without exposing values', () => {
    expect(() => validateStartupConfiguration({ NODE_ENV: 'production' }, { checkFilesystem: false }))
      .toThrow(ConfigurationError)
    try {
      validateStartupConfiguration({ NODE_ENV: 'production' }, { checkFilesystem: false })
    }
    catch (error) {
      const message = String(error)
      expect(message).toContain('APP_URL is required')
      expect(message).toContain('RESEND_API_KEY is required')
      expect(message).toContain('EMAIL_FROM is required')
      expect(message).toContain('OPENAI_API_KEY is required')
      expect(message).toContain('IP_PSEUDONYM_SECRET must be at least 32 characters')
    }
  })

  test('rejects unsafe URLs, conflicting modes, malformed booleans, and invalid numeric settings', () => {
    expect(() =>
      validateStartupConfiguration({
        ...production,
        APP_URL: 'http://user:pass@textlog.cc/private?token=secret',
        DEV_RELOAD: 'true',
        TRUST_PROXY: 'sometimes',
        PORT: '70000',
        DATABASE_BUSY_TIMEOUT_MS: '60000',
        DATABASE_BACKUP_RETENTION_DAYS: '0',
        BACKUP_ALERT_WEBHOOK_URL: 'http://user:pass@example.com',
      }, { checkFilesystem: false })
    ).toThrow('Invalid startup configuration')
  })

  test('keeps integrations optional in development but rejects partial email configuration', () => {
    expect(validateStartupConfiguration({ NODE_ENV: 'development' }, { checkFilesystem: false }))
      .toMatchObject({ production: false, appUrl: null, devResendEmails: false })
    expect(() =>
      validateStartupConfiguration({ NODE_ENV: 'development', RESEND_API_KEY: 'only-one' }, {
        checkFilesystem: false,
      })
    ).toThrow('RESEND_API_KEY and EMAIL_FROM must be configured together')
    expect(() =>
      validateStartupConfiguration({ NODE_ENV: 'development', DEV_RESEND_EMAILS: 'true' }, {
        checkFilesystem: false,
      })
    ).toThrow('RESEND_API_KEY and EMAIL_FROM are required when DEV_RESEND_EMAILS is enabled')
    expect(validateStartupConfiguration({
      NODE_ENV: 'development',
      DEV_RESEND_EMAILS: 'true',
      APP_URL: 'http://localhost:3000',
      RESEND_API_KEY: 'configured-secret',
      EMAIL_FROM: 'textlog <hello@textlog.cc>',
    }, { checkFilesystem: false }).devResendEmails).toBe(true)
  })

  test('allows captured email only in isolated tests', () => {
    expect(validateStartupConfiguration({ NODE_ENV: 'test', EMAIL_CAPTURE_PATH: '/tmp/textlog-mail.jsonl' }, {
      checkFilesystem: false,
    }).environment).toBe('test')
    expect(() =>
      validateStartupConfiguration({
        NODE_ENV: 'development',
        EMAIL_CAPTURE_PATH: '/tmp/textlog-mail.jsonl',
      }, { checkFilesystem: false })
    ).toThrow('EMAIL_CAPTURE_PATH is only allowed in test')
    expect(() =>
      validateStartupConfiguration({
        NODE_ENV: 'test',
        EMAIL_CAPTURE_PATH: '/tmp/textlog-mail.jsonl',
        RESEND_API_KEY: 'configured-secret',
        EMAIL_FROM: 'textlog <hello@textlog.cc>',
      }, { checkFilesystem: false })
    ).toThrow('EMAIL_CAPTURE_PATH cannot be combined')
  })

  test('allows an explicit production moderation bypass', () => {
    const { OPENAI_API_KEY: _, ...withoutModerationKey } = production
    expect(validateStartupConfiguration({ ...withoutModerationKey, MODERATION_DISABLED: 'true' }, {
      checkFilesystem: false,
    }).moderationDisabled).toBe(true)
  })
})
