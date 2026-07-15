import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/catalog";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import { reconcileStaleReservedUsage } from "@/lib/billing/stale-reservation-reconciliation";
import { loadAndSyncBillingState } from "@/lib/billing/service";
import {
  captureUsage,
  refundUsage,
  reserveUsage,
  USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
  USAGE_LEDGER_STATE_MACHINE,
  UsageLedgerConflictError,
} from "@/lib/billing/usage-ledger";
import { deriveUsageLedgerKeyHash } from "@/lib/billing/usage-ledger-key";
import { prisma } from "@/lib/prisma";

type UsageLedgerClient = NonNullable<
  Parameters<typeof reserveUsage>[0]["client"]
>;
type BillingClient = Parameters<typeof loadAndSyncBillingState>[1];

interface UsageLedgerIntegrationHarness {
  databaseFilePath: string;
  databaseUrl: string;
  client: PrismaClient;
}

const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");
const execFileAsync = promisify(execFile);

function testRawKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().replaceAll("-", "")}`;
}

function asUsageLedgerClient(client: PrismaClient): UsageLedgerClient {
  return client as unknown as UsageLedgerClient;
}

function asBillingClient(client: PrismaClient): BillingClient {
  return client as unknown as BillingClient;
}

async function createUsageLedgerIntegrationHarness(): Promise<UsageLedgerIntegrationHarness> {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });

  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `usage-ledger-${randomUUID()}.db`,
  );
  const databaseUrl = `file:${databaseFilePath}`;

  await execFileAsync(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DB_PROVIDER: "sqlite",
        DATABASE_URL: databaseUrl,
      },
    },
  );

  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const client = new PrismaClient({ adapter });

  return { databaseFilePath, databaseUrl, client };
}

async function disposeUsageLedgerIntegrationHarness(
  harness: UsageLedgerIntegrationHarness,
): Promise<void> {
  await harness.client.$disconnect();
  await rm(harness.databaseFilePath, { force: true });
  await rm(`${harness.databaseFilePath}-journal`, { force: true });
  await rm(`${harness.databaseFilePath}-wal`, { force: true });
  await rm(`${harness.databaseFilePath}-shm`, { force: true });
}

async function createIntegrationUser(
  harness: UsageLedgerIntegrationHarness,
  t: { after: (fn: () => Promise<void>) => void },
  opts: {
    creditBalance: number;
    creditPeriodStart?: Date;
  },
): Promise<{ userId: string }> {
  const userId = `usage-ledger-user-${randomUUID()}`;
  await harness.client.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      plan: "free",
      creditBalance: opts.creditBalance,
      creditPeriodStart: opts.creditPeriodStart ?? new Date(),
    },
  });

  t.after(async () => {
    await harness.client.usageLedgerEntry.deleteMany({ where: { userId } });
    await harness.client.user.deleteMany({ where: { id: userId } });
  });

  return { userId };
}

describe("usage ledger state machine", () => {
  it("declares reserve/capture/refund transitions explicitly", () => {
    assert.deepEqual(USAGE_LEDGER_STATE_MACHINE.reserve.idempotentStatuses, [
      "reserved",
      "captured",
      "refunded",
    ]);
    assert.deepEqual(USAGE_LEDGER_STATE_MACHINE.capture.allowedFrom, [
      "reserved",
    ]);
    assert.deepEqual(USAGE_LEDGER_STATE_MACHINE.refund.allowedFrom, [
      "reserved",
    ]);
    assert.deepEqual(USAGE_LEDGER_STATE_MACHINE.terminalStatuses, [
      "captured",
      "refunded",
    ]);
  });

  it("validates recovered P2002 winners against the reservation fingerprint", async () => {
    const idempotencyKey = testRawKey("unit-key");
    const userId = "user-unit";
    const operation = "generate";
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation,
    });
    const winnerRow = {
      id: "ledger-winner",
      keyHash,
      userId,
      operation,
      creditCost: 99,
      status: "reserved",
      reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
      reservedAt: new Date(),
      capturedAt: null,
      refundedAt: null,
    };

    let findUniqueCalls = 0;
    const client = {
      async $transaction(work: (tx: unknown) => Promise<unknown>) {
        return work({
          usageLedgerEntry: {
            async findUnique() {
              findUniqueCalls += 1;
              return null;
            },
            async create() {
              throw Object.assign(new Error("unique"), { code: "P2002" });
            },
          },
          user: {
            async findUniqueOrThrow() {
              return {
                plan: "free",
                creditBalance: 50,
                creditPeriodStart: new Date(),
              };
            },
            async updateMany() {
              return { count: 1 };
            },
          },
        } as never);
      },
      usageLedgerEntry: {
        async findUnique() {
          findUniqueCalls += 1;
          return findUniqueCalls > 1 ? winnerRow : null;
        },
      },
      user: {
        async findUniqueOrThrow() {
          return {
            plan: "free",
            creditBalance: 50,
            creditPeriodStart: new Date(),
          };
        },
        async updateMany() {
          return { count: 1 };
        },
      },
    } as unknown as UsageLedgerClient;

    await assert.rejects(
      () =>
        reserveUsage({
          idempotencyKey,
          userId,
          operation,
          creditCost: 2,
          client,
        }),
      (error: unknown) => error instanceof UsageLedgerConflictError,
    );
  });

  it("retries retryable transaction conflicts with serializable isolation on postgres", async () => {
    const previousProvider = process.env.DB_PROVIDER;
    process.env.DB_PROVIDER = "postgres";

    try {
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
    } finally {
      if (previousProvider === undefined) {
        delete process.env.DB_PROVIDER;
      } else {
        process.env.DB_PROVIDER = previousProvider;
      }
    }
  });
});

describe("usage-ledger sqlite integration", () => {
  let harness: UsageLedgerIntegrationHarness;

  before(async () => {
    harness = await createUsageLedgerIntegrationHarness();
  });

  after(async () => {
    await disposeUsageLedgerIntegrationHarness(harness);
  });

  it("concurrent same-key reserve creates one row and debits exactly once", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 20,
    });
    const idempotencyKey = testRawKey("sqlite-reserve-same");
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation: "generate",
    });
    const client = asUsageLedgerClient(harness.client);

    const [a, b, c] = await Promise.all([
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client,
      }),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client,
      }),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client,
      }),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(a.id, c.id);
    assert.equal(a.keyHash, keyHash);

    const rowCount = await harness.client.usageLedgerEntry.count({
      where: { keyHash },
    });
    assert.equal(rowCount, 1);

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 17);
  });

  it("scopes identical raw keys by operation to avoid cross-mode collisions", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 20,
    });
    const rawKey = testRawKey("sqlite-operation-scope");
    const client = asUsageLedgerClient(harness.client);

    const [visualReserve, deckReserve] = await Promise.all([
      reserveUsage({
        idempotencyKey: rawKey,
        userId,
        operation: "generate",
        creditCost: 2,
        client,
      }),
      reserveUsage({
        idempotencyKey: rawKey,
        userId,
        operation: "generate-deck",
        creditCost: 3,
        client,
      }),
    ]);

    assert.notEqual(visualReserve.keyHash, deckReserve.keyHash);

    const rowCount = await harness.client.usageLedgerEntry.count({
      where: { userId },
    });
    assert.equal(rowCount, 2);

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 15);
  });

  it("scopes identical raw keys by user to avoid cross-account collisions", async (t) => {
    const first = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const second = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const rawKey = testRawKey("sqlite-user-scope");
    const client = asUsageLedgerClient(harness.client);

    const [firstReserve, secondReserve] = await Promise.all([
      reserveUsage({
        idempotencyKey: rawKey,
        userId: first.userId,
        operation: "generate",
        creditCost: 3,
        client,
      }),
      reserveUsage({
        idempotencyKey: rawKey,
        userId: second.userId,
        operation: "generate",
        creditCost: 3,
        client,
      }),
    ]);

    assert.notEqual(firstReserve.keyHash, secondReserve.keyHash);

    const [firstUser, secondUser] = await Promise.all([
      harness.client.user.findUniqueOrThrow({
        where: { id: first.userId },
        select: { creditBalance: true },
      }),
      harness.client.user.findUniqueOrThrow({
        where: { id: second.userId },
        select: { creditBalance: true },
      }),
    ]);
    assert.equal(firstUser.creditBalance, 7);
    assert.equal(secondUser.creditBalance, 7);
  });

  it("distinct-key reserve races cannot overbook the balance", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 2,
    });
    const keyA = testRawKey("sqlite-race-a");
    const keyB = testRawKey("sqlite-race-b");
    const client = asUsageLedgerClient(harness.client);

    const settled = await Promise.allSettled([
      reserveUsage({
        idempotencyKey: keyA,
        userId,
        operation: "generate",
        creditCost: 2,
        client,
      }),
      reserveUsage({
        idempotencyKey: keyB,
        userId,
        operation: "generate",
        creditCost: 2,
        client,
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

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 0);
  });

  it("conflicting key reuse fails without a second debit", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("sqlite-conflict");
    const client = asUsageLedgerClient(harness.client);

    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 2,
      client,
    });

    await assert.rejects(
      () =>
        reserveUsage({
          idempotencyKey,
          userId,
          operation: "generate",
          creditCost: 4,
          client,
        }),
      (error: unknown) => error instanceof UsageLedgerConflictError,
    );

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 8);
  });

  it("capture is idempotent and does not mutate balance", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("sqlite-capture");
    const client = asUsageLedgerClient(harness.client);

    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 4,
      client,
    });

    const captures = await Promise.all([
      captureUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
      captureUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
      captureUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
    ]);

    assert.ok(captures.every((entry) => entry.status === "captured"));

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 6);
  });

  it("refund is idempotent and restores credits once for hold rows", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("sqlite-refund");
    const client = asUsageLedgerClient(harness.client);

    await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 4,
      client,
    });

    const refunds = await Promise.all([
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 4,
        client,
      }),
    ]);

    assert.ok(refunds.every((entry) => entry?.status === "refunded"));

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 10);
  });

  it("period reset racing with reserve keeps reserve debit intact", async (t) => {
    const stalePeriodStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 1,
      creditPeriodStart: stalePeriodStart,
    });
    const idempotencyKey = testRawKey("sqlite-reset-reserve");
    const usageClient = asUsageLedgerClient(harness.client);
    const billingClient = asBillingClient(harness.client);

    await Promise.all([
      loadAndSyncBillingState(userId, billingClient),
      reserveUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 3,
        client: usageClient,
      }),
    ]);

    const user = await harness.client.user.findUniqueOrThrow({
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
    const stalePeriodStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 0,
      creditPeriodStart: stalePeriodStart,
    });
    const idempotencyKey = testRawKey("sqlite-reset-refund");
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation: "generate",
    });

    await harness.client.usageLedgerEntry.create({
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
      loadAndSyncBillingState(userId, asBillingClient(harness.client)),
      refundUsage({
        idempotencyKey,
        userId,
        operation: "generate",
        creditCost: 2,
        client: asUsageLedgerClient(harness.client),
      }),
    ]);

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(
      user.creditBalance,
      PLAN_ENTITLEMENTS.free.creditsPerPeriod + 2,
    );
  });

  it("reconciles stale hold rows by refunding exactly once", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("sqlite-reconcile-hold");
    const usageClient = asUsageLedgerClient(harness.client);

    const reserved = await reserveUsage({
      idempotencyKey,
      userId,
      operation: "generate",
      creditCost: 3,
      client: usageClient,
    });

    await harness.client.usageLedgerEntry.update({
      where: { keyHash: reserved.keyHash },
      data: {
        reservedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const first = await reconcileStaleReservedUsage({
      client: harness.client as unknown as typeof prisma,
      ttlMs: 60 * 1000,
      batchSize: 10,
    });
    const second = await reconcileStaleReservedUsage({
      client: harness.client as unknown as typeof prisma,
      ttlMs: 60 * 1000,
      batchSize: 10,
    });

    assert.equal(first.refunded, 1);
    assert.equal(first.refundedLegacy, 0);
    assert.equal(second.refunded, 0);

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 10);
  });

  it("reconciliation respects ttl and bounded batch size", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 5,
    });
    const staleA = deriveUsageLedgerKeyHash({
      idempotencyKey: testRawKey("sqlite-reconcile-batch-a"),
      userId,
      operation: "generate",
    });
    const staleB = deriveUsageLedgerKeyHash({
      idempotencyKey: testRawKey("sqlite-reconcile-batch-b"),
      userId,
      operation: "generate",
    });
    const fresh = deriveUsageLedgerKeyHash({
      idempotencyKey: testRawKey("sqlite-reconcile-batch-fresh"),
      userId,
      operation: "generate",
    });

    await harness.client.usageLedgerEntry.createMany({
      data: [
        {
          keyHash: staleA,
          userId,
          operation: "generate",
          creditCost: 0,
          status: "reserved",
          reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
          reservedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
        {
          keyHash: staleB,
          userId,
          operation: "generate",
          creditCost: 0,
          status: "reserved",
          reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
          reservedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
        {
          keyHash: fresh,
          userId,
          operation: "generate",
          creditCost: 0,
          status: "reserved",
          reservationVersion: USAGE_LEDGER_RESERVATION_VERSION_CURRENT,
          reservedAt: new Date(),
        },
      ],
    });

    const first = await reconcileStaleReservedUsage({
      client: harness.client as unknown as typeof prisma,
      ttlMs: 60 * 1000,
      batchSize: 1,
    });
    const second = await reconcileStaleReservedUsage({
      client: harness.client as unknown as typeof prisma,
      ttlMs: 60 * 1000,
      batchSize: 1,
    });

    assert.equal(first.scanned, 1);
    assert.equal(first.refunded, 1);
    assert.equal(second.scanned, 1);
    assert.equal(second.refunded, 1);

    const remainingReserved = await harness.client.usageLedgerEntry.count({
      where: { userId, status: "reserved" },
    });
    assert.equal(remainingReserved, 1);
  });

  it("reconciles stale legacy reserved rows without incrementing balance", async (t) => {
    const { userId } = await createIntegrationUser(harness, t, {
      creditBalance: 10,
    });
    const idempotencyKey = testRawKey("sqlite-reconcile-legacy");
    const keyHash = deriveUsageLedgerKeyHash({
      idempotencyKey,
      userId,
      operation: "generate",
    });

    await harness.client.usageLedgerEntry.create({
      data: {
        keyHash,
        userId,
        operation: "generate",
        creditCost: 4,
        status: "reserved",
        reservationVersion: 0,
        reservedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const result = await reconcileStaleReservedUsage({
      client: harness.client as unknown as typeof prisma,
      ttlMs: 60 * 1000,
      batchSize: 10,
    });

    assert.equal(result.refunded, 1);
    assert.equal(result.refundedLegacy, 1);

    const user = await harness.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 10);

    const row = await harness.client.usageLedgerEntry.findUniqueOrThrow({
      where: { keyHash },
      select: { status: true },
    });
    assert.equal(row.status, "refunded");
  });
});
