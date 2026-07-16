import { Prisma } from "@/generated/prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_ERROR_INSPECTION_DEPTH = 16;
const RETRYABLE_SQLITE_ADAPTER_ERROR_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
]);

type TransactionRunner = Pick<typeof prisma, "$transaction">;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function isRetryableSqliteAdapterMetadata(meta: unknown): boolean {
  const pending: Array<{
    value: unknown;
    depth: number;
    inDriverAdapterError: boolean;
    enteredAsDriverAdapterError: boolean;
  }> = [
    {
      value: meta,
      depth: 0,
      inDriverAdapterError: false,
      enteredAsDriverAdapterError: false,
    },
  ];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current.depth > MAX_ERROR_INSPECTION_DEPTH) {
      continue;
    }

    const currentRecord = record(current.value);
    if (currentRecord === null || visited.has(currentRecord)) {
      continue;
    }
    visited.add(currentRecord);

    const inDriverAdapterError =
      current.inDriverAdapterError ||
      (current.enteredAsDriverAdapterError &&
        currentRecord.name === "DriverAdapterError");
    const originalCode = currentRecord.originalCode;
    if (
      inDriverAdapterError &&
      currentRecord.kind === "SocketTimeout" &&
      typeof currentRecord.originalMessage === "string" &&
      currentRecord.originalMessage.length > 0 &&
      typeof originalCode === "string" &&
      RETRYABLE_SQLITE_ADAPTER_ERROR_CODES.has(originalCode)
    ) {
      return true;
    }

    const nextDepth = current.depth + 1;
    pending.push({
      value: currentRecord.cause,
      depth: nextDepth,
      inDriverAdapterError,
      enteredAsDriverAdapterError: false,
    });
    pending.push({
      value: currentRecord.driverAdapterError,
      depth: nextDepth,
      inDriverAdapterError,
      enteredAsDriverAdapterError: true,
    });
  }

  return false;
}

export function isRetryableSerializableTransactionError(
  error: unknown,
): boolean {
  let current: unknown = error;
  const visited = new Set<object>();

  for (let depth = 0; depth <= MAX_ERROR_INSPECTION_DEPTH; depth += 1) {
    const currentRecord = record(current);
    if (currentRecord === null || visited.has(currentRecord)) {
      return false;
    }
    visited.add(currentRecord);

    if (currentRecord.code === "P2034") {
      return true;
    }
    if (
      currentRecord.code === "P1008" &&
      isRetryableSqliteAdapterMetadata(currentRecord.meta)
    ) {
      return true;
    }

    current = currentRecord.cause;
  }

  return false;
}

export async function runSerializableTransaction<T>(
  db: TransactionRunner,
  operation: (tx: PrismaTransactionClient) => Promise<T>,
  options: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !isRetryableSerializableTransactionError(error)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }

  throw new Error("Serializable transaction retry loop exhausted.");
}
