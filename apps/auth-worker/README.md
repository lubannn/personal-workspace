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

The currently deployed D1 schema is limited to authentication sessions. Workspace business data continues to flow directly between the browser and the private GitHub repository.

## COROS automatic sync development (not deployed)

The next migration adds a short-lived OAuth attempt table and encrypted COROS
connection table. The connector starts paused after authorization. No scheduled
polling, health-data mapping, or automatic Git writes are deployed yet.

The Worker validates the configured COROS resource and callback origin against
public OAuth metadata. Its only MCP tool surface is a hard-coded read allowlist;
the COROS grant itself also includes write tools, which the Worker never calls.
Disconnect removes the local encrypted credential but does not claim that COROS
has revoked the remote grant; the user can revoke it in COROS separately.

Background Private repository writes will use a GitHub App installation token
scoped to this one repository and Contents write. The App private key and
installation ID must be provisioned as server-side secrets, never placed in
`wrangler.jsonc`, the PWA bundle, or Git. Until the complete mapper, conflict
review, scheduled worker, and acceptance tests are in place, do not apply the
new migration or deploy this branch as an active sync service.
