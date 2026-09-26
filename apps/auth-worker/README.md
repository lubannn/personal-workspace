# Personal Workspace auth edge

This Worker was introduced in two deliberately separate stages.

## Current stage: GitHub App OAuth live

- Canonical Cloudflare entry: `https://nexus.lubannn.workers.dev/`.
- Serves the existing static PWA from `apps/github-pwa/out`.
- Exposes `GET /health`, `GET /auth/status`, `GET /auth/login`,
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

The deployed D1 schema contains authentication sessions plus encrypted COROS connection and short-lived OAuth attempt tables. Workspace business data continues to flow directly between the browser and the private GitHub repository.

## COROS connector staged release (paused)

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
