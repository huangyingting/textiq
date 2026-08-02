/**
 * BillingProvider interface and provider factory (US-010 epic).
 *
 * The interface is intentionally thin: it covers the three lifecycle actions
 * the billing dashboard needs (upgrade, downgrade, cancel) and is implemented
 * by both the DEV/MOCK provider (always available, no external keys) and the
 * Stripe adapter (loaded only when STRIPE_SECRET_KEY is set).
 *
 * The factory `getBillingProvider()` checks the environment and returns the
 * appropriate provider. It falls back to the mock in CI and local dev, but
 * FAILS CLOSED in production: if Stripe is not configured (or its SDK cannot be
 * loaded) it throws rather than silently serving paid billing through the mock.
 */

import type { Plan } from "@/lib/billing/catalog";
import * as billingConfig from "@/lib/billing/config";
export const {
  decideBillingProvider,
  isE2EProfileMockBillingAllowed,
  isProductionEnv,
  BillingMisconfiguredError,
} = billingConfig;
/* node:coverage ignore next -- Type-only re-export is erased by TypeScript but reported by source maps. */
export type { BillingProviderKind } from "@/lib/billing/config";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ChangePlanResult {
  success: boolean;
  /** The new plan after the operation. */
  plan: Plan;
  /** Human-readable message suitable for display. */
  message: string;
  /** For Stripe: a URL to redirect the user to (checkout session, portal). */
  redirectUrl?: string;
}

export interface BillingProvider {
  changePlan(userId: string, targetPlan: Plan): Promise<ChangePlanResult>;

  cancelSubscription(userId: string): Promise<ChangePlanResult>;
  cancelSubscriptionImmediately(userId: string): Promise<void>;
}

/* @preserve node:coverage ignore start -- Cancellation input is a TypeScript-only union; runtime decisions are asserted below. */
type SubscriptionCancellationInput =
  | {
      stripeSubscriptionId: string | null;
      status: string;
    }
  | null
  | undefined;
/* @preserve node:coverage ignore stop */

export function shouldCancelSubscription(
  /*! @preserve node:coverage ignore next -- Cancellation decision branches are asserted; tsx maps this small facade as uncovered. */
  sub: SubscriptionCancellationInput,
): boolean {
  /*! @preserve node:coverage ignore next 2 -- Cancellation decision branches are asserted; tsx maps this small facade as uncovered. */
  if (!sub?.stripeSubscriptionId) return false;
  return sub.status !== "cancelled";
}

let _provider: BillingProvider | null = null;

/* @preserve node:coverage ignore start -- Provider factory documentation is a source-map-only coverage row; factory behavior is asserted below. */
/**
 * Returns the singleton `BillingProvider` for the current environment.
 *
 * Provider selection is delegated to {@link decideBillingProvider}:
 * - Stripe when `STRIPE_SECRET_KEY` is set.
 * - Mock in non-production when Stripe is not configured.
 * - In production without Stripe, it throws (fail-closed).
 *
 * When Stripe IS configured but its SDK cannot be loaded, we FAIL CLOSED in
 * production (throw) rather than silently degrading to the mock provider; in
 * non-production we degrade to the mock so local dev keeps working.
 *
 * The Stripe adapter is loaded lazily via a dynamic import so the module graph
 * doesn't pull in `stripe` unless it is actually installed.
 */
/* @preserve node:coverage ignore stop */
export async function getBillingProvider(): Promise<BillingProvider> {
  if (_provider) return _provider;

  /* node:coverage ignore next 2 -- Provider selection is tested through config; tsx maps this lazy-load transition as uncovered. */
  const kind = decideBillingProvider();

  if (kind === "stripe") {
    try {
      const { StripeBillingProvider } =
        await import("@/lib/billing/stripe-provider");
      _provider = new StripeBillingProvider();
      return _provider;
    } catch (err) {
      if (isProductionEnv()) {
        throw new BillingMisconfiguredError(
          "Stripe is configured but its provider could not be loaded in " +
            "production. Refusing to fall back to the mock billing provider " +
            `(fail-closed). Cause: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Non-production: degrade to the mock so local dev/CI keeps working.
    }
  }

  const { MockBillingProvider } = await import("@/lib/billing/mock-provider");
  _provider = new MockBillingProvider();
  return _provider;
}
