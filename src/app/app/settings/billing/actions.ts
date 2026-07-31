/**
 * Billing server actions — plan management for the billing settings page.
 *
 * These actions call the active BillingProvider (mock in dev/CI, Stripe when
 * STRIPE_SECRET_KEY is set) and revalidate the settings page on success.
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import {
  getBillingProvider,
  type ChangePlanResult,
} from "@/lib/billing/provider";
import { isPlan, type Plan } from "@/lib/billing/catalog";
import {
  BILLING_ACTION_FAILURE_MESSAGE,
  type BillingActionData,
} from "@/lib/billing/action-types";
import { logError } from "@/lib/log";

/** Change the current user's plan (upgrade or downgrade). */
export async function changePlanAction(
  targetPlan: string,
): Promise<ActionResult<BillingActionData>> {
  const user = await requireUser(redirect);

  if (!isPlan(targetPlan)) {
    return actionError(`Invalid plan: ${targetPlan}.`);
  }

  let result: ChangePlanResult;
  try {
    const provider = await getBillingProvider();
    result = await provider.changePlan(user.id, targetPlan as Plan);
  } catch (error) {
    logError("billing.plan-change", error, { targetPlan });
    return actionError(BILLING_ACTION_FAILURE_MESSAGE);
  }

  if (!result.success) {
    return actionError(result.message);
  }

  revalidatePath("/app/settings/billing");
  revalidatePath("/app/settings");

  return actionOk({ message: result.message, redirectUrl: result.redirectUrl });
}

/** Cancel the current user's subscription. */
export async function cancelSubscriptionAction(): Promise<
  ActionResult<BillingActionData>
> {
  const user = await requireUser(redirect);

  let result: ChangePlanResult;
  try {
    const provider = await getBillingProvider();
    result = await provider.cancelSubscription(user.id);
  } catch (error) {
    logError("billing.subscription-cancel", error);
    return actionError(BILLING_ACTION_FAILURE_MESSAGE);
  }

  if (!result.success) {
    return actionError(result.message);
  }

  revalidatePath("/app/settings/billing");
  revalidatePath("/app/settings");

  return actionOk({ message: result.message });
}
