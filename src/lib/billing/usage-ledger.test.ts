import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InsufficientCreditsError } from "@/lib/billing/credits";
import { prisma } from "@/lib/prisma";
import {
  captureUsage,
  refundUsage,
  reserveUsage,
  USAGE_LEDGER_STATE_MACHINE,
  UsageLedgerConflictError,
  UsageLedgerTransitionError,
} from "@/lib/billing/usage-ledger";

interface LedgerRow {
  id: string;
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: "reserved" | "captured" | "refunded";
  reservedAt: Date;
  capturedAt: Date | null;
  refundedAt: Date | null;
}

interface LedgerCreateData {
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: "reserved" | "captured" | "refunded";
}

interface LedgerWhere {
  idempotencyKey: string;
  userId?: string;
  creditCost?: number;
  status?: string;
}

interface UserBalanceWhere {
  id: string;
  creditBalance: { gte: number };
}

interface UserBalanceUpdate {
  creditBalance: { decrement: number };
}

type PrismaClient = typeof prisma;

function asPrismaClient(client: unknown): PrismaClient {
  return client as PrismaClient;
}

function makeFakeClient(
  initialRows: LedgerRow[] = [],
  initialBalances: Record<string, number> = {},
) {
  const store = new Map<string, LedgerRow>(
    initialRows.map((row) => [row.idempotencyKey, row]),
  );
  const balances = new Map<string, number>(Object.entries(initialBalances));
  const deductCalls: Array<{ userId: string; cost: number }> = [];
  let idSeq = initialRows.length + 1;

  function cloneRow(row: LedgerRow): LedgerRow {
    return {
      ...row,
      reservedAt: new Date(row.reservedAt),
      capturedAt: row.capturedAt ? new Date(row.capturedAt) : null,
      refundedAt: row.refundedAt ? new Date(row.refundedAt) : null,
    };
  }

  function cloneStore(input: Map<string, LedgerRow>): Map<string, LedgerRow> {
    return new Map(
      Array.from(input.entries(), ([key, row]) => [key, cloneRow(row)]),
    );
  }

  const client = {
    async $transaction<T>(
      arg: Promise<unknown>[] | ((tx: unknown) => Promise<T>),
    ): Promise<T> {
      if (typeof arg === "function") {
        const storeSnapshot = cloneStore(store);
        const balanceSnapshot = new Map(balances);
        const deductSnapshot = deductCalls.slice();
        try {
          return await arg(client);
        } catch (error) {
          store.clear();
          for (const [key, row] of storeSnapshot.entries()) {
            store.set(key, row);
          }
          balances.clear();
          for (const [userId, balance] of balanceSnapshot.entries()) {
            balances.set(userId, balance);
          }
          deductCalls.length = 0;
          deductCalls.push(...deductSnapshot);
          throw error;
        }
      }
      const result = await Promise.all(arg);
      return result as unknown as T;
    },
    usageLedgerEntry: {
      async findUnique({ where }: { where: { idempotencyKey: string } }) {
        return store.get(where.idempotencyKey) ?? null;
      },
      async findUniqueOrThrow({
        where,
      }: {
        where: { idempotencyKey: string };
      }) {
        const row = store.get(where.idempotencyKey);
        if (!row) {
          throw new Error("Record not found");
        }
        return row;
      },
      async create({ data }: { data: LedgerCreateData }) {
        if (store.has(data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint"), {
            code: "P2002",
          });
        }
        const row: LedgerRow = {
          id: `ledger-${idSeq++}`,
          idempotencyKey: data.idempotencyKey,
          userId: data.userId,
          operation: data.operation,
          creditCost: data.creditCost,
          status: data.status,
          reservedAt: new Date(),
          capturedAt: null,
          refundedAt: null,
        };
        store.set(row.idempotencyKey, row);
        return row;
      },
      async updateMany({
        where,
        data,
      }: {
        where: LedgerWhere;
        data: {
          status?: "reserved" | "captured" | "refunded";
          capturedAt?: Date | null;
          refundedAt?: Date | null;
        };
      }) {
        const row = store.get(where.idempotencyKey);
        if (!row) {
          return { count: 0 };
        }
        if (where.userId !== undefined && row.userId !== where.userId) {
          return { count: 0 };
        }
        if (
          where.creditCost !== undefined &&
          row.creditCost !== where.creditCost
        ) {
          return { count: 0 };
        }
        if (where.status !== undefined && row.status !== where.status) {
          return { count: 0 };
        }

        const updated: LedgerRow = {
          ...row,
          status: data.status ?? row.status,
          capturedAt:
            data.capturedAt === undefined ? row.capturedAt : data.capturedAt,
          refundedAt:
            data.refundedAt === undefined ? row.refundedAt : data.refundedAt,
        };
        store.set(where.idempotencyKey, updated);
        return { count: 1 };
      },
    },
    user: {
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const balance = balances.get(where.id);
        if (balance === undefined) {
          throw new Error("User not found");
        }
        return { creditBalance: balance };
      },
      async updateMany({
        where,
        data,
      }: {
        where: UserBalanceWhere;
        data: UserBalanceUpdate;
      }) {
        const balance = balances.get(where.id);
        if (balance === undefined) {
          return { count: 0 };
        }

        const cost = data.creditBalance.decrement;
        if (balance < where.creditBalance.gte) {
          return { count: 0 };
        }

        balances.set(where.id, balance - cost);
        deductCalls.push({ userId: where.id, cost });
        return { count: 1 };
      },
    },
    _store: store,
    _balances: balances,
    _deductCalls: deductCalls,
  };

  return client;
}

