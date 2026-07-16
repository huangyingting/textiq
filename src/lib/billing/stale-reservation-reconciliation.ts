import { logInfo } from "@/lib/log";
import { prisma } from "@/lib/prisma";

import {
  refundUsageByKeyHash,
  USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
} from "./usage-ledger";

export const DEFAULT_STALE_RESERVATION_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_STALE_RESERVATION_BATCH_SIZE = 100;
const MAX_STALE_RESERVATION_BATCH_SIZE = 500;

type ReconciliationClient = typeof prisma;

export interface ReconcileStaleReservationsOptions {
  now?: Date;
  ttlMs?: number;
  batchSize?: number;
  client?: ReconciliationClient;
}

export interface ReconcileStaleReservationsResult {
  cutoff: Date;
  scanned: number;
  refunded: number;
  refundedLegacy: number;
  captured: number;
  unresolved: number;
  failed: number;
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) {
    return DEFAULT_STALE_RESERVATION_BATCH_SIZE;
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(
      `batchSize must be a positive integer; received "${batchSize}".`,
    );
  }

  return Math.min(batchSize, MAX_STALE_RESERVATION_BATCH_SIZE);
}

function normalizeTtlMs(ttlMs: number | undefined): number {
  if (ttlMs === undefined) {
    return DEFAULT_STALE_RESERVATION_TTL_MS;
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`ttlMs must be a positive number; received "${ttlMs}".`);
  }

  return ttlMs;
}

/**
 * Reconciles stale reserved usage-ledger rows in bounded batches.
 *
 * New-format holds (`reservationVersion >= 1`) are refunded through the normal
 * idempotent refund path (one credit increment). Legacy pre-hold rows
 * (`reservationVersion = 0`) are transitioned to refunded without balance
 * increment by the same refund primitive.
 */
export async function reconcileStaleReservedUsage(
  opts: ReconcileStaleReservationsOptions = {},
): Promise<ReconcileStaleReservationsResult> {
  const {
    now = new Date(),
    client = prisma,
    ttlMs: rawTtlMs,
    batchSize: rawBatchSize,
  } = opts;
  const ttlMs = normalizeTtlMs(rawTtlMs);
  const batchSize = normalizeBatchSize(rawBatchSize);
  const cutoff = new Date(now.getTime() - ttlMs);

  const candidates = await client.usageLedgerEntry.findMany({
    where: {
      status: "reserved",
      reservedAt: { lt: cutoff },
    },
    orderBy: [{ reservedAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      keyHash: true,
      userId: true,
      operation: true,
      creditCost: true,
      reservationVersion: true,
    },
  });

  let refunded = 0;
  let refundedLegacy = 0;
  let captured = 0;
  let unresolved = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const settled = await refundUsageByKeyHash({
        keyHash: candidate.keyHash,
        userId: candidate.userId,
        operation: candidate.operation,
        creditCost: candidate.creditCost,
        client,
      });

      if (settled?.status === "refunded") {
        refunded += 1;
        if (
          candidate.reservationVersion <
          USAGE_LEDGER_RESERVATION_VERSION_CURRENT
        ) {
          refundedLegacy += 1;
        }
        continue;
      }

      if (settled?.status === "captured") {
        captured += 1;
        continue;
      }

      unresolved += 1;
    } catch (error) {
      failed += 1;
      logInfo(
        "billing.ledger.reconcile",
        "stale reservation reconcile failed",
        {
          keyHash: candidate.keyHash,
          operation: candidate.operation,
          creditCost: candidate.creditCost,
          reservationVersion: candidate.reservationVersion,
          error:
            error instanceof Error
              ? error.name
              : typeof error === "string"
                ? error
                : "unknown",
        },
      );
    }
  }

  const result: ReconcileStaleReservationsResult = {
    cutoff,
    scanned: candidates.length,
    refunded,
    refundedLegacy,
    captured,
    unresolved,
    failed,
  };

  logInfo(
    "billing.ledger.reconcile",
    "stale reservation reconciliation batch",
    {
      cutoff: cutoff.toISOString(),
      scanned: result.scanned,
      refunded: result.refunded,
      refundedLegacy: result.refundedLegacy,
      captured: result.captured,
      unresolved: result.unresolved,
      failed: result.failed,
      ttlMs,
      batchSize,
    },
  );

  return result;
}
