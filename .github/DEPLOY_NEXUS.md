# Automatic nexus deployment

`auth-worker.yml` publishes the existing `nexus` Worker on every `main` push,
or a manual run on `main`. Forks and PRs cannot enter the deployment job.
It checks lint/types, Worker/shared-data tests and a Wrangler dry-run before
uploading. Validation failure stops deployment. Runs are serialized and stale
commits are rejected. Node 24.19.0, pnpm 11.19.0 and Wrangler 4.125.0 are pinned;
dependencies use the frozen lockfile. The frontend workflow stays separate.

## One-time owner setup

1. In Cloudflare **My Profile > API Tokens > Create Token > Custom token**,
   create a dedicated user token with **Account > Workers Scripts > Edit**.
   Set **Account Resources > Include > Specific account** to the account owning
   `nexus`. Add no Zone or other product permissions. This permission is
   account-wide, not restricted to one Worker. Its sufficiency is based on API
   requirements and Wrangler code review; verify it on the first real release.
2. In [repository Actions settings](https://github.com/lubannn/personal-workspace/settings/secrets/actions),
   add repository **secret `CLOUDFLARE_API_TOKEN`** and repository
   **variable `CLOUDFLARE_ACCOUNT_ID`**. The token goes directly from the owner
   to GitHub; never paste it into chat or source. The explicit account ID avoids
   account discovery. Credentials are passed only to the deployment step.
3. Merge only when ready to deploy: merging triggers the workflow. If merged
   before the secret is configured, the upload step fails closed. After setup,
   choose **Actions > Deploy nexus Worker > Run workflow > main**. Verify the
   commit SHA, upload result and public health check. Do not run the draft branch.

No database migration or credential provisioning commands are added. A failed
post-deploy health check does not automatically undo an upload.

## Rollback

Disable this workflow; cancel or wait for any running upload. In Cloudflare
**Workers & Pages > nexus > Deployments**, roll back to a known-good version.
Revert the faulty code on `main`, then re-enable and run the workflow on `main`.
Do not rerun an old commit. [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
does not restore database data.

No paid plan is enabled by this workflow. GitHub Actions billing and Cloudflare
usage are separate; current account usage and total cost have not been verified.
