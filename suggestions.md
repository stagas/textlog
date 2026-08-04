## Verdict

root.mx is a strong, unusually coherent prototype: fast, distinctive, privacy-conscious, accessible, and technically disciplined. It is ready for a controlled beta, but not yet for broad public growth. The largest gaps are identity security, operational recovery, moderation/legal workflows, and a sharper go-to-market thesis—not the interface.

## What is already strong

- Excellent product restraint: text-only, no client bundle, no likes/reposts/view counts.
- Cohesive desktop and mobile design with a memorable terminal-like identity.
- Good security baseline: Argon2id, same-origin POST protection, hardened cookies and headers, rate limits, session controls.
- Thoughtful community tooling: replies, mentions, tag follows, blocks, reports, admin audit log, export and deletion.
- Strong public-web capabilities: semantic HTML, canonical URLs, Open Graph images, API and live stream.
- Healthy quality bar: strict TypeScript and all 70 tests passed.
- The local data appears largely seeded, so it cannot yet support retention or engagement conclusions.

## Prioritized technical work

| Priority | Recommendation | Reason |
|---|---|---|
| Immediate | Update Hono and rerun checks | `bun audit` reports one moderate vulnerability affecting versions below 4.12.34. Exploitability may be limited because the app does not appear to use Hono’s CORS helper, but the dependency should still be updated. See [package.json](/home/stagas/work/stagas/root-mx/package.json:13) and the [advisory](https://github.com/advisories/GHSA-8j4g-w8fx-2239). |
| Immediate | Reserve previous handles and redirect them | A handle can currently be changed and immediately claimed by somebody else, breaking old profile links and enabling impersonation. Add immutable user identifiers plus a `handle_history` table, redirects, and a change cooldown. See [account.tsx](/home/stagas/work/stagas/root-mx/src/routes/account.tsx:25). |
| Immediate | Protect privileged accounts | Admin authorization is based on a hardcoded email, without MFA or a verified-email requirement. Add WebAuthn/TOTP for admins, recovery codes, and explicit database roles. See [admin.ts](/home/stagas/work/stagas/root-mx/src/admin.ts:4). |
| Immediate | Hash session tokens in storage | Session cookies are strong, but their raw values are stored and queried directly, so a database leak becomes an immediate account takeover. Store only SHA-256/HMAC token hashes. See [utils.ts](/home/stagas/work/stagas/root-mx/src/utils.ts:16). |
| Immediate | Make email confirmation scanner-safe | `/verify-email` mutates account state on GET. Email security scanners can therefore confirm an email change before the user does. GET should show a confirmation page; a same-origin POST should apply it. See [account.tsx](/home/stagas/work/stagas/root-mx/src/routes/account.tsx:138). |
| Before launch | Introduce versioned migrations and recovery | Schema upgrades and cleanup currently execute during application boot. Add numbered migrations, pre-migration backups, restore drills, WAL checkpointing, and documented retention. See [db.ts](/home/stagas/work/stagas/root-mx/src/db.ts:4). |
| Before launch | Add CI and route-level integration tests | The unit coverage is good, but the most consequential flows—signup, login, verification, password reset, posting, reports and admin actions—lack end-to-end HTTP tests against an isolated database. |
| Before launch | Validate production configuration on startup | Fail startup when production lacks or misconfigures `APP_URL`, email credentials, moderation configuration, database storage, proxy settings or backup destination. The current health endpoint only runs `SELECT 1`; see [server.tsx](/home/stagas/work/stagas/root-mx/src/server.tsx:78). |
| Next | Require verification before public posting | Signup succeeds even if verification delivery fails. Let users browse and complete profiles, but require a confirmed address before public publication. See [auth.tsx](/home/stagas/work/stagas/root-mx/src/routes/auth.tsx:130). |
| Next | Remove moderation as a single availability dependency | Every post currently fails closed if OpenAI moderation is unavailable. Consider pending review for new users, trusted-user fallback, retries, and an operator-visible queue. See [moderation.ts](/home/stagas/work/stagas/root-mx/src/moderation.ts:5). |
| At scale | Materialize the hot score and use cursor pagination | The recursive hot-feed query traverses the post graph on every request and uses offsets. It will become an early bottleneck as threads grow. See [hot.ts](/home/stagas/work/stagas/root-mx/src/hot.ts:38). |
| At scale | Externalize live events only if needed | The firehose broker and connection counters are process-local, so horizontal instances produce incomplete streams and inconsistent limits. See [api-broker.ts](/home/stagas/work/stagas/root-mx/src/api-broker.ts:1). |

Also add a login rate-limit bucket keyed by account as well as IP; the current login limit is IP-only.

## Trust and legal readiness

The current contact address is explicitly placeholder-like—“42 Quiet Street”—and should be removed or replaced before launch. See [contact.tsx](/home/stagas/work/stagas/root-mx/src/components/contact.tsx:17).

The combined legal page is too thin for an EU-based social service. A privacy notice should identify the controller, purposes and legal bases, retention, processors such as Resend/OpenAI, international transfers, user rights, and the relevant supervisory authority. Those are among the disclosures described by the [European Commission’s GDPR guidance](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/what-information-must-be-given-individuals-whose-data-collected_en). The current page provides only a short general paragraph; see [legal.tsx](/home/stagas/work/stagas/root-mx/src/components/legal.tsx:34).

The report flow requires an account and accepts only a category. An EU launch should obtain counsel on a DSA-compatible illegal-content notice flow that can accept substantiated details from non-members and communicate receipt, decision and redress. [Article 16 of the DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32022R2065) describes those requirements. The current implementation is in [interactions.tsx](/home/stagas/work/stagas/root-mx/src/routes/interactions.tsx:62).

Finally, raw IPs are written to HTTP logs and a stable unsalted IP hash is retained for visitor counts. Use keyed, rotating pseudonyms, define log retention, and disclose the processing.

## Product and business recommendations

The natural market is not “everyone leaving mainstream social media.” The design, name, GitHub link, monospace presentation, API and firehose point much more sharply toward developers, writers, indie-web users and small creative communities. Position it as something like:

> A quiet, text-only public notebook for the small web.

That is more ownable than “a quieter social network.”

The highest-leverage product changes would be:

- Add a short guest-only value proposition and CTA above the homepage feed. Currently visitors land directly in content and must visit About to understand why root.mx exists.
- Rename “for you” to “following” or “home”; it is a chronological follow/tag feed, and “for you” carries algorithmic baggage that conflicts with the brand.
- Rename “hot” to “active” or “conversations.” Keep the discovery benefit without performance-oriented language.
- Make onboarding deterministic: choose a few interests, follow three relevant accounts, then write a first note. Random people plus globally popular tags is weak for activation.
- Add search, RSS feeds for users/tags, mute controls and private bookmarks. These fit the quiet/public-web thesis.
- Consider an opt-in daily or weekly activity digest rather than real-time notifications.
- Launch through invited cohorts with an existing relationship—small developer communities, writing groups, local creative scenes. Conversation density matters much more than total registrations.

Measure:

- Signup → verified-email conversion.
- Percentage following at least three accounts/tags.
- First note within 24 hours.
- First reciprocal reply within seven days.
- Four-week retained writers and conversational users.

## Additions and removals

Keep avoiding likes, reposts, public view counts, streaks, infinite scrolling and promoted ranking. Those would erase the clearest differentiation.

Defer DMs and ActivityPub federation: both add substantial abuse, privacy and moderation surface area. RSS delivers much of the open-web value at far lower cost.

Unless developers are the primary customer, consider removing or hiding the firehose during beta. It offers little activation value, increases scraping and operational exposure, and is more advanced than the current onboarding and trust infrastructure.

For monetization, donations are suitable if this is intentionally a public-good project. If it should become a business, use an aligned supporter subscription—custom themes/domain, archive tools, private organizational features, and higher API limits—without selling reach or feed placement.

No repository files were changed during this review.
