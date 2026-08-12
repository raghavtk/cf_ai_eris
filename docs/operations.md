# Eris operations and recovery

These commands are for an authenticated maintainer. Run production D1 commands from `worker/` and verify the account and database name before continuing.

## Configuration and secrets

- Keep local values in ignored `.dev.vars` files.
- Store deployed credentials with `npx wrangler secret put <NAME>`; never put secret values in `wrangler.toml`, `VITE_*` variables, logs, screenshots, or Git.
- List secret names with `npx wrangler secret list`. Wrangler does not return secret values.
- Rotate a secret by setting the same name again, verifying the deployment, and revoking the old credential at its provider.

## Back up D1

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

Do not deploy the current application with personal data until issue #3 establishes the single-user Cloudflare Access boundary and removes public API bypasses.