function testId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function createIntegrationUser(
  t: { after: (fn: () => Promise<void>) => void },
  credits: number,
): Promise<{ userId: string }> {
  const userId = testId("usage-ledger-user");
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      plan: "free",
      creditBalance: credits,
    },
  });

  t.after(async () => {
    await prisma.usageLedgerEntry.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
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
});

describe("reserveUsage", () => {
  it("creates a reserved row after transactional balance check", async () => {
    const client = makeFakeClient([], { "user-a": 5 });

    const entry = await reserveUsage({
      idempotencyKey: "reserve-new",
      userId: "user-a",
      operation: "generate",
      creditCost: 3,
      client: asPrismaClient(client),
    });

    assert.equal(entry.status, "reserved");
    assert.equal(client._store.size, 1);
  });

  it("is idempotent for the same key + fingerprint", async () => {
    const client = makeFakeClient([], { "user-a": 10 });

    const first = await reserveUsage({
      idempotencyKey: "reserve-same",
      userId: "user-a",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    });
    const second = await reserveUsage({
      idempotencyKey: "reserve-same",
      userId: "user-a",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    });

    assert.equal(first.id, second.id);
    assert.equal(client._store.size, 1);
  });

  it("rejects conflicting reuse of the same idempotency key", async () => {
    const client = makeFakeClient([], { "user-a": 10 });

    await reserveUsage({
      idempotencyKey: "reserve-conflict",
      userId: "user-a",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    });

    await assert.rejects(
      () =>
        reserveUsage({
          idempotencyKey: "reserve-conflict",
          userId: "user-a",
          operation: "generate",
          creditCost: 4,
          client: asPrismaClient(client),
        }),
      (error: unknown) => error instanceof UsageLedgerConflictError,
    );
  });
});

describe("captureUsage", () => {
  it("captures once and deducts at most once", async () => {
    const client = makeFakeClient([], { "user-b": 10 });

    await reserveUsage({
      idempotencyKey: "capture-once",
      userId: "user-b",
      operation: "generate",
      creditCost: 4,
      client: asPrismaClient(client),
    });

    const captured = await captureUsage({
      idempotencyKey: "capture-once",
      userId: "user-b",
      creditCost: 4,
      client: asPrismaClient(client),
    });
    const capturedAgain = await captureUsage({
      idempotencyKey: "capture-once",
      userId: "user-b",
      creditCost: 4,
      client: asPrismaClient(client),
    });

    assert.equal(captured.status, "captured");
    assert.equal(capturedAgain.status, "captured");
    assert.equal(client._balances.get("user-b"), 6);
    assert.equal(client._deductCalls.length, 1);
  });

  it("throws when no reservation exists", async () => {
    const client = makeFakeClient([], { "user-b": 10 });

    await assert.rejects(
      () =>
        captureUsage({
          idempotencyKey: "capture-missing",
          userId: "user-b",
          creditCost: 1,
          client: asPrismaClient(client),
        }),
      /no ledger entry found/,
    );
  });

  it("refuses capture from refunded state", async () => {
    const client = makeFakeClient(
      [
        {
          id: "ledger-r",
          idempotencyKey: "capture-refunded",
          userId: "user-b",
          operation: "generate",
          creditCost: 3,
          status: "refunded",
          reservedAt: new Date(),
          capturedAt: null,
          refundedAt: new Date(),
        },
      ],
      { "user-b": 10 },
    );

    await assert.rejects(
      () =>
        captureUsage({
          idempotencyKey: "capture-refunded",
          userId: "user-b",
          creditCost: 3,
          client: asPrismaClient(client),
        }),
      (error: unknown) => error instanceof UsageLedgerTransitionError,
    );
    assert.equal(client._balances.get("user-b"), 10);
    assert.equal(client._deductCalls.length, 0);
  });

  it("rolls back the ledger transition when deduction fails", async () => {
    const client = makeFakeClient([], { "user-c": 1 });

    await reserveUsage({
      idempotencyKey: "capture-insufficient",
      userId: "user-c",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    }).catch(() => {
      /* reserve fails due balance check; seed a reserved row to exercise capture rollback path */
    });

    client._store.set("capture-insufficient", {
      id: "ledger-c",
      idempotencyKey: "capture-insufficient",
      userId: "user-c",
      operation: "generate",
      creditCost: 2,
      status: "reserved",
      reservedAt: new Date(),
      capturedAt: null,
      refundedAt: null,
    });

    await assert.rejects(
      () =>
        captureUsage({
          idempotencyKey: "capture-insufficient",
          userId: "user-c",
          creditCost: 2,
          client: asPrismaClient(client),
        }),
      (error: unknown) => error instanceof InsufficientCreditsError,
    );

    const row = client._store.get("capture-insufficient");
    assert.equal(row?.status, "reserved");
    assert.equal(client._balances.get("user-c"), 1);
  });
});

