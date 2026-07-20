/**
 * Durable generation usage ledger with explicit reserve / capture / refund
 * state transitions.
 *
 * Hold-on-reserve state machine:
 * - reserve: atomically decrement balance + create `reserved`.
 * - capture: compare-and-swap `reserved` -> `captured` (no balance mutation).
 * - refund: compare-and-swap `reserved` -> `refunded` (+ one balance increment
 *   only for current-period hold-on-reserve rows).
 *
 * Captured/refunded are terminal states.
 */

import { Prisma } from "@/generated/prisma/client";
import { resolveProvider } from "@/lib/db-provider";
import { withP2002Fallback } from "@/lib/db/p2002-fallback";
import type { PrismaTransactionClient } from "@/lib/prisma-surface";
import {
  logUsageLedgerEvent,
  logUsageLedgerFailure,
} from "@/lib/diagnostics/domain-events";
import { prisma } from "@/lib/prisma";

import { InsufficientCreditsError } from "./credits";
import { syncBillingPeriodState } from "./period-reset";
import {
  deriveUsageLedgerKeyHash,
  USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
} from "./usage-ledger-key";

export type LedgerStatus = "reserved" | "captured" | "refunded";

export const USAGE_LEDGER_RESERVATION_VERSION_CURRENT = 1;
const USAGE_LEDGER_MAX_TRANSACTION_ATTEMPTS = 4;
const RETRYABLE_USAGE_LEDGER_ERROR_CODES = new Set(["P2034"]);

const USAGE_LEDGER_STATE_MACHINE = {
  reserve: {
    creates: "reserved",
    idempotentStatuses: ["reserved", "captured", "refunded"],
  },
  capture: {
    allowedFrom: ["reserved"],
    idempotentStatuses: ["captured"],
    conflictingStatuses: ["refunded"],
  },
  refund: {
    allowedFrom: ["reserved"],
    idempotentStatuses: ["refunded", "captured"],
  },
  terminalStatuses: ["captured", "refunded"],
} as const;

export { USAGE_LEDGER_STATE_MACHINE };

type UsageLedgerClient = Pick<
  typeof prisma,
  "$transaction" | "usageLedgerEntry" | "user"
>;

type UsageLedgerTransactionClient = PrismaTransactionClient;

export class UsageLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLedgerConflictError";
  }
}

export class UsageLedgerTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLedgerTransitionError";
  }
}

export interface UsageLedgerEntry {
  id: string;
  keyHash: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: LedgerStatus;
  reservationVersion: number;
  reservedAt: Date;
  capturedAt: Date | null;
  refundedAt: Date | null;
}

export interface ReserveOptions {
  idempotencyKey: string;
  userId: string;
  /** Logical operation name, e.g. "generate" or "generate-deck". */
  operation: string;
  creditCost: number;
  client?: UsageLedgerClient;
}

export interface CaptureOptions {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  client?: UsageLedgerClient;
}

export interface RefundOptions {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  client?: UsageLedgerClient;
}

export interface RefundByKeyHashOptions {
  keyHash: string;
  userId: string;
  operation: string;
  creditCost: number;
  client?: UsageLedgerClient;
}

interface ReservationFingerprint {
  keyHash: string;
  userId: string;
  operation: string;
  creditCost: number;
}

function isLedgerStatus(status: string): status is LedgerStatus {
  return (
    status === "reserved" || status === "captured" || status === "refunded"
  );
}

function toUsageLedgerEntry(entry: {
  id: string;
  keyHash: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: string;
  reservationVersion: number;
  reservedAt: Date;
  capturedAt: Date | null;
  refundedAt: Date | null;
}): UsageLedgerEntry {
  if (!isLedgerStatus(entry.status)) {
    throw new UsageLedgerTransitionError(
      `[usage-ledger] Unknown ledger status "${entry.status}" for key hash "${entry.keyHash}".`,
    );
  }

  return {
    id: entry.id,
    keyHash: entry.keyHash,
    userId: entry.userId,
    operation: entry.operation,
    creditCost: entry.creditCost,
    status: entry.status,
    reservationVersion: entry.reservationVersion,
    reservedAt: entry.reservedAt,
    capturedAt: entry.capturedAt,
    refundedAt: entry.refundedAt,
  };
}

