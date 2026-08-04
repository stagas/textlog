# root.mx

Server-rendered, text-first social web app powered by Bun, SQLite, and TSX. There is no client-side JavaScript bundle: pages are composed on the backend and returned as static HTML.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. Data is stored in `storage/root.sqlite` using Bun's current `Database` API.

Run the full local quality check with `bun run check`; it performs strict TypeScript checking and the complete test suite.

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

To temporarily disable moderation, set `MODERATION_DISABLED=true`. Remove the variable or set it to `false` to re-enable it.

## Administration

Admin access is granted by a case-insensitive email allowlist in `src/admin.ts`. The initial admin is
`gstagas@gmail.com`. Add future administrator email addresses to `ADMIN_EMAILS`; authorized accounts receive an
`admin` navigation link to the protected dashboard at `/admin`.

The dashboard contains report review, suspension and deletion controls, operational statistics, and an append-only
moderation action log. Hardcoded admin accounts cannot change their protected email or be suspended/deleted through
the moderation interface.

## Included

- Accounts with secure random cookie sessions and hashed passwords
- Reserved previous handles with redirects to each account's current profile
- 280-character posts with safe hashtag and mention links
- Following, global-hot, and global-latest feeds with first-run guidance
- Activity inbox for replies and @mentions
- Profiles, follow/unfollow, hashtag pages, tag follow/unfollow, and explore
- Responsive monospace interface with inline server-generated CSS
