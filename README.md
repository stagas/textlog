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

`DATABASE_PATH` and `DATABASE_BACKUP_DIR` must be writable. Set `TRUST_PROXY=true` only behind a trusted proxy that
overwrites forwarded client-address headers. Development remains integration-optional through `bun run dev`.

## Database migrations and recovery

The database schema is upgraded through ordered, transactional migrations tracked by SQLite's `user_version`.
Before upgrading an existing database, startup writes and verifies a consistent snapshot in `storage/backups`, then
checkpoints the WAL after the migration completes. A database created by a newer app version is refused rather than
being modified.

Create an additional backup at any time with:

```sh
bun run db:backup
```

Backups are private (`0600`), verified with SQLite `quick_check`, and retained for 14 days by default. Configure the
database path, backup directory, or retention with `DATABASE_PATH`, `DATABASE_BACKUP_DIR`, and
`DATABASE_BACKUP_RETENTION_DAYS`. Schedule `bun run db:backup` at least daily in production and replicate the backup
directory to encrypted off-host storage; local snapshots alone do not cover host or disk loss.

To restore, stop every running app instance first, then run:

```sh
bun run db:restore -- storage/backups/<backup>.sqlite --confirm
bun run db:verify
```

Restore verifies the source, creates a `pre-restore` safety snapshot of the live database, safely replaces the database
and WAL sidecars, applies any newer migrations, and verifies the result. Practice the workflow without touching
production by setting `DATABASE_PATH` to a temporary file and `DATABASE_BACKUP_DIR` to a temporary directory.

In development, the browser automatically reloads after Bun restarts the server.

Set `OPENAI_API_KEY` in the server environment to moderate posts and replies before insertion. root.mx uses OpenAI's free Moderation endpoint with `omni-moderation-latest` and rejects submissions when moderation is unavailable.

Password reset emails use Resend. Set `RESEND_API_KEY`, `EMAIL_FROM` (a verified sender such as `root.mx <hello@root.mx>`), and the public `APP_URL` (such as `https://root.mx`). Reset links are single-use and expire after one hour.

The same email configuration powers signup verification and confirmed email changes. Verification is non-blocking, while
an email change is applied only after the one-hour link sent to the new address is opened. Account security settings also
support password changes and individual or bulk session revocation.

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

- Accounts with hashed session tokens, secure random cookies, and Argon2id passwords
- Reserved previous handles with redirects to each account's current profile
- 280-character posts with safe hashtag and mention links
- Following, global-hot, and global-latest feeds with first-run guidance
- Activity inbox for replies and @mentions
- Profiles, follow/unfollow, hashtag pages, tag follow/unfollow, and explore
- Responsive monospace interface with inline server-generated CSS
