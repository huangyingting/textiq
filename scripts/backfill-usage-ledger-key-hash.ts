import { parseArgs } from "node:util";

import {
  backfillLegacyUsageLedgerKeys,
  DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE,
} from "@/lib/billing/legacy-key-backfill";

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received "${raw}".`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: {
        type: "boolean",
        default: false,
      },
      "batch-size": {
        type: "string",
      },
    },
  });

  const batchSize = parsePositiveInteger(
    values["batch-size"] ?? process.env.BILLING_LEGACY_KEY_BACKFILL_BATCH_SIZE,
    DEFAULT_LEGACY_KEY_BACKFILL_BATCH_SIZE,
    "BILLING_LEGACY_KEY_BACKFILL_BATCH_SIZE",
  );

  const result = await backfillLegacyUsageLedgerKeys({
    apply: values.apply,
    batchSize,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(
    `[billing] usage-ledger key backfill failed: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exitCode = 1;
});
