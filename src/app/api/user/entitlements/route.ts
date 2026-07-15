/**
 * GET /api/user/entitlements — returns the current user's plan entitlements.
 *
 * Used by client components (export dialog, brand studio gate) to gate
 * paid-only features without exposing the full user record.
 *
 * Returns 401 for unauthenticated users. Unauthenticated callers should
 * receive free-tier entitlements by default (the caller handles that case).
 */

import { NextResponse } from "next/server";

import { unauthorized } from "@/lib/api/errors";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { createEntitlementFacade } from "@/lib/billing/entitlement-facade";
import {
  loadAndSyncBillingState,
  type BillingStateReadClient,
} from "@/lib/billing/service";

export const runtime = "nodejs";

const ENTITLEMENTS_BILLING_READ_CLIENT: BillingStateReadClient = {
  user: prisma.user,
  subscription: null,
};

export async function loadEntitlementsBillingState(
  userId: string,
  client: BillingStateReadClient = ENTITLEMENTS_BILLING_READ_CLIENT,
) {
  return loadAndSyncBillingState(userId, client);
}

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return unauthorized();
  }

  // Load and sync billing state so the period-rollover reset is applied here
  // too; otherwise this endpoint reports a stale raw balance that disagrees
  // with the generate API until the next generation resets it.
  const billingState = await loadEntitlementsBillingState(user.id);
  const entitlements = createEntitlementFacade(billingState.plan).entitlements;

  return NextResponse.json({
    plan: billingState.plan,
    creditBalance: billingState.creditBalance,
    entitlements,
  });
}
