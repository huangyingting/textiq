import { reconcileStaleReservedUsage } from "@/lib/billing/stale-reservation-reconciliation";

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
  const ttlMinutes = parsePositiveInteger(
    process.env.BILLING_STALE_RESERVATION_TTL_MINUTES,
    15,
    "BILLING_STALE_RESERVATION_TTL_MINUTES",
  );
  const batchSize = parsePositiveInteger(
    process.env.BILLING_STALE_RESERVATION_BATCH_SIZE,
    100,
    "BILLING_STALE_RESERVATION_BATCH_SIZE",
  );

  const result = await reconcileStaleReservedUsage({
    ttlMs: ttlMinutes * 60 * 1000,
    batchSize,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        cutoff: result.cutoff.toISOString(),
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    `[billing] stale reservation reconciliation failed: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exitCode = 1;
});
