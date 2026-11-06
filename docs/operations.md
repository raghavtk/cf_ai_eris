# Eris operations and recovery

These commands are for an authenticated maintainer. Run production D1 commands from `worker/` and verify the account and database name before continuing.

## Configuration and secrets

- Keep local values in ignored `.dev.vars` files.
- Store deployed credentials with `npx wrangler secret put <NAME>`; never put secret values in `wrangler.toml`, `VITE_*` variables, logs, screenshots, or Git.
- List secret names with `npx wrangler secret list`. Wrangler does not return secret values.
- Rotate a secret by setting the same name again, verifying the deployment, and revoking the old credential at its provider.

## Single-user Cloudflare Access boundary

The frontend hostname serves the public Eris workspace, including direct links to the task form, planner, GitHub preview, and About page. Keep this hostname outside the owner Access application. Demo tasks stay in browser memory and reset on reload. The composer sends the current prompt to the public frontend Worker for inference. Eris stores no public prompt history on the server. The Worker API is private and must be covered by a Cloudflare Access self-hosted application before personal data is deployed.

1. In Cloudflare Zero Trust, create an Access application covering the Worker hostname and all paths.
2. Add an Allow policy containing only the owner's exact email address. Do not add an Everyone rule.
3. Configure Access to allow CORS preflight (`OPTIONS`) requests to reach the Worker without an identity challenge; the Worker validates their origin and returns no data.
4. Serve the frontend and API from same-site HTTPS hostnames where possible (for example, `eris.example.com` and `api.eris.example.com`). If they are cross-site, explicitly enable Access's credentialed cross-origin cookie/CORS support and verify the `CF_Authorization` cookie is sent on API fetches; `credentials: include` cannot override a restrictive cookie `SameSite` attribute or browser third-party-cookie blocking.
5. Set Worker variables `TEAM_DOMAIN`, `POLICY_AUD`, `ERIS_ALLOWED_EMAIL`, and `ERIS_ALLOWED_ORIGIN`. The origin must be the exact public frontend origin with no path or trailing slash. Never set `ERIS_LOCAL_DEV` in a deployed environment.
6. For local development only, set `ERIS_LOCAL_DEV=true` in ignored `worker/.dev.vars`. The bypass also requires a loopback request hostname and otherwise fails closed.
7. Deploy the Worker, then the frontend. Visit the public preview and use **Owner sign in** to establish the Access session.

On desktop and mobile, open a private browser window and verify that the demo loads without API traffic. Parsing should call only the same-origin public AI endpoint. Parse the example, add it to the task list, plan a day, reload to reset the sample tasks, and open the locked GitHub route. Verify that direct API calls are challenged by Access and that an identity other than the owner cannot enter. From the owner browser, verify the login return, session check, tasks, AI, schedules, and metrics. Repeat with third-party cookies blocked if the hosts are cross-site; failure means the deployment is not ready for personal data. The Worker also validates the Access JWT and email, so a missing or inconsistent variable returns `401` even if the edge policy is accidentally broadened.

If the owner is locked out, confirm the Access application audience tag and team domain, restore the one-email Allow policy, and compare the deployed variable names with `wrangler secret list`/the Worker settings. Do not temporarily make the API public. Local `wrangler dev` remains available with the isolated `local-dev` owner for recovery and diagnosis.

## Public demo AI budget

Deploy the public frontend as the Worker from app/ so its AI, SQLite Durable Object, and rate limiter bindings are active. The Worker reserves 210 neurons per model call from a shared 6,000-neuron UTC daily budget, allowing 28 live requests a day at the current conservative reservation. This reservation covers the published Granite 4.0 H Micro context window and 256 output tokens, rounded up, and remains charged against the demo budget on provider errors. Recheck Cloudflare pricing and context limits before changing the model. Keep a single production budget namespace for all public hostnames. The budget applies to this demo endpoint only.

The rate limiter allows three attempts per client IP per minute per Cloudflare location. When a limit is reached or inference fails, the composer explains the fallback and returns a basic local parse. During the release check, submit one example against the deployed hostname and verify a live result and one invocation in the Workers AI dashboard.

## Back up D1

The GitHub connector stores encrypted GitHub user credentials and cached issue, PR, and Project metadata in D1. A D1 export contains ciphertext and sensitive work metadata; treat backups as sensitive. Keep `GITHUB_TOKEN_ENCRYPTION_KEY` outside D1 backups and retain it while connections exist. If the key is lost, disconnect and reauthorize installations. Before deleting all user data, also remove rows from `github_project_oauth_flows`, `github_oauth_flows`, `github_pending_links`, `github_items`, `github_milestones`, `github_labels`, `github_projects`, `github_sync_progress`, `github_repositories`, and `github_connections` in that order. Use the GitHub tab to disconnect an individual installation and purge its cache.

Create a timestamped export before migrations or risky data changes:

```bash
cd worker
mkdir -p .backups
npx wrangler d1 export productivity-db --remote --output .backups/productivity-db-YYYYMMDD-HHMM.sql
```

`.backups/` is ignored and may contain personal task data. Store exports encrypted, restrict access, and delete them according to the same retention policy as production data.

## Verify and restore

Never test a restore against production first. Create a separate recovery database, apply the export, and inspect representative row counts:

```bash
cd worker
npx wrangler d1 create productivity-db-recovery
npx wrangler d1 execute productivity-db-recovery --remote --file .backups/productivity-db-YYYYMMDD-HHMM.sql
npx wrangler d1 execute productivity-db-recovery --remote --command "SELECT COUNT(*) AS task_count FROM tasks"
```

Record the recovery database ID printed by Wrangler in a temporary, untracked configuration. After validation, follow Cloudflare's current D1 recovery procedure or point a controlled recovery deployment at the verified database. Do not overwrite the production database in place without a maintenance window and a fresh export.

## Export and delete user data

Exporting the D1 database captures tasks, schedules, aggregates, and privacy-safe AI request metadata. Inspect the SQL before sharing it because task fields contain personal data.

For single-user deletion, take a final export if retention policy permits, then execute the following statements in a reviewed SQL file against the intended database:

```sql
DELETE FROM schedule_entries;
DELETE FROM tasks;
DELETE FROM analytics_aggregates;
DELETE FROM ai_requests;
```

Use `npx wrangler d1 execute productivity-db --remote --file <reviewed-file.sql>` only after confirming the target. Remove Durable Object parsing history by deleting the applicable object storage through a dedicated, authenticated application operation; starting a new browser session does not delete old Durable Object storage.

## Migrations and rollback

1. Export production D1.
2. Run Worker tests, including migration assertions.
3. Apply migrations to a local or recovery database first.
4. Run `npx wrangler d1 migrations apply productivity-db --remote` during a controlled window.
5. Verify the application and relevant row counts before deploying dependent code.

D1 migrations are forward-only. Prefer a corrective migration for schema mistakes. For data-loss or incompatible-schema incidents, stop writes, preserve the failed database, restore the last verified export to a new database, and roll the Worker back to the last known-good deployment from the Cloudflare dashboard.

## Release gate

Before deployment:

```bash
cd app
npm ci
npm test
npm run lint
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ..
git diff --check
```

Do not deploy personal data unless the single-user Cloudflare Access release checks above pass from both owner and unauthorized browser sessions.
