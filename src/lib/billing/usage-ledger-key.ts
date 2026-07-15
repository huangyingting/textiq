import { createHash } from "node:crypto";

export const USAGE_LEDGER_KEY_VERSION = "v1";
export const USAGE_LEDGER_KEY_HASH_VERSION_CURRENT = 1;

export interface UsageLedgerScopedKeyInput {
  userId: string;
  operation: string;
  idempotencyKey: string;
}

/**
 * Derives the persisted usage-ledger key from user+operation+raw idempotency
 * key. Raw client keys are never stored; only this versioned hash is persisted.
 */
export function deriveUsageLedgerKeyHash(
  input: UsageLedgerScopedKeyInput,
): string {
  const scope = [
    USAGE_LEDGER_KEY_VERSION,
    input.userId.trim(),
    input.operation.trim(),
    input.idempotencyKey.trim(),
  ].join(":");

  return createHash("sha256").update(scope).digest("hex");
}
