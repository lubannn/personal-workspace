# Personal Workspace auth edge

This Worker was introduced in two deliberately separate stages.

## Current stage: GitHub App OAuth live

- Canonical Cloudflare entry: `https://nexus.lubannn.workers.dev/`.
- Proxies the static PWA from the fixed production origin
  `https://personal-workspace-app.pages.dev`.
- Exposes `GET /health`, `GET /auth/status`, `GET /auth/sessions`, `GET /auth/login`,
  `GET /auth/callback`, `POST /auth/token`, `POST /auth/logout`, and
  `POST /auth/logout-all`.
- Keeps GitHub OAuth credentials in Cloudflare Workers Secrets; no secret is
  stored in this repository or in the frontend build.
- Declares the `DB` binding for the Free D1 database `personal-workspace-auth`.
- The first migration has been applied remotely; the first real encrypted
  session was created during the 2026-08-27 OAuth acceptance test.
- The production deployment is configured and still fails closed if any
  required GitHub App credential, allowlist value, key, or D1 binding is absent.
- Leaves the existing GitHub Pages + memory-only PAT entry unchanged.

The public-app proxy only accepts GET/HEAD. It assigns the path separately from
the fixed origin and rejects authority-like paths (`//...`), including after
removing the legacy `/personal-workspace` prefix. Upstream redirects are checked
manually: only credential-free URLs on that same HTTPS origin are allowed, with
at most five hops. Invalid redirects return a non-cacheable 502 without exposing
their Location. Incoming Cookie/Authorization headers are never forwarded by
this proxy, and upstream Set-Cookie headers are stripped. The separate `/auth/*`,
`/coros/*`, and `/health` handlers retain their existing behavior.

Build and run locally:

```bash
pnpm build:cloudflare-pwa
pnpm dev:cloudflare
```

Deploy the canonical Cloudflare entry:

```bash
pnpm deploy:cloudflare:preview
```

The legacy `personal-workspace-preview` Worker is retained temporarily as a
rollback resource. New deployments use the `nexus` name from `wrangler.jsonc`.

## GitHub App authentication

The Cloudflare entry has passed Mac, Windows, iPhone, and iPad GitHub App login,
refresh, write, and cross-device read acceptance. The App is installed only on
`personal-workspace-data`. D1 reported five active sessions for the single
allowed GitHub account after testing, including the initial desktop acceptance
session. Current-device logout reduced the active session count from five to
four, re-login restored it to five, and all-device revocation reduced it to
zero while retaining eight revoked rows for audit. The full authentication
acceptance is complete.

The implemented flow uses OAuth state plus PKCE, a `__Host-` HttpOnly session
cookie, a same-origin CSRF token, HMAC-hashed session identifiers, encrypted and
rotating refresh tokens, and an explicit GitHub user/repository allowlist.

`GET /auth/sessions` uses the existing session cookie to list only that user's
unexpired, unrevoked sessions. Client-supplied user IDs are ignored. The
non-cacheable response contains only `deviceName`, `createdAt`, `lastUsedAt`,
and `current`; it does not expose session identifiers or credentials and does
not refresh tokens. Historical unnamed sessions appear as unnamed devices in
the PWA. Multiple browsers/logins remain separate sessions, and `lastUsedAt`
means authentication refresh time, not real-time online status. PAT connections
have no server-side device list. No migration or additional permission is needed.

New sessions receive a short platform/browser label (for example `Mac－Chrome`)
derived only from the `/auth/callback` request's existing User-Agent. The callback
is the browser receiving the new session cookie; the initiating page or a
different app is not used as its identity. OAuth state/PKCE cookies, user and
repository checks still gate session creation. Only fixed labels (at most 64
characters) are stored, never raw UA, versions, hardware models, IP or location;
no additional client hints are requested. Known embedded apps/WebViews,
unrecognized or conflicting tokens fall back to unknown labels. UA is spoofable,
and desktop-mode tablets or indistinguishable browser brands may report another
platform/browser. Labels are informational and have no authorization role.
Existing names remain unchanged, including on token refresh; unnamed historical
sessions stay unnamed until a future login creates a new session. Names are
bounded in the list response and rendered as plain React text.

