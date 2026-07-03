/**
 * Unit tests for the durable generation usage ledger (Epic #478, issue #481).
 *
 * Uses an in-memory fake Prisma client and a fake deductCredits to test
 * reserve / capture / refund lifecycle and idempotency without a real DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  reserveUsage,
  captureUsage,
  refundUsage,
} from "@/lib/billing/usage-ledger";

// ---------------------------------------------------------------------------
// In-memory fake
// ---------------------------------------------------------------------------

interface LedgerRow {
  id: string;
  idempotencyKey: string;
  userId: string;
  operation: string;
  creditCost: number;
  status: string;
  reservedAt: Date;
  capturedAt: Date | null;
  refundedAt: Date | null;
}

type PrismaClient = typeof import("@/lib/prisma").prisma;

function asPrismaClient(client: unknown): PrismaClient {
  return client as PrismaClient;
}

function makeFakeClient(initialRows: LedgerRow[] = []) {
  const store = new Map<string, LedgerRow>(
    initialRows.map((r) => [r.idempotencyKey, r]),
  );
  let idSeq = 1;
  const deductCalls: { userId: string; cost: number }[] = [];

  const client = {
    usageLedgerEntry: {
      async findUnique({ where }: { where: { idempotencyKey: string } }) {
        return store.get(where.idempotencyKey) ?? null;
      },
      async create({
        data,
      }: {
        data: {
          idempotencyKey: string;
          userId: string;
          operation: string;
          creditCost: number;
          status: string;
        };
      }) {
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
      async update({
        where,
        data,
      }: {
        where: { idempotencyKey: string };
        data: { status: string; capturedAt?: Date; refundedAt?: Date };
      }) {
        const row = store.get(where.idempotencyKey);
        if (!row) throw new Error("Record not found");
        const updated = { ...row, ...data };
        store.set(where.idempotencyKey, updated);
        return updated;
      },
    },
    // Fake deductCredits shim (mirrored in the client for captureUsage injection)
    _deductCalls: deductCalls,
    _store: store,
  };

  return client;
}

// captureUsage calls deductCredits via the real import, so we need to provide
// a Prisma client that also handles the user.updateMany call used by deductCredits.
function makeFakeClientWithUser(initialRows: LedgerRow[], userBalance: number) {
  const base = makeFakeClient(initialRows);
  let balance = userBalance;
  const deductCalls: Array<{ userId: string; cost: number }> = [];

  const client = {
    ...base,
    user: {
      async findUniqueOrThrow(_args: unknown) {
        return { creditBalance: balance };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { id: string; creditBalance: { gte: number } };
        data: { creditBalance: { decrement: number } };
      }) {
        const cost = data.creditBalance.decrement;
        if (balance >= where.creditBalance.gte) {
          balance -= cost;
          deductCalls.push({ userId: where.id, cost });
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    _deductCalls: deductCalls,
    getBalance: () => balance,
  };
  return client;
}

// ---------------------------------------------------------------------------
// reserve
// ---------------------------------------------------------------------------

describe("reserveUsage (#481)", () => {
  it("creates a new ledger entry with status=reserved", async () => {
    const client = makeFakeClient();
    const entry = await reserveUsage({
      idempotencyKey: "req-001",
      userId: "user-a",
      operation: "generate",
      creditCost: 5,
      client: asPrismaClient(client),
    });

    assert.equal(entry.idempotencyKey, "req-001");
    assert.equal(entry.userId, "user-a");
    assert.equal(entry.operation, "generate");
    assert.equal(entry.creditCost, 5);
    assert.equal(entry.status, "reserved");
    assert.equal(entry.capturedAt, null);
    assert.equal(entry.refundedAt, null);
  });

  it("is idempotent — returns existing entry without duplicate write", async () => {
    const client = makeFakeClient();
    const first = await reserveUsage({
      idempotencyKey: "req-002",
      userId: "user-b",
      operation: "generate",
      creditCost: 3,
      client: asPrismaClient(client),
    });
    const second = await reserveUsage({
      idempotencyKey: "req-002",
      userId: "user-b",
      operation: "generate",
      creditCost: 3,
      client: asPrismaClient(client),
    });

    assert.equal(first.id, second.id);
    // Only one row in the store
    assert.equal(client._store.size, 1);
  });
});

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

describe("captureUsage (#481)", () => {
  it("marks the entry captured and deducts credits", async () => {
    const key = "req-cap-001";
    const row: LedgerRow = {
      id: "ledger-1",
      idempotencyKey: key,
      userId: "user-c",
      operation: "generate",
      creditCost: 4,
      status: "reserved",
      reservedAt: new Date(),
      capturedAt: null,
      refundedAt: null,
    };
    const client = makeFakeClientWithUser([row], 10);
    const entry = await captureUsage({
      idempotencyKey: key,
      userId: "user-c",
      creditCost: 4,
      client: asPrismaClient(client),
    });

    assert.equal(entry.status, "captured");
    assert.ok(entry.capturedAt instanceof Date);
    assert.equal(client.getBalance(), 6); // 10 - 4
  });

  it("is idempotent — does not double-charge when already captured", async () => {
    const key = "req-cap-002";
    const row: LedgerRow = {
      id: "ledger-2",
      idempotencyKey: key,
      userId: "user-d",
      operation: "generate",
      creditCost: 3,
      status: "captured",
      reservedAt: new Date(),
      capturedAt: new Date(),
      refundedAt: null,
    };
    const client = makeFakeClientWithUser([row], 10);
    await captureUsage({
      idempotencyKey: key,
      userId: "user-d",
      creditCost: 3,
      client: asPrismaClient(client),
    });

    assert.equal(client.getBalance(), 10); // unchanged — no second deduction
    assert.equal(client._deductCalls.length, 0);
  });

  it("throws when no entry exists for the key", async () => {
    const client = makeFakeClient();
    await assert.rejects(
      () =>
        captureUsage({
          idempotencyKey: "nonexistent",
          userId: "user-x",
          creditCost: 1,
          client: asPrismaClient(client),
        }),
      /no ledger entry found/,
    );
  });

  it("skips deduction when creditCost is 0", async () => {
    const key = "req-cap-free";
    const row: LedgerRow = {
      id: "ledger-free",
      idempotencyKey: key,
      userId: "user-e",
      operation: "generate",
      creditCost: 0,
      status: "reserved",
      reservedAt: new Date(),
      capturedAt: null,
      refundedAt: null,
    };
    const client = makeFakeClientWithUser([row], 10);
    const entry = await captureUsage({
      idempotencyKey: key,
      userId: "user-e",
      creditCost: 0,
      client: asPrismaClient(client),
    });

    assert.equal(entry.status, "captured");
    assert.equal(client.getBalance(), 10); // no deduction
  });
});

// ---------------------------------------------------------------------------
// refund
// ---------------------------------------------------------------------------

describe("refundUsage (#481)", () => {
  it("marks the entry refunded without changing the balance", async () => {
    const key = "req-ref-001";
    const row: LedgerRow = {
      id: "ledger-3",
      idempotencyKey: key,
      userId: "user-f",
      operation: "generate",
      creditCost: 5,
      status: "reserved",
      reservedAt: new Date(),
      capturedAt: null,
      refundedAt: null,
    };
    const client = makeFakeClient([row]);
    const result = await refundUsage({
      idempotencyKey: key,
      client: asPrismaClient(client),
    });

    assert.ok(result);
    assert.equal(result.status, "refunded");
    assert.ok(result.refundedAt instanceof Date);
  });

  it("returns null (no throw) when the key does not exist", async () => {
    const client = makeFakeClient();
    const result = await refundUsage({
      idempotencyKey: "ghost-key",
      client: asPrismaClient(client),
    });

    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle
// ---------------------------------------------------------------------------

describe("Usage ledger full lifecycle reserve→capture (#481)", () => {
  it("reserve then capture charges exactly once", async () => {
    const key = "lifecycle-001";
    const client = makeFakeClientWithUser([], 20);

    await reserveUsage({
      idempotencyKey: key,
      userId: "user-g",
      operation: "generate",
      creditCost: 7,
      client: asPrismaClient(client),
    });
    assert.equal(client.getBalance(), 20); // not yet deducted

    await captureUsage({
      idempotencyKey: key,
      userId: "user-g",
      creditCost: 7,
      client: asPrismaClient(client),
    });
    assert.equal(client.getBalance(), 13); // deducted on capture
  });

  it("reserve then refund leaves balance unchanged", async () => {
    const key = "lifecycle-002";
    const client = makeFakeClientWithUser([], 15);

    await reserveUsage({
      idempotencyKey: key,
      userId: "user-h",
      operation: "generate",
      creditCost: 6,
      client: asPrismaClient(client),
    });
    assert.equal(client.getBalance(), 15); // not deducted

    await refundUsage({
      idempotencyKey: key,
      client: asPrismaClient(client),
    });
    assert.equal(client.getBalance(), 15); // still unchanged
  });
});
