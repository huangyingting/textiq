---
type: "runbook"
status: "current"
last_updated: "2026-07-15"
description: "Runbook for migrating legacy usage-ledger raw idempotency keys to scoped hashes without changing reservation accounting semantics."
---

# Billing Ledger Key Cutover Runbook

## Purpose

Migrate legacy `UsageLedgerEntry` rows (`reservationVersion=0`) from raw-key
storage to scoped hash storage while preserving legacy accounting semantics.

- Do **not** change `reservationVersion` during this cutover.
- Only update `keyHash` and `keyHashVersion`.
- Never log raw legacy keys.

## Preconditions

1. Confirm schema includes `UsageLedgerEntry.keyHashVersion`.
2. Confirm app deploy includes:
   - `src/lib/billing/legacy-key-backfill.ts`
   - `scripts/backfill-usage-ledger-key-hash.ts`
3. Choose a bounded batch size (`BILLING_LEGACY_KEY_BACKFILL_BATCH_SIZE`).

## Commands

Dry-run (default; no mutation):

```bash
npm run billing:backfill-legacy-keys
```

Apply one batch:

```bash
npm run billing:backfill-legacy-keys -- --apply
```

Optional explicit batch size override:

```bash
npm run billing:backfill-legacy-keys -- --batch-size=200 --apply
```

## Safety Expectations

- Collision-safe: conflicting derived hashes are skipped, never overwritten.
- Output summaries contain only `keyHash`, `userId`, `operation`, and counts.
- Legacy stale-settlement behavior remains intact because
  `reservationVersion=0` is preserved.

## Post-Run Verification

1. Re-run dry-run and confirm `updated=0` for the batch.
2. Run billing regression:

```bash
DB_PROVIDER=sqlite npm run test:billing
```

3. Confirm stale reconciliation invariants still pass:
   - v0 stale rows settle to terminal without balance increment.
   - v1 hold rows increment balance exactly once on refund.
