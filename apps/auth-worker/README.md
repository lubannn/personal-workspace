# Personal Workspace auth edge

This Worker is introduced in two deliberately separate stages.

## Current stage: auth foundation deployed, credentials pending

- Canonical Cloudflare entry: `https://nexus.lubannn.workers.dev/`.
- Serves the existing static PWA from `apps/github-pwa/out`.
- Exposes `GET /health`, `GET /auth/status`, `GET /auth/login`,
  `GET /auth/callback`, `POST /auth/token`, `POST /auth/logout`, and
  `POST /auth/logout-all`.
- Does not contain GitHub OAuth credentials.
- Declares the `DB` binding for the Free D1 database `personal-workspace-auth`.
- The first migration has been applied remotely; the session table is empty.
- The auth implementation is deployed fail-closed. It does not create a real
  session until all GitHub App credentials and encryption secrets are present.
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

## Later stage: GitHub App authentication

The Cloudflare entry has passed Mac, Windows, iPhone, and iPad testing. The
remaining authentication rollout is:

1. Create the prepared GitHub App with repository-specific `Contents` read/write
   permissions, expiring user tokens, no webhook, and account-only installation.
2. Add the OAuth client ID as a non-secret Worker variable.
3. Add the OAuth client secret and encryption material using
   `wrangler secret put`.
4. Install the App only on `personal-workspace-data` and complete the four-device
   login, refresh, write, logout, and revocation acceptance tests.

The implemented flow uses OAuth state plus PKCE, a `__Host-` HttpOnly session
cookie, a same-origin CSRF token, HMAC-hashed session identifiers, encrypted and
rotating refresh tokens, and an explicit GitHub user/repository allowlist.

The D1 schema is intentionally limited to authentication sessions. Workspace business data continues to flow directly between the browser and the private GitHub repository.
