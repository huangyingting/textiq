import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaClient as GeneratedPrismaClient } from "@/generated/prisma/client";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/catalog";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import { loadAndSyncBillingState } from "@/lib/billing/service";
import {
  captureUsage,
  refundUsage,
  reserveUsage,
  USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
  UsageLedgerConflictError,
} from "@/lib/billing/usage-ledger";
import { deriveUsageLedgerKeyHash } from "@/lib/billing/usage-ledger-key";

type UsageLedgerClient = NonNullable<
  Parameters<typeof reserveUsage>[0]["client"]
>;
type BillingClient = Parameters<typeof loadAndSyncBillingState>[1];
type PostgresPrismaClient = GeneratedPrismaClient;
type PostgresPrismaClientConstructor = new (options: {
  adapter: PrismaPg;
}) => PostgresPrismaClient;
type TestContext = {
  after: (callback: () => void | Promise<void>) => void;
};

const DATABASE_URL_ENV = "DATABASE_URL";
const POSTGRES_TEST_CLIENT_MODULE_ENV = "POSTGRES_TEST_PRISMA_CLIENT_MODULE";
const originalProvider = process.env.DB_PROVIDER;
let postgresPrismaClientConstructorPromise:
  Promise<PostgresPrismaClientConstructor> | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[usage-ledger:postgres] Missing required env ${name}.`);
  }
  return value;
}

function testRawKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().replaceAll("-", "")}`;
}

function asUsageLedgerClient(client: PostgresPrismaClient): UsageLedgerClient {
  return client as unknown as UsageLedgerClient;
}

function asBillingClient(client: PostgresPrismaClient): BillingClient {
  return client as unknown as BillingClient;
}

function isRetryableConflict(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === "P2034") {
    return true;
  }

  const cause = (
    error as { cause?: { code?: unknown; originalCode?: unknown } }
  )?.cause;
  return (
    cause?.code === "40001" ||
    cause?.originalCode === "40001" ||
    cause?.code === "25P02" ||
    cause?.originalCode === "25P02"
  );
}

async function resolvePostgresPrismaClientConstructor() {
  const modulePath = requireEnv(POSTGRES_TEST_CLIENT_MODULE_ENV);
  const moduleUrl = pathToFileURL(resolvePath(process.cwd(), modulePath)).href;
  const imported = (await import(moduleUrl)) as {
    PrismaClient?: PostgresPrismaClientConstructor;
  };

  if (typeof imported.PrismaClient !== "function") {
    throw new Error(
      `[usage-ledger:postgres] ${modulePath} does not export PrismaClient.`,
    );
  }

  return imported.PrismaClient;
}

async function getPostgresPrismaClientConstructor() {
  postgresPrismaClientConstructorPromise ??=
    resolvePostgresPrismaClientConstructor();
  return postgresPrismaClientConstructorPromise;
}

async function createPostgresClient(
  t: TestContext,
): Promise<PostgresPrismaClient> {
  const PrismaClient = await getPostgresPrismaClientConstructor();
  const adapter = new PrismaPg({
    connectionString: requireEnv(DATABASE_URL_ENV),
  });
  const client = new PrismaClient({ adapter });

  t.after(async () => {
    await client.$disconnect();
  });

  return client;
}

async function createIntegrationUser(
  client: PostgresPrismaClient,
  opts: { creditBalance: number; creditPeriodStart?: Date },
): Promise<{ userId: string }> {
  const userId = `usage-ledger-postgres-user-${randomUUID()}`;
  await client.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      plan: "free",
      creditBalance: opts.creditBalance,
      creditPeriodStart: opts.creditPeriodStart ?? new Date(),
    },
  });
  return { userId };
}

