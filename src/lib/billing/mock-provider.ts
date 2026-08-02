/**
 * Mock / DEV billing provider (US-010 epic).
 *
 * Performs plan changes and cancellations by writing directly to the database.
 * No external service is required — works in CI, local dev, and any environment
 * without Stripe keys. This is the default provider when STRIPE_SECRET_KEY is
 * absent.
 *
 * Plan transitions:
 *  - upgrade to plus/pro: creates or updates the Subscription row; sets plan
 *    and creditBalance on the User row.
 *  - downgrade to free: same, but targets the free entitlements.
 *  - cancel: sets cancelAtPeriodEnd = true; actual downgrade happens at period
 *    end (a cron job or webhook would handle that in prod — for mock we mark it).
 */

import { isPlan, type Plan } from "@/lib/billing/catalog";
import {
  applyLocalPlanChange,
  getBillingSubscription,
  markSubscriptionCancelAtPeriodEnd,
} from "@/lib/billing/service";
import type { BillingProvider, ChangePlanResult } from "@/lib/billing/provider";
import {
  isE2EProfileMockBillingAllowed,
  isProductionEnv,
} from "@/lib/billing/config";

type MockBillingProviderDeps = {
  applyLocalPlanChange?: typeof applyLocalPlanChange;
  getBillingSubscription?: typeof getBillingSubscription;
  markSubscriptionCancelAtPeriodEnd?: typeof markSubscriptionCancelAtPeriodEnd;
};

/**
 * Pure guard: may the mock provider grant `targetPlan` in the given env?
 *
 * The mock writes paid plans straight to the DB without taking payment, so it
 * must NEVER grant a paid plan (plus/pro) in production. Downgrades to `free`
 * are always allowed (no money involved). Non-production may grant anything.
 */
export function isMockPlanChangeAllowed(
  targetPlan: Plan,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (targetPlan === "free") return true;
  return !isProductionEnv(env) || isE2EProfileMockBillingAllowed(env);
}

export class MockBillingProvider implements BillingProvider {
  private readonly deps: Required<MockBillingProviderDeps>;

  constructor(deps: MockBillingProviderDeps = {}) {
    this.deps = {
      applyLocalPlanChange: deps.applyLocalPlanChange ?? applyLocalPlanChange,
      getBillingSubscription:
        deps.getBillingSubscription ?? getBillingSubscription,
      markSubscriptionCancelAtPeriodEnd:
        deps.markSubscriptionCancelAtPeriodEnd ??
        markSubscriptionCancelAtPeriodEnd,
    };
  }

  async changePlan(
    userId: string,
    targetPlan: Plan,
  ): Promise<ChangePlanResult> {
    if (!isPlan(targetPlan)) {
      return {
        success: false,
        plan: "free",
        message: `Unknown plan: ${targetPlan}.`,
      };
    }

    if (!isMockPlanChangeAllowed(targetPlan)) {
      return {
        success: false,
        plan: "free",
        message:
          "Mock billing cannot grant paid plans in production. Configure " +
          "Stripe (STRIPE_SECRET_KEY) to enable real payments.",
      };
    }

    await this.deps.applyLocalPlanChange(userId, targetPlan);

    return {
      success: true,
      plan: targetPlan,
      message: `Plan updated to ${targetPlan}.`,
    };
  }

  // No real Stripe subscription exists in the mock — nothing to cancel.
  async cancelSubscriptionImmediately(_userId: string): Promise<void> {}

  async cancelSubscription(userId: string): Promise<ChangePlanResult> {
    const sub = await this.deps.getBillingSubscription(userId);

    if (!sub) {
      // No active subscription — nothing to cancel
      return {
        success: true,
        plan: "free",
        message: "No active subscription to cancel.",
      };
    }

    await this.deps.markSubscriptionCancelAtPeriodEnd(userId);

    return {
      success: true,
      plan: sub.plan as Plan,
      message: `Subscription will be cancelled at the end of the current period.`,
    };
  }
}
