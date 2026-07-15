import {
  computeCreditCost,
  hasSufficientCredits,
  InsufficientCreditsError,
} from "@/lib/billing/credits";
import { isUnlimitedCreditsEnabled } from "@/lib/billing/config";
import { loadAndSyncBillingState } from "@/lib/billing/service";
import {
  captureUsage,
  refundUsage,
  reserveUsage,
} from "@/lib/billing/usage-ledger";
import {
  logMeteredUsageEvent,
  logMeteredUsageFailure,
} from "@/lib/diagnostics/domain-events";

export interface MeteredUsageReservation {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  ledgerReserved: boolean;
}

export type ReserveMeteredUsageResult =
  | { ok: true; reservation: MeteredUsageReservation }
  | {
      ok: false;
      reason: "insufficient-credits";
      creditCost: number;
      balance: number;
      periodEnd: Date;
      message: string;
    };

export type CaptureMeteredUsageResult =
  | { ok: true }
  | { ok: false; error: unknown; insufficientCredits: boolean };

export interface ReserveMeteredUsageOptions {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditText: string;
}

function insufficientCreditsResult(args: {
  idempotencyKey: string;
  operation: string;
  userId: string;
  creditCost: number;
  balance: number;
  periodEnd: Date;
}): ReserveMeteredUsageResult {
  const { idempotencyKey, operation, userId, creditCost, balance, periodEnd } =
    args;
  const message =
    `Insufficient credits: you need ${creditCost} but have ${balance}. ` +
    `Your credits reset on ${periodEnd.toLocaleDateString()}. ` +
    "Upgrade your plan or wait for your credits to reset.";

  logMeteredUsageEvent("reserve", "insufficient credits", {
    idempotencyKey,
    operation,
    creditCost,
    userId,
    status: "denied",
  });

  return {
    ok: false,
    reason: "insufficient-credits",
    creditCost,
    balance,
    periodEnd,
    message,
  };
}

export async function reserveMeteredUsage(
  opts: ReserveMeteredUsageOptions,
): Promise<ReserveMeteredUsageResult> {
  const { idempotencyKey, userId, operation, creditText } = opts;

  if (isUnlimitedCreditsEnabled()) {
    return {
      ok: true,
      reservation: {
        idempotencyKey,
        userId,
        operation,
        creditCost: 0,
        ledgerReserved: false,
      },
    };
  }

  const creditCost = computeCreditCost(creditText);
  const billingState = await loadAndSyncBillingState(userId);

  if (!hasSufficientCredits(billingState.creditBalance, creditCost)) {
    return insufficientCreditsResult({
      idempotencyKey,
      operation,
      userId,
      creditCost,
      balance: billingState.creditBalance,
      periodEnd: billingState.periodEnd,
    });
  }

  if (creditCost > 0) {
    try {
      await reserveUsage({ idempotencyKey, userId, operation, creditCost });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return insufficientCreditsResult({
          idempotencyKey,
          operation,
          userId,
          creditCost,
          balance: error.balance,
          periodEnd: billingState.periodEnd,
        });
      }

      logMeteredUsageFailure("reserve", error, {
        idempotencyKey,
        operation,
        creditCost,
        userId,
      });
      throw error;
    }
  }

  return {
    ok: true,
    reservation: {
      idempotencyKey,
      userId,
      operation,
      creditCost,
      ledgerReserved: creditCost > 0,
    },
  };
}

export async function captureMeteredUsage(
  reservation: MeteredUsageReservation,
): Promise<CaptureMeteredUsageResult> {
  if (reservation.creditCost <= 0) {
    return { ok: true };
  }

  if (!reservation.ledgerReserved) {
    const error = new Error(
      "captureMeteredUsage requires a durable reservation for positive-cost usage.",
    );
    logMeteredUsageFailure("capture", error, {
      idempotencyKey: reservation.idempotencyKey,
      operation: reservation.operation,
      creditCost: reservation.creditCost,
      userId: reservation.userId,
    });
    return {
      ok: false,
      error,
      insufficientCredits: false,
    };
  }

  try {
    await captureUsage({
      idempotencyKey: reservation.idempotencyKey,
      userId: reservation.userId,
      creditCost: reservation.creditCost,
    });

    logMeteredUsageEvent("capture", "captured", {
      idempotencyKey: reservation.idempotencyKey,
      operation: reservation.operation,
      creditCost: reservation.creditCost,
      userId: reservation.userId,
      status: "captured",
    });
    return { ok: true };
  } catch (error) {
    logMeteredUsageFailure("capture", error, {
      idempotencyKey: reservation.idempotencyKey,
      operation: reservation.operation,
      creditCost: reservation.creditCost,
      userId: reservation.userId,
    });
    return {
      ok: false,
      error,
      insufficientCredits: error instanceof InsufficientCreditsError,
    };
  }
}

export async function refundMeteredUsage(
  reservation: MeteredUsageReservation,
): Promise<void> {
  if (!reservation.ledgerReserved) {
    return;
  }

  const refunded = await refundUsage({
    idempotencyKey: reservation.idempotencyKey,
  });
  logMeteredUsageEvent("refund", "refunded", {
    idempotencyKey: reservation.idempotencyKey,
    operation: reservation.operation,
    creditCost: reservation.creditCost,
    userId: reservation.userId,
    status: refunded?.status ?? "missing",
  });
}
