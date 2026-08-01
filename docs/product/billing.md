---
type: "contract"
status: "current"
last_updated: "2026-08-01"
description: "This document describes plan entitlements, hold-on-reserve usage-ledger semantics, idempotency-key hashing and cutover, reconciliation, billing provider selection, and subscription state."
---

# Billing And Entitlements

This document describes plan entitlements, AI credit metering, usage-ledger
idempotency, billing provider selection, and subscription state. Brand Studio
design lives in [brand-studio.md](brand-studio.md).

## Source Files

| Area                       | Source                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Plan catalog               | [`src/lib/billing/catalog.ts`](../../src/lib/billing/catalog.ts)                                             |
| Entitlement facade         | [`src/lib/billing/entitlement-facade.ts`](../../src/lib/billing/entitlement-facade.ts)                       |
| Credits                    | [`src/lib/billing/credits.ts`](../../src/lib/billing/credits.ts)                                             |
| Usage ledger               | [`src/lib/billing/usage-ledger.ts`](../../src/lib/billing/usage-ledger.ts)                                   |
| Legacy key backfill        | [`src/lib/billing/legacy-key-backfill.ts`](../../src/lib/billing/legacy-key-backfill.ts)                     |
| Billing service            | [`src/lib/billing/service.ts`](../../src/lib/billing/service.ts)                                             |
| Billing provider interface | [`src/lib/billing/provider.ts`](../../src/lib/billing/provider.ts)                                           |
| Stripe provider            | [`src/lib/billing/stripe-provider.ts`](../../src/lib/billing/stripe-provider.ts)                             |
| Mock provider              | [`src/lib/billing/mock-provider.ts`](../../src/lib/billing/mock-provider.ts)                                 |
| Billing settings actions   | [`src/app/app/settings/billing/actions.ts`](../../src/app/app/settings/billing/actions.ts)                   |
| Billing settings UI        | [`src/app/app/settings/billing/billing-actions.tsx`](../../src/app/app/settings/billing/billing-actions.tsx) |
| Attribution rules          | [`src/lib/billing/attribution.ts`](../../src/lib/billing/attribution.ts)                                     |

## Plans And Entitlements

Plans are defined by `PLAN_CATALOG` and `PLAN_ENTITLEMENTS`.

| Plan   | Credits | Period  | Export/features                              |
| ------ | ------- | ------- | -------------------------------------------- |
| `free` | 500     | 7 days  | PNG/PDF export, watermark present.           |
| `plus` | 10,000  | 30 days | SVG/PPTX export, brand styles, no watermark. |
| `pro`  | 30,000  | 30 days | Plus features and custom font upload.        |

Unknown plan strings resolve to the free tier. Feature gates use the entitlement
facade so UI and server actions can produce consistent allowed/upgrade-message
decisions.

## Credit State And Usage Ledger

`loadAndSyncBillingState` and ledger writes share `syncBillingPeriodState` so
credit-period reset uses a guarded compare-and-swap path. Authenticated AI
routes reserve a durable hold before the model call, capture it on success, and
refund it on failure/expiry.

The usage ledger lifecycle is:

1. `reserve` atomically decrements credits and writes `status="reserved"` once.
2. `capture` compare-and-swaps `reserved -> captured` with no balance mutation.
3. `refund` compare-and-swaps `reserved -> refunded`; new-format hold rows
   increment balance exactly once when the hold belongs to the synced current
   billing period, and legacy pre-hold rows do not.

`refund` calls `syncBillingPeriodState` before deciding whether to restore
credits. If the user has rolled into a new billing period, the period sync first
resets the balance to the new allowance; a reservation whose `reservedAt` falls
outside that synced period is still marked `refunded`, but it does not add the
prior-period hold back on top of the refreshed allowance. `reservationVersion`
continues to distinguish hold-on-reserve rows from legacy rows, while the
current-period check prevents a valid v1 hold from crossing a period boundary as
extra credit. Repeated refund attempts see the terminal `refunded` row and do
not restore credits a second time.

Rows are idempotent by scoped hash (`keyHash`) derived from
`userId + operation + raw Idempotency-Key`; raw keys are never written by new
reserve paths. `keyHash` is Prisma-mapped to the historical `idempotencyKey`
column to keep existing schema/indexes during cutover.

`keyHashVersion` tracks key cutover independently from `reservationVersion`:

- `keyHashVersion=0` legacy/raw key storage
- `keyHashVersion=1` scoped hash storage

`reservationVersion` remains the hold-accounting marker (`0` pre-hold legacy,
`1` hold-on-reserve), so key migration never reclassifies legacy rows as hold
rows.

Stale reserved rows are reconciled via
`reconcileStaleReservedUsage`/`scripts/reconcile-stale-usage-reservations.ts`,
which processes bounded TTL batches and distinguishes legacy rows so they never
receive accidental balance increments.

Legacy key cutover is handled by
`backfillLegacyUsageLedgerKeys`/`scripts/backfill-usage-ledger-key-hash.ts`:
dry-run by default, explicit `--apply` to mutate, bounded batches, and
collision-safe skips that preserve the original row.