describe("refundUsage", () => {
  it("transitions reserved to refunded", async () => {
    const client = makeFakeClient([], { "user-d": 10 });

    await reserveUsage({
      idempotencyKey: "refund-reserved",
      userId: "user-d",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    });

    const refunded = await refundUsage({
      idempotencyKey: "refund-reserved",
      client: asPrismaClient(client),
    });

    assert.equal(refunded?.status, "refunded");
  });

  it("is idempotent for captured and does not overwrite terminal status", async () => {
    const client = makeFakeClient([], { "user-d": 10 });

    await reserveUsage({
      idempotencyKey: "refund-captured",
      userId: "user-d",
      operation: "generate",
      creditCost: 2,
      client: asPrismaClient(client),
    });
    await captureUsage({
      idempotencyKey: "refund-captured",
      userId: "user-d",
      creditCost: 2,
      client: asPrismaClient(client),
    });

    const refunded = await refundUsage({
      idempotencyKey: "refund-captured",
      client: asPrismaClient(client),
    });

    assert.equal(refunded?.status, "captured");
    assert.equal(client._balances.get("user-d"), 8);
  });

  it("returns null when the key does not exist", async () => {
    const client = makeFakeClient([], {});
    const result = await refundUsage({
      idempotencyKey: "refund-missing",
      client: asPrismaClient(client),
    });
    assert.equal(result, null);
  });
});

describe("usage-ledger sqlite integration", () => {
  it("concurrent same-key reserve returns one durable row", async (t) => {
    const { userId } = await createIntegrationUser(t, 20);
    const key = testId("sqlite-reserve");

    const [a, b, c] = await Promise.all([
      reserveUsage({
        idempotencyKey: key,
        userId,
        operation: "generate",
        creditCost: 3,
      }),
      reserveUsage({
        idempotencyKey: key,
        userId,
        operation: "generate",
        creditCost: 3,
      }),
      reserveUsage({
        idempotencyKey: key,
        userId,
        operation: "generate",
        creditCost: 3,
      }),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(a.id, c.id);
    const rowCount = await prisma.usageLedgerEntry.count({
      where: { idempotencyKey: key },
    });
    assert.equal(rowCount, 1);
  });

  it("concurrent same-key capture deducts exactly once", async (t) => {
    const { userId } = await createIntegrationUser(t, 10);
    const key = testId("sqlite-capture");

    await reserveUsage({
      idempotencyKey: key,
      userId,
      operation: "generate",
      creditCost: 4,
    });

    const results = await Promise.all([
      captureUsage({ idempotencyKey: key, userId, creditCost: 4 }),
      captureUsage({ idempotencyKey: key, userId, creditCost: 4 }),
      captureUsage({ idempotencyKey: key, userId, creditCost: 4 }),
    ]);

    assert.ok(results.every((entry) => entry.status === "captured"));

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 6);

    const row = await prisma.usageLedgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { status: true },
    });
    assert.equal(row.status, "captured");
  });

  it("concurrent same-key refund is deterministic and idempotent", async (t) => {
    const { userId } = await createIntegrationUser(t, 10);
    const key = testId("sqlite-refund");

    await reserveUsage({
      idempotencyKey: key,
      userId,
      operation: "generate",
      creditCost: 2,
    });

    const results = await Promise.all([
      refundUsage({ idempotencyKey: key }),
      refundUsage({ idempotencyKey: key }),
      refundUsage({ idempotencyKey: key }),
    ]);

    assert.ok(results.every((entry) => entry?.status === "refunded"));

    const row = await prisma.usageLedgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { status: true },
    });
    assert.equal(row.status, "refunded");
  });

  it("concurrent different-key capture enforces exact balance invariants", async (t) => {
    const { userId } = await createIntegrationUser(t, 2);
    const keyA = testId("sqlite-race-a");
    const keyB = testId("sqlite-race-b");

    await reserveUsage({
      idempotencyKey: keyA,
      userId,
      operation: "generate",
      creditCost: 2,
    });
    await reserveUsage({
      idempotencyKey: keyB,
      userId,
      operation: "generate",
      creditCost: 2,
    });

    const settled = await Promise.allSettled([
      captureUsage({ idempotencyKey: keyA, userId, creditCost: 2 }),
      captureUsage({ idempotencyKey: keyB, userId, creditCost: 2 }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      (rejected[0] as PromiseRejectedResult).reason instanceof
        InsufficientCreditsError,
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    });
    assert.equal(user.creditBalance, 0);

    const rows = await prisma.usageLedgerEntry.findMany({
      where: { userId, idempotencyKey: { in: [keyA, keyB] } },
      select: { idempotencyKey: true, status: true },
    });
    const statusByKey = new Map(
      rows.map((row) => [row.idempotencyKey, row.status]),
    );
    const statuses = [statusByKey.get(keyA), statusByKey.get(keyB)].sort();
    assert.deepEqual(statuses, ["captured", "reserved"]);
  });
});
