import { prisma } from "@/lib/prisma";

import {
  deriveUsageLedgerKeyHash,
  USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
} from "./usage-ledger-key";

export const DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE = 100;
const MAX_LEGACY_KEY_BACKFILL_BATCH_SIZE = 500;

type LegacyKeyBackfillClient = Pick<typeof prisma, "usageLedgerEntry">;

export interface LegacyKeyBackfillOptions {
  apply?: boolean;
  batchSize?: number;
  client?: LegacyKeyBackfillClient;
}

export type LegacyKeyBackfillRowOutcome =
  "would-update" | "updated" | "skipped-collision" | "skipped-race";

export interface LegacyKeyBackfillRow {
  keyHash: string;
  userId: string;
  operation: string;
  outcome: LegacyKeyBackfillRowOutcome;
}

export interface LegacyKeyBackfillResult {
  mode: "dry-run" | "apply";
  batchSize: number;
  scanned: number;
  eligible: number;
  updated: number;
  skippedCollision: number;
  skippedRace: number;
  rows: LegacyKeyBackfillRow[];
}

function isPrismaP2002(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "P2002";
}

async function classifyBackfillWriteOutcome(
  client: LegacyKeyBackfillClient,
  candidateId: string,
  keyHash: string,
): Promise<"skipped-collision" | "skipped-race"> {
  const winner = await client.usageLedgerEntry.findUnique({
    where: { keyHash },
    select: { id: true },
  });
  if (winner && winner.id !== candidateId) {
    return "skipped-collision";
  }
  return "skipped-race";
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) {
    return DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE;
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(
      `batchSize must be a positive integer; received "${batchSize}".`,
    );
  }
  return Math.min(batchSize, MAX_LEGACY_KEY_BACKFILL_BATCH_SIZE);
}

/**
 * Backfills reservationVersion=0 usage-ledger rows from legacy raw-key storage
 * to scoped key-hash storage without changing reservation semantics.
 */
export async function backfillLegacyUsageLedgerKeys(
  opts: LegacyKeyBackfillOptions = {},
): Promise<LegacyKeyBackfillResult> {
  const { apply = false, batchSize: rawBatchSize, client = prisma } = opts;
  const batchSize = normalizeBatchSize(rawBatchSize);

  const candidates = await client.usageLedgerEntry.findMany({
    where: {
      reservationVersion: 0,
      keyHashVersion: {
        lt: USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
      },
    },
    orderBy: [{ reservedAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      id: true,
      keyHash: true,
      userId: true,
      operation: true,
    },
  });

  let eligible = 0;
  let updated = 0;
  let skippedCollision = 0;
  let skippedRace = 0;
  const rows: LegacyKeyBackfillRow[] = [];

  for (const candidate of candidates) {
    const nextKeyHash = deriveUsageLedgerKeyHash({
      idempotencyKey: candidate.keyHash,
      userId: candidate.userId,
      operation: candidate.operation,
    });

    const collision = await client.usageLedgerEntry.findUnique({
      where: { keyHash: nextKeyHash },
      select: { id: true },
    });

    if (collision && collision.id !== candidate.id) {
      skippedCollision += 1;
      rows.push({
        keyHash: nextKeyHash,
        userId: candidate.userId,
        operation: candidate.operation,
        outcome: "skipped-collision",
      });
      continue;
    }

    if (!apply) {
      eligible += 1;
      rows.push({
        keyHash: nextKeyHash,
        userId: candidate.userId,
        operation: candidate.operation,
        outcome: "would-update",
      });
      continue;
    }

    let writeCount = 0;
    try {
      const write = await client.usageLedgerEntry.updateMany({
        where: {
          id: candidate.id,
          keyHashVersion: {
            lt: USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
          },
        },
        data: {
          keyHash: nextKeyHash,
          keyHashVersion: USAGE_LEDGER_KEY_HASH_VERSION_CURRENT,
        },
      });
      writeCount = write.count;
    } catch (error) {
      if (!isPrismaP2002(error)) {
        throw error;
      }
      const outcome = await classifyBackfillWriteOutcome(
        client,
        candidate.id,
        nextKeyHash,
      );
      if (outcome === "skipped-collision") {
        skippedCollision += 1;
      } else {
        eligible += 1;
        skippedRace += 1;
      }
      rows.push({
        keyHash: nextKeyHash,
        userId: candidate.userId,
        operation: candidate.operation,
        outcome,
      });
      continue;
    }

    if (writeCount === 1) {
      eligible += 1;
      updated += 1;
      rows.push({
        keyHash: nextKeyHash,
        userId: candidate.userId,
        operation: candidate.operation,
        outcome: "updated",
      });
      continue;
    }

    const outcome = await classifyBackfillWriteOutcome(
      client,
      candidate.id,
      nextKeyHash,
    );
    if (outcome === "skipped-collision") {
      skippedCollision += 1;
    } else {
      eligible += 1;
      skippedRace += 1;
    }
    rows.push({
      keyHash: nextKeyHash,
      userId: candidate.userId,
      operation: candidate.operation,
      outcome,
    });
  }

  return {
    mode: apply ? "apply" : "dry-run",
    batchSize,
    scanned: candidates.length,
    eligible,
    updated,
    skippedCollision,
    skippedRace,
    rows,
  };
}
