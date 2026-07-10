---
type: "contract"
status: "current"
last_updated: "2026-07-10"
description: "This document describes plan entitlements, AI credit metering, usage-ledger idempotency, billing provider selection, and subscription state. Brand Studio design lives in brand-studio.md."
---

# Billing And Entitlements

This document describes plan entitlements, AI credit metering, usage-ledger
idempotency, billing provider selection, and subscription state. Brand Studio
design lives in [brand-studio.md](brand-studio.md).

## Source Files

| Area                       | Source                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Plan catalog               | [`src/lib/billing/catalog.ts`](../../src/lib/billing/catalog.ts)                       |
| Entitlement facade         | [`src/lib/billing/entitlement-facade.ts`](../../src/lib/billing/entitlement-facade.ts) |
| Credits                    | [`src/lib/billing/credits.ts`](../../src/lib/billing/credits.ts)                       |
| Usage ledger               | [`src/lib/billing/usage-ledger.ts`](../../src/lib/billing/usage-ledger.ts)             |
| Billing service            | [`src/lib/billing/service.ts`](../../src/lib/billing/service.ts)                       |
| Billing provider interface | [`src/lib/billing/provider.ts`](../../src/lib/billing/provider.ts)                     |
| Stripe provider            | [`src/lib/billing/stripe-provider.ts`](../../src/lib/billing/stripe-provider.ts)       |
| Mock provider              | [`src/lib/billing/mock-provider.ts`](../../src/lib/billing/mock-provider.ts)           |
| Attribution rules          | [`src/lib/billing/attribution.ts`](../../src/lib/billing/attribution.ts)               |

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

`getBillingState` reads the user's plan and resets credit balance when the plan
period has elapsed. Authenticated AI routes reserve a usage-ledger row before
the model call, capture it on success, and refund it on failure.

The usage ledger lifecycle is:

1. `reserve` records intent with a stable idempotency key. Credits are not
   deducted yet.
2. `capture` atomically deducts credits and marks the ledger entry captured.
3. `refund` tombstones the reserved entry without changing balance.

This prevents double charging on retries. Concurrent captures for different
requests still rely on `deductCredits`, which performs an atomic conditional
update guarded by available balance.

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

## Subscription Writes

Local plan changes update both `User.plan` / credit fields and the one-row
`Subscription` model inside a transaction. Stripe webhooks and checkout paths
write Stripe customer/subscription ids separately so customer identity can
outlive an individual subscription.

## Invariants

1. Unknown plan values resolve to free-tier entitlements.
2. Production billing never silently falls back to the mock provider.
3. Authenticated AI generation is credit-metered unless unlimited credits are
   explicitly enabled.
4. Ledger reserve/capture/refund is idempotent by request key.
5. Capturing usage is the only path that deducts credits for successful AI work.

## Primary Tests

- [`src/lib/billing/entitlements.test.ts`](../../src/lib/billing/entitlements.test.ts)
- [`src/lib/billing/credits.test.ts`](../../src/lib/billing/credits.test.ts)
- [`src/lib/billing/usage-ledger.test.ts`](../../src/lib/billing/usage-ledger.test.ts)
- [`src/lib/billing/provider.test.ts`](../../src/lib/billing/provider.test.ts)
- [`src/lib/billing/mock-provider.test.ts`](../../src/lib/billing/mock-provider.test.ts)
- [`src/lib/billing/stripe-provider.test.ts`](../../src/lib/billing/stripe-provider.test.ts)
- [`src/lib/billing/service.test.ts`](../../src/lib/billing/service.test.ts)
- [`src/lib/billing/attribution.test.ts`](../../src/lib/billing/attribution.test.ts)