function assertReservationFingerprint(
  entry: Pick<
    UsageLedgerEntry,
    "keyHash" | "userId" | "operation" | "creditCost"
  >,
  expected: ReservationFingerprint,
): void {
  if (
    entry.keyHash === expected.keyHash &&
    entry.userId === expected.userId &&
    entry.operation === expected.operation &&
    entry.creditCost === expected.creditCost
  ) {
    return;
  }

  throw new UsageLedgerConflictError(
    `[usage-ledger] reservation fingerprint mismatch for key hash "${expected.keyHash}".`,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string }).code === "P2002";
}

function isReservationInBillingPeriod(
  entry: Pick<UsageLedgerEntry, "reservedAt">,
  period: { periodStart: Date; periodEnd: Date },
): boolean {
  const reservedAtMs = entry.reservedAt.getTime();
  return (
    reservedAtMs >= period.periodStart.getTime() &&
    reservedAtMs < period.periodEnd.getTime()
  );
}

function isRetryableUsageLedgerError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" && RETRYABLE_USAGE_LEDGER_ERROR_CODES.has(code)
  );
}

function usageLedgerTransactionOptions():
  | {
      isolationLevel: Prisma.TransactionIsolationLevel;
    }
  | undefined {
  if (resolveProvider() === "postgres") {
    return { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
  }

  return undefined;
}

async function runUsageLedgerTransaction<T>(
  client: UsageLedgerClient,
  work: (tx: UsageLedgerTransactionClient) => Promise<T>,
): Promise<T> {
  const transactionOptions = usageLedgerTransactionOptions();

  for (
    let attempt = 1;
    attempt <= USAGE_LEDGER_MAX_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      if (transactionOptions) {
        return await client.$transaction(work, transactionOptions);
      }
      return await client.$transaction(work);
    } catch (error) {
      if (
        attempt < USAGE_LEDGER_MAX_TRANSACTION_ATTEMPTS &&
        isRetryableUsageLedgerError(error)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("[usage-ledger] transaction retries exhausted.");
}

/**
 * Records generation intent in the ledger (status = "reserved") while
 * atomically decrementing credits for hold-on-reserve accounting.
 */
export async function reserveUsage(
  opts: ReserveOptions,
): Promise<UsageLedgerEntry> {
  const {
    idempotencyKey,
    userId,
    operation,
    creditCost,
    client = prisma,
  } = opts;
  const keyHash = deriveUsageLedgerKeyHash({
    idempotencyKey,
    userId,
    operation,
  });
  const expected: ReservationFingerprint = {
    keyHash,
    userId,
    operation,
    creditCost,
  };

  try {
    const entry = await withP2002Fallback(
      () =>
        runUsageLedgerTransaction(client, async (tx) => {
          const existing = await tx.usageLedgerEntry.findUnique({
            where: { keyHash },
          });
          if (existing) {
            const existingEntry = toUsageLedgerEntry(existing);
            assertReservationFingerprint(existingEntry, expected);
            logUsageLedgerEvent("reserve", "idempotent reserve", {
              keyHash,
              operation,
              creditCost,
              status: existingEntry.status,
              reservationVersion: existingEntry.reservationVersion,
            });
            return existingEntry;
          }

          await syncBillingPeriodState({
            userId,
            now: new Date(),
            userClient: tx.user,
          });

          if (creditCost > 0) {
            const debit = await tx.user.updateMany({
              where: { id: userId, creditBalance: { gte: creditCost } },
              data: { creditBalance: { decrement: creditCost } },
            });

            if (debit.count === 0) {
              const current = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { creditBalance: true },
              });
              throw new InsufficientCreditsError(
                current.creditBalance,
                creditCost,
              );
            }
          }

          const created = await tx.usageLedgerEntry.create({
            data: {
              keyHash,
              keyHashVersion: USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
              userId,
              operation,
              creditCost,
              status: "reserved",
              reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
            },
          });

          return toUsageLedgerEntry(created);
        }),
      async () => {
        const winner = await client.usageLedgerEntry.findUnique({
          where: { keyHash },
        });
        if (!winner) {
          return null;
        }

        const winnerEntry = toUsageLedgerEntry(winner);
        assertReservationFingerprint(winnerEntry, expected);
        return winnerEntry;
      },
    );

    logUsageLedgerEvent("reserve", "reserved", {
      keyHash,
      operation,
      creditCost,
      status: entry.status,
      reservationVersion: entry.reservationVersion,
    });

    return entry;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      logUsageLedgerFailure("reserve", error, {
        keyHash,
        operation,
        creditCost,
      });
    }
    throw error;
  }
}