`BILLING_UNLIMITED_CREDITS` skips authenticated credit deduction only when
explicitly enabled. Anonymous users are governed by the AI route quota layer,
not by billing plans.

## Provider Selection

`getBillingProvider` returns a singleton provider selected by runtime config:

- Stripe when `STRIPE_SECRET_KEY` is set.
- Mock provider in non-production when Stripe is not configured.
- Fail closed in production without Stripe or when configured Stripe cannot load.

The provider interface owns plan change, period-end cancellation, and immediate
subscription cancellation for account deletion.

Provider exceptions are operational failures, not user-facing payloads. Billing
server actions log them with an operation-specific scope and return the shared
safe billing failure message. The client adapter also maps rejected action
transports to that message, so network and server-action failures remain inline
instead of escaping as unhandled UI errors. Success feedback uses a live status
region; failure feedback uses an alert. A synchronous client-side mutation
boundary suppresses repeated plan-change or cancellation activation before
React can render the pending state, disables every competing billing action,
and reports the specific operation in progress. Framework redirect/not-found
control flow is rethrown instead of being converted to ordinary billing
feedback, and inline feedback can be dismissed before retrying. Checkout and
portal handoffs remain owned by the mounted billing surface; leaving that
surface invalidates the active operation so a late provider response cannot
navigate the user away from their newer route. A hosted Stripe checkout is
reported as successful only when Stripe returns a non-empty redirect URL;
missing handoff URLs fail through the same logged, generic action-error path
instead of showing a false “Redirecting…” success.

## Subscription Writes

Local plan changes update both `User.plan` / credit fields and the one-row
`Subscription` model inside a transaction. Stripe checkout is used for new paid
conversions without an active Stripe subscription; active paid tier changes
update the existing Stripe subscription item instead of opening a second
subscription. Stripe webhooks and checkout paths write Stripe
customer/subscription ids separately so customer identity can outlive an
individual subscription.

## Invariants

1. Unknown plan values resolve to free-tier entitlements.
2. Production billing never silently falls back to the mock provider.
3. Authenticated AI generation is credit-metered unless unlimited credits are
   explicitly enabled.
4. Ledger reserve/capture/refund is idempotent by scoped `keyHash`.
5. Reserve is the only path that decrements credits for metered AI usage.
6. Capture/refund settlement failures fail closed (5xx) until terminal state.
7. Legacy key backfill never changes `reservationVersion`; it updates
   `keyHashVersion`/`keyHash` only.
8. Prior-period reservations refund to a terminal ledger state without
   increasing the new period's refreshed allowance.
9. Billing provider and action-transport exceptions produce safe inline
   feedback; raw exception messages are never returned to the browser.

## Primary Tests

- [`src/lib/billing/entitlements.test.ts`](../../src/lib/billing/entitlements.test.ts)
- [`src/lib/billing/credits.test.ts`](../../src/lib/billing/credits.test.ts)
- [`src/lib/billing/usage-ledger.test.ts`](../../src/lib/billing/usage-ledger.test.ts)
- [`scripts/usage-ledger-postgres-integration.test.ts`](../../scripts/usage-ledger-postgres-integration.test.ts) (opt-in Postgres harness)
- [`src/lib/billing/legacy-key-backfill.test.ts`](../../src/lib/billing/legacy-key-backfill.test.ts)
- [`src/lib/billing/stale-reservation-reconciliation.ts`](../../src/lib/billing/stale-reservation-reconciliation.ts)
- [`src/lib/billing/provider.test.ts`](../../src/lib/billing/provider.test.ts)
- [`src/lib/billing/mock-provider.test.ts`](../../src/lib/billing/mock-provider.test.ts)
- [`src/lib/billing/stripe-provider.test.ts`](../../src/lib/billing/stripe-provider.test.ts)
- [`src/lib/billing/service.test.ts`](../../src/lib/billing/service.test.ts)
- [`src/lib/billing/attribution.test.ts`](../../src/lib/billing/attribution.test.ts)
- [`src/app/app/settings/billing/actions.test.ts`](../../src/app/app/settings/billing/actions.test.ts)
- [`src/app/app/settings/billing/billing-actions.test.tsx`](../../src/app/app/settings/billing/billing-actions.test.tsx)
- [`e2e/ui-matrix/workspace-billing-brand-ui.spec.ts`](../../e2e/ui-matrix/workspace-billing-brand-ui.spec.ts)

Opt-in Postgres command:

- `ENABLE_POSTGRES_BILLING_TESTS=1 DATABASE_URL=postgres://... npm run test:billing:postgres`
  - generates only `billingPostgresTestClient` into `.test-generated/prisma-postgres-billing`
  - provisions a unique test-scoped Postgres database, runs
    `test:billing:postgres:integration`, then drops the database
  - refuses non-test targets unless the `DATABASE_URL` database or schema name
    contains `test`/`ci`
