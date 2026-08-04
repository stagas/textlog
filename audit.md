## Audit outcome

root.mx is technically stronger than most early-stage social products: compact architecture, good privacy defaults, transactional migrations, recovery tooling, and meaningful tests. I found no confirmed critical vulnerability, and both `bun run check` and `bun audit` pass.

The larger risk is commercial: it is a well-built generic microblog without a sufficiently sharp audience, activation loop, retention measurement, or revenue model. Before adding major features, align the product around “calm public thinking” and harden the few endpoints that could become operational liabilities.

## Technical priorities

| Priority | Finding | Recommendation |
|---|---|---|
| P0 | Form bodies are fully parsed without an application-level size limit in [shared.tsx](</media/stagas/buba/work/stagas/root-mx/src/routes/shared.tsx:98>). | Enforce global and route-specific body limits, validate content types, and return `413`. OWASP explicitly recommends limiting total request size to prevent resource exhaustion. [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html) |
| P0 | Open Graph images are CPU-rendered on every origin request. Tests show roughly 130–310 ms per render, and routes such as [posts.tsx](</media/stagas/buba/work/stagas/root-mx/src/routes/posts.tsx:56>) are unauthenticated. | Pre-render on create/edit, cache in memory or disk, and add edge caching/rate limits. |
| P0 | Admin authority is a password-only, hardcoded email allowlist in [admin.ts](</media/stagas/buba/work/stagas/root-mx/src/admin.ts:5>). A compromised account controls users and content. | Require WebAuthn/TOTP for administrators, step-up authentication for destructive actions, and move roles into configuration or the database. OWASP recommends mandatory MFA for privileged users. [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) |
| P0 | Backups are implemented well but scheduling and off-host replication remain manual, as documented in [README.md](</media/stagas/buba/work/stagas/root-mx/README.md:35>). | Automate daily encrypted off-host backups, alert on failures, and schedule quarterly restore drills with measured RPO/RTO. |
| P1 | Every successful HTML view performs visitor-table maintenance in [app.tsx](</media/stagas/buba/work/stagas/root-mx/src/app.tsx:29>), while each API request writes a rate-limit row. Cleanup is mostly startup-only. | Buffer visitor updates, use time buckets instead of one row per API request, and run periodic bounded cleanup. This will delay SQLite write contention substantially. |
| P1 | Production SQLite enables WAL but not `busy_timeout` in [db.ts](</media/stagas/buba/work/stagas/root-mx/src/db.ts:5>). | Add a bounded busy timeout, monitor lock latency and WAL size, and load-test mixed reads/writes. SQLite WAL remains a same-host design and can still return `SQLITE_BUSY`. [SQLite WAL documentation](https://www.sqlite.org/wal.html) |
| P1 | Full recursive threads are queried and rendered without pagination or a depth/size ceiling in [post.tsx](</media/stagas/buba/work/stagas/root-mx/src/components/post.tsx:111>). | Paginate branches, cap initial depth and reply count, and add “continue thread” links. |
| P1 | The firehose is process-local and only limited per IP. The broker is an in-memory `Set` in [api-broker.ts](</media/stagas/buba/work/stagas/root-mx/src/api-broker.ts:1>). | Add a global connection ceiling and replay cursor, or remove/gate it until real consumers exist. It will miss events across restarts or multiple processes. |
| P1 | Illegal-report decisions store no deciding administrator and email delivery failures are merely logged in [admin.tsx](</media/stagas/buba/work/stagas/root-mx/src/routes/admin.tsx:68>). | Record actor, reason, policy basis, notification state and appeal status; use a retryable transactional email outbox. Ask counsel which DSA duties apply at the company’s size. The Commission highlights clear reasons and internal challenges as important platform controls. [European Commission guidance](https://digital-strategy.ec.europa.eu/en/factpages/user-rights-under-digital-services-act) |
| P2 | All HTML uses `Cache-Control: no-cache`; sensitive pages are not explicitly `private, no-store`, while public pages cannot benefit from intentional caching. | Split response policies: `private, no-store` for account/auth/admin/token pages; short public caching or ETags for anonymous feeds and profiles. |
| P2 | Latest/profile feeds use offset pagination, Explore uses `ORDER BY RANDOM()`, and the hot API performs an N+1 reply-count query. | Move to cursor pagination, deterministic candidate sampling, and batched reply counts before traffic grows. |

Operationally, add structured JSON logs, error reporting, latency/error-rate metrics, disk/WAL/backup alarms, graceful shutdown, and separate liveness/readiness checks. `/health` currently proves only that `SELECT 1` works.

Testing is good but uneven: 105 tests pass, while instrumented coverage reports 59.85% of lines. The subprocess integration test is not represented fully in that number, but many page and route branches remain lightly exercised. Add browser-level accessibility checks, concurrency/load tests, backup-failure tests, body-limit tests, and moderation/email outage scenarios.

## Product and business direction

The best positioning is not “another small Twitter.” The existing no-JavaScript UI, RSS/Atom, public API, IRC link, data export and monospace aesthetic naturally support:

> A calm public thinking log for independent builders and small technical communities.

That is specific enough to guide distribution and monetization without abandoning the current personality.

There is also a product contradiction to resolve. The About page promises “no pressure to build an audience” in [about.tsx](</media/stagas/buba/work/stagas/root-mx/src/components/about.tsx:18>), but profiles expose follower counts and the default discovery surface is engagement-ranked. Meanwhile, “for you” is simply content from followed users and hashtags, as shown in [feeds.tsx](</media/stagas/buba/work/stagas/root-mx/src/routes/feeds.tsx:49>).

### Add next

- Rename “for you” to “following.”
- Add a compact guest value proposition and join CTA above the public feed.
- Improve activation: select interests, follow three people/tags, verify email, then receive a writing prompt.
- Add private bookmarks and mute controls. Both reinforce quiet utility without adding public performance metrics.
- Add people/hashtag search before algorithmic recommendations.
- Add unread activity state and an optional weekly reply/mention digest.
- Introduce curated starter packs or weekly themes; this is more valuable in a small network than random people and globally popular tags.
- Add a transparent moderation status and appeal workflow.
- Add sitemap/robots metadata and stronger profile/feed discovery.

### Remove or defer

- Hide public follower counts, or at least test their removal.
- Remove “hot” as the guest default until the network has enough activity; use “community” or “conversations” with spam-resistant ranking.
- Gate or temporarily remove the public firehose unless someone is demonstrably using it.
- Do not add likes, reposts, media uploads, DMs or follower-growth tooling; they conflict with the positioning and expand moderation cost.
- Do not implement ActivityPub yet. Federation brings authentication, spam, recursive-object and denial-of-service responsibilities explicitly recognized by the standard. [ActivityPub security considerations](https://www.w3.org/TR/activitypub/)
- Replace the generic donation link with a real supporter proposition.

## Revenue model

Avoid advertising. A small supporter plan is more aligned:

- Keep posting, reading, follows, RSS and export free.
- Charge for custom domains, profile themes, scheduled notes, write API/webhooks, expanded archive search and automated personal backups.
- Later, offer hosted private or public micro-communities only after the core network shows retention.

Start with a single supporter tier and an annual option. Validate willingness to pay before building billing-heavy functionality.

## Metrics that matter

The current dashboard measures traffic and content volume, but not whether the product creates lasting conversations. Track privacy-conscious aggregate funnels:

- Activation: verified email + three follows/tags + first note within 24 hours.
- Percentage of first notes receiving a reply within 48 hours.
- Weekly active writers and four-week writer retention.
- Reply reciprocation and conversations per active writer.
- Explore-to-follow conversion.
- Report rate, moderation response time and reversed decisions.
- Supporter conversion and churn.

The north-star metric should be **weekly active writers who receive or give a meaningful reply**, not visits or total posts.

## Recommended 90-day sequence

1. First 30 days: body limits, OG caching, admin MFA, backup automation, observability, metric events, and feed naming.
2. Days 31–60: onboarding, search, bookmarks, mute, unread activity and curated starter packs.
3. Days 61–90: test follower-count removal, launch a supporter offer, and evaluate retention before approving federation, media, or community hosting.

No files were changed during this audit.
