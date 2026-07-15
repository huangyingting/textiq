/**
 * Durable generation usage ledger with explicit reserve / capture / refund
 * state transitions.
 *
 * State machine:
 * - reserve: ∅ -> reserved (idempotent for reserved/captured/refunded)
 * - capture: reserved -> captured (idempotent for captured, conflict on refunded)
 * - refund: reserved -> refunded (idempotent for refunded/captured)
 *
 * Captured/refunded are terminal states.
 */

import { deductCredits, InsufficientCreditsError } from "@/lib/billing/credits";
import { withP2002Fallback } from "@/lib/db/p2002-fallback";
import {
  logUsageLedgerEvent,
  logUsageLedgerFailure,
} from "@/lib/diagnostics/domain-events";
import { prisma } from "@/lib/prisma";

export type LedgerStatus = "reserved" | "captured" | "refunded";

export const USAGE_LEDGER_STATE_MACHINE = {
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
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: LedgerStatus;
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
  client?: typeof prisma;
}

export interface CaptureOptions {
  idempotencyKey: string;
  userId: string;
  creditCost: number;
  client?: typeof prisma;
}

export interface RefundOptions {
  idempotencyKey: string;
  client?: typeof prisma;
}

interface ReservationFingerprint {
  userId: string;
  operation: string;
  creditCost: number;
}

function asUsageLedgerEntry(entry: unknown): UsageLedgerEntry {
  return entry as UsageLedgerEntry;
}

function assertReservationFingerprint(
  entry: Pick<
    UsageLedgerEntry,
    "idempotencyKey" | "userId" | "operation" | "creditCost"
  >,
  expected: ReservationFingerprint,
): void {
  if (
    entry.userId === expected.userId &&
    entry.operation === expected.operation &&
    entry.creditCost === expected.creditCost
  ) {
    return;
  }

  throw new UsageLedgerConflictError(
    `[usage-ledger] idempotency key "${entry.idempotencyKey}" was already used with a different reservation fingerprint.`,
  );
}

function assertCaptureFingerprint(
  entry: Pick<UsageLedgerEntry, "idempotencyKey" | "userId" | "creditCost">,
  expected: Pick<ReservationFingerprint, "userId" | "creditCost">,
): void {
  if (
    entry.userId === expected.userId &&
    entry.creditCost === expected.creditCost
  ) {
    return;
  }

  throw new UsageLedgerConflictError(
    `[usage-ledger] capture fingerprint mismatch for key "${entry.idempotencyKey}".`,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string }).code === "P2002";
}

/**
 * Records generation intent in the ledger (status = "reserved").
 *
 * Atomicity/idempotency:
 * - validates available balance and creates the reservation in one DB transaction
 * - concurrent create races are recovered via P2002 fallback to the winner row
 * - repeated calls with the same key return the existing row (same fingerprint)
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

  const expected: ReservationFingerprint = { userId, operation, creditCost };

  try {
    const entry = await withP2002Fallback(
      () =>
        client.$transaction(async (tx) => {
          const existing = await tx.usageLedgerEntry.findUnique({
            where: { idempotencyKey },
          });
          if (existing) {
            assertReservationFingerprint(
              asUsageLedgerEntry(existing),
              expected,
            );
            logUsageLedgerEvent("reserve", "idempotent reserve", {
              idempotencyKey,
              status: existing.status,
            });
            return asUsageLedgerEntry(existing);
          }

          if (creditCost > 0) {
            const user = await tx.user.findUniqueOrThrow({
              where: { id: userId },
              select: { creditBalance: true },
            });
            if (user.creditBalance < creditCost) {
              throw new InsufficientCreditsError(
                user.creditBalance,
                creditCost,
              );
            }
          }

          return asUsageLedgerEntry(
            await tx.usageLedgerEntry.create({
              data: {
                idempotencyKey,
                userId,
                operation,
                creditCost,
                status: "reserved",
              },
            }),
          );
        }),
      async () => {
        const winner = await client.usageLedgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (!winner) {
          return null;
        }
        assertReservationFingerprint(asUsageLedgerEntry(winner), expected);
        return asUsageLedgerEntry(winner);
      },
    );

    logUsageLedgerEvent("reserve", "reserved", {
      idempotencyKey,
      operation,
      creditCost,
      status: entry.status,
    });

    return entry;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      logUsageLedgerFailure("reserve", error, {
        idempotencyKey,
        operation,
        creditCost,
      });
    }
    throw error;
  }
}

/**
 * Captures a reservation by transitioning reserved -> captured and deducting
 * credits in the same transaction.
 *
 * Provider-neutral CAS algorithm:
 * 1) updateMany WHERE status='reserved' (single-winner transition)
 * 2) deduct credits inside the same transaction
 * 3) commit only if both succeeded (otherwise rollback both)
 *
 * Works for SQLite and Postgres because CAS is encoded as a conditional update.
 */
