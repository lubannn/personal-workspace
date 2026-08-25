# Personal Workspace auth edge

This Worker is introduced in two deliberately separate stages.

## Current stage: no-secret feasibility

- Serves the existing static PWA from `apps/github-pwa/out`.
- Exposes `GET /health` and `GET /auth/status`.
- Does not contain GitHub OAuth credentials.
- Does not bind D1 or persist anything.
- Leaves the existing GitHub Pages + memory-only PAT entry unchanged.

Build and run locally:

```bash
pnpm build:cloudflare-pwa
pnpm dev:cloudflare
```

Deploy the feasibility endpoint:

```bash
pnpm deploy:cloudflare:preview
```

## Later stage: GitHub App authentication

Only after the feasibility endpoint passes Mac, Windows, iPhone, and iPad testing:

1. Create a D1 database and add its `DB` binding to `wrangler.jsonc`.
2. Apply `migrations/0001_auth_sessions.sql`.
3. Create the GitHub App with repository-specific `Contents` permissions.
4. Add OAuth credentials and encryption material using `wrangler secret put`.
5. Implement and enable the auth endpoints.

The D1 schema is intentionally limited to authentication sessions. Workspace business data continues to flow directly between the browser and the private GitHub repository.
