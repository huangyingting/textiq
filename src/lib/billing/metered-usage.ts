import {
  computeCreditCost,
  InsufficientCreditsError,
} from "@/lib/billing/credits";
import { isUnlimitedCreditsEnabled } from "@/lib/billing/config";
import {
  loadAndSyncBillingState,
  type BillingState,
} from "@/lib/billing/service";
import {
  captureUsage as captureUsageInLedger,
  refundUsage as refundUsageInLedger,
  reserveUsage as reserveUsageInLedger,
  type CaptureOptions,
  type RefundOptions,
  type ReserveOptions,
  type UsageLedgerEntry,
  UsageLedgerConflictError,
} from "@/lib/billing/usage-ledger";
import { deriveUsageLedgerKeyHash } from "@/lib/billing/usage-ledger-key";
import {
  logMeteredUsageEvent,
  logMeteredUsageFailure,
} from "@/lib/diagnostics/domain-events";

export interface MeteredUsageReservation {
  idempotencyKey: string;
  keyHash: string;
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
    }
  | {
      ok: false;
      reason: "idempotency-conflict";
      message: string;
    };

export type CaptureMeteredUsageResult =
  { ok: true } | { ok: false; error: unknown; insufficientCredits: boolean };

export interface ReserveMeteredUsageOptions {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditText: string;
}

type MeteredBillingState = Pick<BillingState, "creditBalance" | "periodEnd">;

export interface MeteredUsageDeps {
  isUnlimitedCreditsEnabled(): boolean;
  computeCreditCost(creditText: string): number;
  loadAndSyncBillingState(userId: string): Promise<MeteredBillingState>;
  reserveUsage(opts: ReserveOptions): Promise<UsageLedgerEntry>;
  captureUsage(opts: CaptureOptions): Promise<UsageLedgerEntry>;
  refundUsage(opts: RefundOptions): Promise<UsageLedgerEntry | null>;
}

const defaultMeteredUsageDeps: MeteredUsageDeps = {
  isUnlimitedCreditsEnabled,
  computeCreditCost,
  loadAndSyncBillingState,
  reserveUsage: reserveUsageInLedger,
  captureUsage: captureUsageInLedger,
  refundUsage: refundUsageInLedger,
};

function insufficientCreditsResult(args: {
  keyHash: string;
  operation: string;
  userId: string;
  creditCost: number;
  balance: number;
  periodEnd: Date;
}): ReserveMeteredUsageResult {
  const { keyHash, operation, userId, creditCost, balance, periodEnd } = args;
  const message =
    `Insufficient credits: you need ${creditCost} but have ${balance}. ` +
    `Your credits reset on ${periodEnd.toLocaleDateString()}. ` +
    "Upgrade your plan or wait for your credits to reset.";

  logMeteredUsageEvent("reserve", "insufficient credits", {
    keyHash,
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
  deps: MeteredUsageDeps = defaultMeteredUsageDeps,
): Promise<ReserveMeteredUsageResult> {
  const { idempotencyKey, userId, operation, creditText } = opts;
  const keyHash = deriveUsageLedgerKeyHash({
    idempotencyKey,
    userId,
    operation,
  });

  if (deps.isUnlimitedCreditsEnabled()) {
    return {
      ok: true,
      reservation: {
        idempotencyKey,
        keyHash,
        userId,
        operation,
        creditCost: 0,
        ledgerReserved: false,
      },
    };
  }

  const creditCost = deps.computeCreditCost(creditText);

  if (creditCost > 0) {
    try {
      await deps.reserveUsage({
        idempotencyKey,
        userId,
        operation,
        creditCost,
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        const billingState = await deps.loadAndSyncBillingState(userId);
        return insufficientCreditsResult({
          keyHash,
          operation,
          userId,
          creditCost,
          balance: error.balance,
          periodEnd: billingState.periodEnd,
        });
      }

      if (error instanceof UsageLedgerConflictError) {
        return {
          ok: false,
          reason: "idempotency-conflict",
          message:
            "The provided Idempotency-Key was already used for a different operation fingerprint.",
        };
      }

      logMeteredUsageFailure("reserve", error, {
        keyHash,
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
      keyHash,
      userId,
      operation,
      creditCost,
      ledgerReserved: creditCost > 0,
    },
  };
}

export async function captureMeteredUsage(
  reservation: MeteredUsageReservation,
  deps: MeteredUsageDeps = defaultMeteredUsageDeps,
): Promise<CaptureMeteredUsageResult> {
  if (reservation.creditCost <= 0) {
    return { ok: true };
  }

  if (!reservation.ledgerReserved) {
    const error = new Error(
      "captureMeteredUsage requires a durable reservation for positive-cost usage.",
    );
    logMeteredUsageFailure("capture", error, {
      keyHash: reservation.keyHash,
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
    await deps.captureUsage({
      idempotencyKey: reservation.idempotencyKey,
      userId: reservation.userId,
      operation: reservation.operation,
      creditCost: reservation.creditCost,
    });

    logMeteredUsageEvent("capture", "captured", {
      keyHash: reservation.keyHash,
      operation: reservation.operation,
      creditCost: reservation.creditCost,
      userId: reservation.userId,
      status: "captured",
    });
    return { ok: true };
  } catch (error) {
    logMeteredUsageFailure("capture", error, {
      keyHash: reservation.keyHash,
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
  deps: MeteredUsageDeps = defaultMeteredUsageDeps,
): Promise<UsageLedgerEntry | null> {
  if (!reservation.ledgerReserved) {
    return null;
  }

  const refunded = await deps.refundUsage({
    idempotencyKey: reservation.idempotencyKey,
    userId: reservation.userId,
    operation: reservation.operation,
    creditCost: reservation.creditCost,
  });
  logMeteredUsageEvent("refund", "refunded", {
    keyHash: reservation.keyHash,
    operation: reservation.operation,
    creditCost: reservation.creditCost,
    userId: reservation.userId,
    status: refunded?.status ?? "missing",
    reservationVersion: refunded?.reservationVersion,
  });
  return refunded;
}
