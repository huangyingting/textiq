import {
  getEntitlements,
  resolvePlan,
  type Plan,
  type PlanEntitlements,
} from "@/lib/billing/catalog";

export type EntitlementFeature = {
  [K in keyof PlanEntitlements]: PlanEntitlements[K] extends boolean
    ? K
    : never;
}[keyof PlanEntitlements];

export type EntitlementDecision =
  | {
      allowed: true;
      feature: EntitlementFeature;
      plan: Plan;
      reason: "included";
    }
  | {
      allowed: false;
      feature: EntitlementFeature;
      plan: Plan;
      reason: "upgrade_required";
    };

export function decideEntitlement(
  plan: string | null | undefined,
  feature: EntitlementFeature,
): EntitlementDecision {
  const resolvedPlan = resolvePlan(plan);
  const allowed = Boolean(getEntitlements(resolvedPlan)[feature]);
  return allowed
    ? { allowed, feature, plan: resolvedPlan, reason: "included" }
    : { allowed, feature, plan: resolvedPlan, reason: "upgrade_required" };
}