export async function captureUsage(
  opts: CaptureOptions,
): Promise<UsageLedgerEntry> {
  const { idempotencyKey, userId, creditCost, client = prisma } = opts;

  try {
    return await client.$transaction(async (tx) => {
      const existing = await tx.usageLedgerEntry.findUnique({
        where: { idempotencyKey },
      });

      if (!existing) {
        throw new Error(
          `[usage-ledger] captureUsage: no ledger entry found for key "${idempotencyKey}". Call reserveUsage first.`,
        );
      }

      const current = asUsageLedgerEntry(existing);
      assertCaptureFingerprint(current, { userId, creditCost });

      if (current.status === "captured") {
        logUsageLedgerEvent("capture", "idempotent capture", {
          idempotencyKey,
          status: current.status,
        });
        return current;
      }

      if (current.status === "refunded") {
        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: cannot capture refunded reservation for key "${idempotencyKey}".`,
        );
      }

      const capturedAt = new Date();
      const cas = await tx.usageLedgerEntry.updateMany({
        where: {
          idempotencyKey,
          userId,
          creditCost,
          status: "reserved",
        },
        data: { status: "captured", capturedAt, refundedAt: null },
      });

      if (cas.count !== 1) {
        const raced = await tx.usageLedgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (!raced) {
          throw new Error(
            `[usage-ledger] captureUsage: ledger entry disappeared for key "${idempotencyKey}".`,
          );
        }

        const racedEntry = asUsageLedgerEntry(raced);
        assertCaptureFingerprint(racedEntry, { userId, creditCost });

        if (racedEntry.status === "captured") {
          logUsageLedgerEvent("capture", "idempotent capture (race)", {
            idempotencyKey,
            status: racedEntry.status,
          });
          return racedEntry;
        }

        if (racedEntry.status === "refunded") {
          throw new UsageLedgerTransitionError(
            `[usage-ledger] captureUsage: reservation already refunded for key "${idempotencyKey}".`,
          );
        }

        throw new UsageLedgerTransitionError(
          `[usage-ledger] captureUsage: compare-and-swap failed for key "${idempotencyKey}".`,
        );
      }

      if (creditCost > 0) {
        await deductCredits(userId, creditCost, tx);
      }

      const updated = asUsageLedgerEntry(
        await tx.usageLedgerEntry.findUniqueOrThrow({
          where: { idempotencyKey },
        }),
      );

      logUsageLedgerEvent("capture", "captured", {
        idempotencyKey,
        creditCost,
        status: updated.status,
      });

      return updated;
    });
  } catch (error) {
    logUsageLedgerFailure("capture", error, {
      idempotencyKey,
      creditCost,
    });
    throw error;
  }
}

/**
 * Refunds a reservation by transitioning reserved -> refunded.
 *
 * Idempotent outcomes:
 * - missing key: returns null
 * - already refunded/captured: returns existing row unchanged
 */
export async function refundUsage(
  opts: RefundOptions,
): Promise<UsageLedgerEntry | null> {
  const { idempotencyKey, client = prisma } = opts;

  try {
    return await client.$transaction(async (tx) => {
      const existing = await tx.usageLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (!existing) {
        logUsageLedgerEvent("refund", "idempotent refund (missing)", {
          idempotencyKey,
        });
        return null;
      }

      const current = asUsageLedgerEntry(existing);
      if (current.status === "refunded" || current.status === "captured") {
        logUsageLedgerEvent("refund", "idempotent refund", {
          idempotencyKey,
          status: current.status,
        });
        return current;
      }

      const refundedAt = new Date();
      const cas = await tx.usageLedgerEntry.updateMany({
        where: { idempotencyKey, status: "reserved" },
        data: { status: "refunded", refundedAt },
      });

      if (cas.count !== 1) {
        const raced = await tx.usageLedgerEntry.findUnique({
          where: { idempotencyKey },
        });
        if (!raced) {
          return null;
        }
        const racedEntry = asUsageLedgerEntry(raced);
        if (
          racedEntry.status === "refunded" ||
          racedEntry.status === "captured"
        ) {
          return racedEntry;
        }
        throw new UsageLedgerTransitionError(
          `[usage-ledger] refundUsage: compare-and-swap failed for key "${idempotencyKey}".`,
        );
      }

      const updated = asUsageLedgerEntry(
        await tx.usageLedgerEntry.findUniqueOrThrow({
          where: { idempotencyKey },
        }),
      );

      logUsageLedgerEvent("refund", "refunded", {
        idempotencyKey,
        status: updated.status,
      });

      return updated;
    });
  } catch (error) {
    logUsageLedgerFailure("refund", error, { idempotencyKey });
    throw error;
  }
}