describe("usage ledger postgres integration", () => {
  before(() => {
    process.env.DB_PROVIDER = "postgres";
  });

  after(() => {
    if (originalProvider === undefined) {
      delete process.env.DB_PROVIDER;
    } else {
      process.env.DB_PROVIDER = originalProvider;
    }
  });

  it("retries retryable transaction conflicts with serializable isolation on postgres", async () => {
    const idempotencyKey = testRawKey("postgres-retry");
    const userId = "user-postgres";
    const operation = "generate";
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation,
    });
    const capturedRow = {
      id: "ledger-captured",
      keyHash,
      userId,
      operation,
      creditCost: 3,
      status: "captured",
      reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
      reservedAt: new Date(),
      capturedAt: new Date(),
      refundedAt: null,
    };

    let attempts = 0;
    const seenOptions: unknown[] = [];
    const client = {
      async $transaction(
        work: (tx: unknown) => Promise<unknown>,
        options?: unknown,
      ) {
        attempts += 1;
        seenOptions.push(options);
        if (attempts === 1) {
          throw Object.assign(new Error("serialization conflict"), {
            code: "P2034",
          });
        }

        return work({
          usageLedgerEntry: {
            async findUnique() {
              return capturedRow;
            },
          },
        } as never);
      },
      usageLedgerEntry: {} as never,
      user: {} as never,
    } as unknown as UsageLedgerClient;

    const captured = await captureUsage({
      idempotencyKey,
      userId,
      operation,
      creditCost: 3,
      client,
    });

    assert.equal(captured.status, "captured");
    assert.equal(attempts, 2);
    assert.deepEqual(seenOptions, [
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
  });

  it("concurrent same-key reserve creates one row and debits exactly once", async (t) => {
    const setupClient = await createPostgresClient(t);
    const reserveClientA = await createPostgresClient(t);
    const reserveClientB = await createPostgresClient(t);
    const reserveClientC = await createPostgresClient(t);

    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 20,
    });
    const idempotencyKey = testRawKey("postgres-reserve-same");
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation: "generate",
    });

    const [a, b, c] = await Promise.all([
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client: asUsageLedgerClient(reserveClientA),
      }),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client: asUsageLedgerClient(reserveClientB),
      }),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client: asUsageLedgerClient(reserveClientC),
      }),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(a.id, c.id);
    assert.equal(a.keyHash, keyHash);

    const rowCount = await setupClient.usageLedgerEntry.count({
      where: { keyHash },
    });
    assert.equal(rowCount, 1);

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 17);
  });

  it("distinct-key reserve races cannot overbook the balance", async (t) => {
    const setupClient = await createPostgresClient(t);
    const reserveClientA = await createPostgresClient(t);
    const reserveClientB = await createPostgresClient(t);

    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 2,
    });
    const keyA = testRawKey("postgres-race-a");
    const keyB = testRawKey("postgres-race-b");

    const settled = await Promise.allSettled([
      reserveUsage({
        idempotencyKey: keyA,
        userId,
        operation: "generate",
        creditCost: 2,
        client: asUsageLedgerClient(reserveClientA),
      }),
      reserveUsage({
        idempotencyKey: keyB,
        userId,
        operation: "generate",
        creditCost: 2,
        client: asUsageLedgerClient(reserveClientB),
      }),
    ]);

    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const rejected = settled.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      (rejected[0] as PromiseRejectedResult).reason instanceof
        InsufficientCreditsError,
    );

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 0);
  });

  it("conflicting key reuse fails without a second debit", async (t) => {
    const setupClient = await createPostgresClient(t);
    const reserveClient = await createPostgresClient(t);

    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("postgres-conflict");

    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 2,
      client: asUsageLedgerClient(reserveClient),
    });

    await assert.rejects(
      () =>
        reserveUsage({
          idempotencyKey,
          userId,
          operation: "generate",
          creditCost: 4,
          client: asUsageLedgerClient(reserveClient),
        }),
      (error: unknown) => error instanceof UsageLedgerConflictError,
    );

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 8);
  });

  it("period reset racing with reserve keeps reserve debit intact", async (t) => {
    const setupClient = await createPostgresClient(t);
    const resetClient = await createPostgresClient(t);
    const reserveClient = await createPostgresClient(t);

    const stalePeriodStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 1,
      creditPeriodStart: stalePeriodStart,
    });
    const idempotencyKey = testRawKey("postgres-reset-reserve");

    const settled = await Promise.allSettled([
      loadAndSyncBillingState(userId, asBillingClient(resetClient)),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client: asUsageLedgerClient(reserveClient),
      }),
    ]);

    for (const result of settled) {
      if (result.status === "fulfilled") {
        continue;
      }
      assert.ok(
        isRetryableConflict(result.reason),
        `unexpected race failure: ${String(result.reason)}`,
      );
    }

    await loadAndSyncBillingState(userId, asBillingClient(resetClient));
    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 3,
      client: asUsageLedgerClient(reserveClient),
    });

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true, creditPeriodStart: true },
    });
    assert.equal(
      user.creditBalance,
      PLAN_ENTITLEMENTS.free.creditsPerPeriod - 3,
    );
    assert.ok(user.creditPeriodStart instanceof Date);
  });

  it("period reset racing with refund keeps refund increment intact", async (t) => {
    const setupClient = await createPostgresClient(t);
    const resetClient = await createPostgresClient(t);
    const refundClient = await createPostgresClient(t);

    const stalePeriodStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 0,
      creditPeriodStart: stalePeriodStart,
    });
    const idempotencyKey = testRawKey("postgres-reset-refund");
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation: "generate",
    });

    await setupClient.usageLedgerEntry.create({
      data: {
        keyHash,
        userId,
        operation: "generate",
        creditCost: 2,
        status: "reserved",
        reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
      },
    });

    await Promise.all([
      loadAndSyncBillingState(userId, asBillingClient(resetClient)),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 2,
        client: asUsageLedgerClient(refundClient),
      }),
    ]);

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(
      user.creditBalance,
      PLAN_ENTITLEMENTS.free.creditsPerPeriod + 2,
    );
  });

  it("refund restores credits exactly once across concurrent callers", async (t) => {
    const setupClient = await createPostgresClient(t);
    const reserveClient = await createPostgresClient(t);
    const refundClientA = await createPostgresClient(t);
    const refundClientB = await createPostgresClient(t);
    const refundClientC = await createPostgresClient(t);

    const { userId } = await createIntegrationUser(setupClient, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("postgres-refund");

    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 4,
      client: asUsageLedgerClient(reserveClient),
    });

    const refunds = await Promise.all([
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client: asUsageLedgerClient(refundClientA),
      }),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client: asUsageLedgerClient(refundClientB),
      }),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client: asUsageLedgerClient(refundClientC),
      }),
    ]);

    assert.ok(refunds.every((entry) => entry?.status === "refunded"));

    const user = await setupClient.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 10);
  });
});