/**
 * Captures a reservation by transitioning reserved -> captured. Capture does not
 * mutate the user balance under hold-on-reserve semantics.
 */
export async function captureUsage(
  opts: CaptureOptions,
): Promise<UsageLedgerEntry> {
  const {
    idempotencyKey,
    userId,
    operation,
    creditCost,
    client = prisma,
  } = opts;
  const keyHash = deriveUsageLedgerKeyHash({
    idempotencyKey,
    userId,
    operation,
  });
  const expected: ReservationFingerprint = {
    keyHash,
    userId,
    operation,
    creditCost,
  };

  try {
    return await runUsageLedgerTransaction(client, async (tx) => {
      const existing = await tx.usageLedgerEntry.findUnique({
        where: { keyHash },
      });

      if (!existing) {
        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: no ledger entry found for key hash "${keyHash}". Call reserveUsage first.`,
        );
      }

      const current = toUsageLedgerEntry(existing);
      assertReservationFingerprint(current, expected);

      if (current.status === "captured") {
        logUsageLedgerEvent("capture", "idempotent capture", {
          keyHash,
          operation,
          creditCost,
          status: current.status,
          reservationVersion: current.reservationVersion,
        });
        return current;
      }

      if (current.status === "refunded") {
        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: cannot capture refunded reservation for key hash "${keyHash}".`,
        );
      }

      if (
        current.reservationVersion < USAGE_LEDGER_RESERVATION_VERSION_CURRENT
      ) {
        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: legacy reservation version "${current.reservationVersion}" requires reconciliation before capture.`,
        );
      }

      const capturedAt = new Date();
      const cas = await tx.usageLedgerEntry.updateMany({
        where: {
          keyHash,
          userId,
          operation,
          creditCost,
          status: "reserved",
          reservationVersion: {
            gte: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
          },
        },
        data: { status: "captured", capturedAt, refundedAt: null },
      });

      if (cas.count !== 1) {
        const raced = await tx.usageLedgerEntry.findUnique({
          where: { keyHash },
        });
        if (!raced) {
          throw new UsageLedgerTransitionError(
            `[usage-ledger] captureUsage: ledger entry disappeared for key hash "${keyHash}".`,
          );
        }

        const racedEntry = toUsageLedgerEntry(raced);
        assertReservationFingerprint(racedEntry, expected);

        if (racedEntry.status === "captured") {
          return racedEntry;
        }
        if (racedEntry.status === "refunded") {
          throw new UsageLedgerTransitionError(
            `[usage-ledger] captureUsage: reservation already refunded for key hash "${keyHash}".`,
          );
        }
        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: compare-and-swap failed for key hash "${keyHash}".`,
        );
      }

      const updated = toUsageLedgerEntry(
        await tx.usageLedgerEntry.findUniqueOrThrow({
          where: { keyHash },
        }),
      );

      logUsageLedgerEvent("capture", "captured", {
        keyHash,
        operation,
        creditCost,
        status: updated.status,
        reservationVersion: updated.reservationVersion,
      });

      return updated;
    });
  } catch (error) {
    logUsageLedgerFailure("capture", error, {
      keyHash,
      operation,
      creditCost,
    });
    throw error;
  }
}

