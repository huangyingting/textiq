---
type: "runbook"
status: "current"
last_updated: "2026-07-04"
description: "Operational retention runner for expired rate-limit windows, single-use auth tokens, and soft-deleted assets."
---

# Operational Retention Runner

The retention runner is a credential-free, one-shot maintenance command for
expired operational rows and soft-deleted asset bytes. It is safe to run from
cron or a platform scheduler.

## Command

```bash
npm run retention:run -- --dry-run
RETENTION_RUNNER_CONFIRM=delete-expired npm run retention:run -- --execute
```

Defaults are intentionally non-destructive:

- mode: `--dry-run`
- batch size: `100` rows per table/domain
- auth token retention: `7` days after a token is expired or consumed
- rate-limit retention: `1` hour after the fixed window has reset
- asset retention: `7` days after `deletedAt`

Optional overrides:

```bash
npm run retention:run -- --dry-run --batch-size=50
npm run retention:run -- --dry-run --auth-token-retention-days=14
npm run retention:run -- --dry-run --rate-limit-retention-hours=2
npm run retention:run -- --dry-run --asset-retention-days=30
```

## Production Schedule

Run hourly in production. Keep the job single-instance at the scheduler level.
If two jobs overlap, deletes remain idempotent and storage delete is retried on
the next run when a storage backend error leaves the database row intact, but
overlap can duplicate work.

## Safety And Logging

`--execute` refuses to start unless
`RETENTION_RUNNER_CONFIRM=delete-expired` is present. The script logs structured
JSON events with batch sizes, cutoffs, candidate counts, deleted counts, asset
ids for storage-delete failures, and failure counts. It never logs token hashes,
rate-limit subjects, or asset storage keys.

Dry-run mode performs the same bounded candidate selection without database
deletes or storage deletes.

Asset cleanup is domain-scoped before touching storage: slide assets must remain
document-scoped, and brand assets must remain explicitly `brandId`-scoped.
Rows with no document/workspace/brand scope are skipped rather than guessed.
