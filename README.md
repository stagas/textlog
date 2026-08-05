# root.mx

Server-rendered, text-first social web app powered by Bun, SQLite, and TSX. There is no client-side JavaScript bundle: pages are composed on the backend and returned as static HTML.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. Data is stored in `storage/root.sqlite` using Bun's current `Database` API.

Run the full local quality check with `bun run check`; it performs strict TypeScript checking and the complete test suite.

## Production configuration

`bun run start` defaults to production mode and validates configuration before importing the application, opening
SQLite, running migrations, or binding the HTTP port. Copy `.env.example` and configure the deployment. Production
requires an HTTPS `APP_URL`, `RESEND_API_KEY`, valid `EMAIL_FROM`, a random `IP_PSEUDONYM_SECRET` of at least 32
characters, and `OPENAI_API_KEY` unless moderation has been
explicitly disabled. Invalid URLs, booleans, ports, retention values, database files, and storage permissions stop
startup with a combined error message that does not print secret values.

Request bodies are capped at 64 KiB globally. Form endpoints accept only URL-encoded or multipart form data and use an
8 KiB limit by default; the detailed illegal-activity report form allows 16 KiB. Oversized bodies return HTTP 413.

`DATABASE_PATH` and `DATABASE_BACKUP_DIR` must be writable. SQLite lock waits default to 5 seconds; tune the bounded
`DATABASE_BUSY_TIMEOUT_MS` setting only after measuring contention. Set `TRUST_PROXY=true` only behind a trusted proxy that
overwrites forwarded client-address headers. Development remains integration-optional through `bun run dev`.

`GET /health` acquires and immediately releases a SQLite write reservation, then reports `writeLockLatencyMs`,
`walBytes`, and `busyTimeoutMs`. It returns 503 when the write lock cannot be acquired and logs a warning when lock
latency reaches 250 ms or the WAL reaches 64 MiB. Scrape the endpoint with production monitoring and alert on failures
or sustained warnings.

Successful HTML visits are deduplicated in memory and written in transactions of at most 500 visitor-days, normally
every five seconds. Public API limits use one aggregate row per client and minute instead of one row per request.
Expired sessions, tokens, rate-limit buckets, and visitor pseudonyms are removed every five minutes in batches of 500
rows per table, keeping maintenance transactions short under load.

## Database migrations and recovery

The database schema is upgraded through ordered, transactional migrations tracked by SQLite's `user_version`.
Before upgrading an existing database, startup writes and verifies a consistent snapshot in `storage/backups`, then
checkpoints the WAL after the migration completes. A database created by a newer app version is refused rather than
being modified.

Create an additional backup at any time with:

```sh
bun run db:backup
```

Backups are private (`0600`), verified with SQLite `quick_check`, and retained locally for 14 days by default. Configure
the database path, backup directory, or retention with `DATABASE_PATH`, `DATABASE_BACKUP_DIR`, and
`DATABASE_BACKUP_RETENTION_DAYS`.

Production automatically checks once at startup and hourly thereafter for the current UTC day's local backup. It reuses
and verifies the deterministic daily snapshot when present, so application restarts cannot duplicate or skip that day's
backup. Failures are logged and retried on the next hourly check. Set the optional `BACKUP_ALERT_WEBHOOK_URL` to an HTTPS
incident-management endpoint to receive immediate failure notifications.

Once per UTC quarter the scheduler restores that day's snapshot into an isolated temporary database and verifies SQLite
integrity. Reports containing measured RPO and RTO are stored under `storage/backups/drills`. The report's presence makes
the drill restart-safe; alert operationally if a new report does not appear during the quarter. These backups remain on
the same host for now and therefore do not protect against host or disk loss.

To restore, stop every running app instance first, then run:

```sh
bun run db:restore -- storage/backups/<backup>.sqlite --confirm
bun run db:verify
```