/**
 * Refunds by scoped key hash. New-format current-period holds increment balance
 * exactly once; legacy and prior-period rows transition to refunded without
 * incrementing.
 */
export async function refundUsageByKeyHash(
  opts: RefundByKeyHashOptions,
): Promise<UsageLedgerEntry | null> {
  const { keyHash, userId, operation, creditCost, client = prisma } = opts;
  const expected: ReservationFingerprint = {
    keyHash,
    userId,
    operation,
    creditCost,
  };

  try {
    return await runUsageLedgerTransaction(client, async (tx) => {
      const existing = await tx.usageLedgerEntry.findUnique({
        where: { keyHash },
      });

      if (!existing) {
        logUsageLedgerEvent("refund", "idempotent refund (missing)", {
          keyHash,
          operation,
          creditCost,
        });
        return null;
      }

      const current = toUsageLedgerEntry(existing);
      assertReservationFingerprint(current, expected);

      if (current.status === "refunded" || current.status === "captured") {
        logUsageLedgerEvent("refund", "idempotent refund", {
          keyHash,
          operation,
          creditCost,
          status: current.status,
          reservationVersion: current.reservationVersion,
        });
        return current;
      }

      const billingPeriod = await syncBillingPeriodState({
        userId: current.userId,
        now: new Date(),
        userClient: tx.user,
      });

      const refundedAt = new Date();
      const cas = await tx.usageLedgerEntry.updateMany({
        where: {
          keyHash,
          userId,
          operation,
          creditCost,
          status: "reserved",
        },
        data: { status: "refunded", refundedAt },
      });

      if (cas.count !== 1) {
        const raced = await tx.usageLedgerEntry.findUnique({
          where: { keyHash },
        });
        if (!raced) {
          return null;
        }

        const racedEntry = toUsageLedgerEntry(raced);
        assertReservationFingerprint(racedEntry, expected);
        if (
          racedEntry.status === "refunded" ||
          racedEntry.status === "captured"
        ) {
          return racedEntry;
        }

        throw new UsageLedgerTransitionError(
          `[usage-ledger] refundUsage: compare-and-swap failed for key hash "${keyHash}".`,
        );
      }

      if (
        current.reservationVersion >=
          USAGE_LEDGER_RESERVATION_VERSION_CURRENT &&
        current.creditCost > 0 &&
        isReservationInBillingPeriod(current, billingPeriod)
      ) {
        const creditRestore = await tx.user.updateMany({
          where: { id: current.userId },
          data: { creditBalance: { increment: current.creditCost } },
        });

        if (creditRestore.count !== 1) {
          throw new UsageLedgerTransitionError(
            `[usage-ledger] refundUsage: failed to restore credits for key hash "${keyHash}".`,
          );
        }
      }

      const updated = toUsageLedgerEntry(
        await tx.usageLedgerEntry.findUniqueOrThrow({
          where: { keyHash },
        }),
      );

      logUsageLedgerEvent("refund", "refunded", {
        keyHash,
        operation,
        creditCost,
        status: updated.status,
        reservationVersion: updated.reservationVersion,
      });

      return updated;
    });
  } catch (error) {
    logUsageLedgerFailure("refund", error, {
      keyHash,
      operation,
      creditCost,
    });
    throw error;
  }
}

export async function refundUsage(
  opts: RefundOptions,
): Promise<UsageLedgerEntry | null> {
  const {
    idempotencyKey,
    userId,
    operation,
    creditCost,
    client = prisma,
  } = opts;
  const keyHash = deriveUsageLedgerKeyHash({
    idempotencyKey,
    userId,
    operation,
  });

  return refundUsageByKeyHash({
    keyHash,
    userId,
    operation,
    creditCost,
    client,
  });
}