The deployed D1 schema contains authentication sessions plus encrypted COROS connection and short-lived OAuth attempt tables. Workspace business data continues to flow directly between the browser and the private GitHub repository.

## COROS automatic sync (daily-login scheduling, 2026-10-03)

The connector supports authenticated enable/pause/status/queued-refresh and
conflict inspection. The first authenticated workspace visit each local day
queues an update; the server deduplicates the request across devices. It does
not start a new COROS refresh every two hours. A ten-minute Cron Trigger drains
queued work one bounded window at a time, including retries and the initial
historical backfill. Once work is queued, it can continue after the browser or
personal computer closes; a day without a login does not create a new daily
update request.

Recent sleep (three days) and workouts (seven days) receive priority. Initial
history has a fixed end date captured when synchronization is enabled and is
filled in three-day windows. Later updates preserve a continuous cursor: after
a long absence, the recent window is refreshed and intervening unchecked days
are filled in bounded windows. A recent result is not proof that the intervening
history is complete. A failed domain backs off independently, and checkpoints
advance only after a successful atomic Git transaction.

`0003_coros_sync_jobs.sql` stores operational cursors and a ten-minute lease.
Canonical health records and conflict facts remain in the private repository;
its SHA-checked derived index is rebuilt after portable restore. The scheduler
checks connection/lease before reads and immediately before the Git ref update.
Formatting changes and truncated responses fail explicitly, without advancing
coverage. Only sleep and workout summaries are enabled in this release; daily
metrics, raw FIT/GPS, and training writes are not scheduled.

Production configuration additionally requires `GITHUB_APP_PRIVATE_KEY` as a
Worker Secret. The existing App client ID, installation ID, GitHub account ID,
workspace owner ID and timezone are pinned in the Worker config. The App token
is constrained to Contents write on `personal-workspace-data`. No browser token
is reused. The key is not currently provisioned by this implementation.

One-time setup, from an operator's trusted machine:

```sh
node scripts/configure-coros-background-key.mjs /absolute/path/to/app.private-key.pem
```

The script validates that the key belongs to the existing GitHub App and
installation, then pipes it directly into Workers Secrets without printing it.
After provisioning, enable/resume COROS in the health panel. Existing OAuth is
reused unless expired. Never put the PEM in chat, source control, a test or a log.
The helper requires the project's Node.js runtime (24 or newer), installed
dependencies, and an authenticated Wrangler session with access to the existing
Worker. It configures only the secret; it does not enable synchronization or
write health records.

The Pages `/coros/*` service binding now forwards to this Worker just like
`/auth/*`. New OAuth redirects return to the origin where authorization began;
existing refresh credentials retain their originally registered redirect URI.

### Earlier staged deployment (historical)

The `0002_coros_connections.sql` migration was applied to the existing D1
database on 2026-09-26. The paused connector and separate PWA
connection/status/disconnect card were deployed to the existing `nexus` Worker
and `personal-workspace-app` Pages project. The Worker version is
`47bc3613-16f1-4360-ac8f-215e1d6c10b9`; the Pages production deployment is
`4a4a61cc-0ee2-4d84-8158-15aa0133acf8`. No scheduled polling, health-data
mapping, or automatic Git writes are deployed.
An authenticated, CSRF-protected one-day preview can be requested while paused;
it returns field names and response format only, never health measurements.

The Worker validates the configured COROS resource and callback origin against
public OAuth metadata. Its only MCP tool surface is a hard-coded read allowlist;
the COROS grant itself also includes write tools, which the Worker never calls.
Disconnect removes the local encrypted credential but does not claim that COROS
has revoked the remote grant; the user can revoke it in COROS separately.

The user approved this staged release on 2026-09-26. It has no cron trigger,
no enable-sync route, and no automatic write path.
After a separate workspace OAuth, the one-day preview is the only COROS read
available while paused. Releasing this stage does not authorize automatic sync.

Background Private repository writes will use a GitHub App installation token
scoped to this one repository and Contents write. The App private key and
installation ID must be provisioned as server-side secrets, never placed in
`wrangler.jsonc`, the PWA bundle, or Git. Until the complete mapper, conflict
review, scheduled worker, and acceptance tests are in place, do not deploy an
active sync service or enable automatic writes.
