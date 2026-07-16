import { prisma } from "@/lib/prisma";

import { getEntitlements, resolvePlan, type Plan } from "./catalog";

const BILLING_PERIOD_SYNC_MAX_ATTEMPTS = 4;
const RETRYABLE_BILLING_PERIOD_ERROR_CODES = new Set(["P2034"]);

type BillingUserClient = Pick<
  typeof prisma.user,
  "findUniqueOrThrow" | "updateMany"
>;

interface BillingPeriodSnapshot {
  rawPlan: string;
  creditBalance: number;
  creditPeriodStart: Date | null;
}

export interface BillingPeriodState {
  plan: Plan;
  rawPlan: string;
  creditBalance: number;
  creditPeriodStart: Date;
  periodStart: Date;
  periodEnd: Date;
  creditsPerPeriod: number;
  resetApplied: boolean;
}

function isRetryableBillingPeriodError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" && RETRYABLE_BILLING_PERIOD_ERROR_CODES.has(code)
  );
}

function isPeriodResetRequired(
  periodStart: Date | null,
  now: Date,
  periodMs: number,
): boolean {
  return !periodStart || now.getTime() - periodStart.getTime() >= periodMs;
}

function buildBillingPeriodState(input: {
  rawPlan: string;
  creditBalance: number;
  creditPeriodStart: Date;
  resetApplied: boolean;
}): BillingPeriodState {
  const { rawPlan, creditBalance, creditPeriodStart, resetApplied } = input;
  const plan = resolvePlan(rawPlan);
  const entitlements = getEntitlements(plan);
  const periodMs = entitlements.periodDays * 24 * 60 * 60 * 1000;

  return {
    plan,
    rawPlan,
    creditBalance,
    creditPeriodStart,
    periodStart: creditPeriodStart,
    periodEnd: new Date(creditPeriodStart.getTime() + periodMs),
    creditsPerPeriod: entitlements.creditsPerPeriod,
    resetApplied,
  };
}

async function readBillingPeriodSnapshot(
  userId: string,
  userClient: BillingUserClient,
): Promise<BillingPeriodSnapshot> {
  const user = await userClient.findUniqueOrThrow({
    where: { id: userId },
    select: {
      plan: true,
      creditBalance: true,
      creditPeriodStart: true,
    },
  });

  return {
    rawPlan: user.plan,
    creditBalance: user.creditBalance,
    creditPeriodStart: user.creditPeriodStart,
  };
}

/**
 * Ensures the user's credit period is current using a compare-and-swap reset.
 * Shared by billing state reads and reserve critical sections so reset races
 * cannot overwrite in-flight debit/refund balance mutations.
 */
export async function syncBillingPeriodState(opts: {
  userId: string;
  now?: Date;
  userClient?: BillingUserClient;
}): Promise<BillingPeriodState> {
  const { userId, now = new Date(), userClient = prisma.user } = opts;

  for (
    let attempt = 1;
    attempt <= BILLING_PERIOD_SYNC_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const snapshot = await readBillingPeriodSnapshot(userId, userClient);
      const plan = resolvePlan(snapshot.rawPlan);
      const entitlements = getEntitlements(plan);
      const periodMs = entitlements.periodDays * 24 * 60 * 60 * 1000;

      if (!isPeriodResetRequired(snapshot.creditPeriodStart, now, periodMs)) {
        return buildBillingPeriodState({
          rawPlan: snapshot.rawPlan,
          creditBalance: snapshot.creditBalance,
          creditPeriodStart: snapshot.creditPeriodStart!,
          resetApplied: false,
        });
      }

      const nextPeriodStart = now;
      const nextBalance = entitlements.creditsPerPeriod;
      const reset = await userClient.updateMany({
        where: {
          id: userId,
          plan: snapshot.rawPlan,
          creditBalance: snapshot.creditBalance,
          creditPeriodStart: snapshot.creditPeriodStart,
        },
        data: {
          creditBalance: nextBalance,
          creditPeriodStart: nextPeriodStart,
        },
      });

      if (reset.count === 1) {
        return buildBillingPeriodState({
          rawPlan: snapshot.rawPlan,
          creditBalance: nextBalance,
          creditPeriodStart: nextPeriodStart,
          resetApplied: true,
        });
      }

      if (attempt < BILLING_PERIOD_SYNC_MAX_ATTEMPTS) {
        continue;
      }

      throw new Error(
        `[billing] Failed to synchronize credit period for user "${userId}" after ${BILLING_PERIOD_SYNC_MAX_ATTEMPTS} attempts.`,
      );
    } catch (error) {
      if (
        attempt < BILLING_PERIOD_SYNC_MAX_ATTEMPTS &&
        isRetryableBillingPeriodError(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `[billing] Failed to synchronize credit period for user "${userId}".`,
  );
}