Restore verifies the source, creates a `pre-restore` safety snapshot of the live database, safely replaces the database
and WAL sidecars, applies any newer migrations, and verifies the result. Practice the workflow without touching
production by setting `DATABASE_PATH` to a temporary file and `DATABASE_BACKUP_DIR` to a temporary directory.

Exercise concurrent reads and writes against a disposable database before changing capacity or timeout settings:

```sh
bun run db:load-test -- --workers=4 --operations=1000
```

The command creates an isolated temporary WAL database, starts multiple processes, reports latency and busy errors,
verifies every committed write, and removes the database afterward. It never opens the configured application database.

Measure the real HTTP feed routes against a seeded disposable database:

```sh
bun run stress:routes -- --posts=10000 --duration=5 --concurrency=1,10,25
```

The route stress test launches the application on an ephemeral loopback port and exercises `/hot` and `/latest` by
default. It reports requests per second, response throughput, error/status counts, and mean/p50/p95/p99/max latency.
It also reports the highest tested concurrent-client level that had no errors and met `--p95-target` (250 ms by
default). Use `--help` for dataset, route, concurrency, duration, and JSON-output options. The temporary database and
server are removed when the command exits; the configured application database is never opened.

In development, the browser automatically reloads after Bun restarts the server.

Set `OPENAI_API_KEY` in the server environment to moderate posts and replies before insertion. root.mx uses OpenAI's free Moderation endpoint with `omni-moderation-latest` and rejects submissions when moderation is unavailable.

Magic-link entry uses Resend. Set `RESEND_API_KEY`, `EMAIL_FROM` (a verified sender such as
`root.mx <hello@root.mx>`), and the public `APP_URL` (such as `https://root.mx`). Links are single-use and expire after
one hour. In development, the confirmation page displays the link directly instead of sending email. The same email
configuration powers confirmed email changes. Account security settings support individual or bulk session revocation.

`APP_URL` is also used for absolute Open Graph URLs. Each post exposes a dynamically rendered 1200×630 PNG at `/post/:id/og.png`.
When `APP_URL` uses HTTPS, authentication cookies are automatically marked `Secure` for production transport protection.

Authentication endpoints use the direct client address for rate limiting. When running behind a trusted reverse proxy
that overwrites `CF-Connecting-IP`, `X-Real-IP`, or `X-Forwarded-For`, set `TRUST_PROXY=true` to use that forwarded address.

Raw client addresses are not written to application HTTP logs or visitor-count storage. Set `IP_PSEUDONYM_SECRET` to a
random deployment secret; HMAC-based logging and analytics pseudonyms use separate purposes and rotate each UTC day.
HTTP logs display only five hexadecimal characters. Visitor pseudonyms are retained for seven days, and the seven-day
dashboard value is a visitor-day count because daily rotation intentionally prevents cross-day tracking. Configure the
deployment log collector to delete application HTTP logs after at most 14 days; the app writes logs to standard output
and cannot enforce retention in an external collector.

To temporarily disable moderation, set `MODERATION_DISABLED=true`. Remove the variable or set it to `false` to re-enable it.

## Administration

Admin access is granted by a case-insensitive email allowlist in `src/admin.ts`. The initial admin is
`gstagas@gmail.com`. Add future administrator email addresses to `ADMIN_EMAILS`; authorized accounts receive an
`admin` navigation link to the protected dashboard at `/admin`.

The dashboard contains report review, suspension and deletion controls, operational statistics, and an append-only
moderation action log. Hardcoded admin accounts cannot change their protected email or be suspended/deleted through
the moderation interface.

## Included

- Passwordless accounts with single-use magic links, hashed session tokens, and secure random cookies
- Reserved previous handles with redirects to each account's current profile
- 280-character posts with safe hashtag and mention links
- Following, global-hot, and global-latest feeds with first-run guidance
- Activity inbox for replies and @mentions
- Profiles, follow/unfollow, hashtag pages, tag follow/unfollow, and explore
- Responsive monospace interface with inline server-generated CSS
