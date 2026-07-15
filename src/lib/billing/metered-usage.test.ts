import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InsufficientCreditsError } from "@/lib/billing/credits";
import {
  captureMeteredUsage,
  refundMeteredUsage,
  reserveMeteredUsage,
  type MeteredUsageReservation,
} from "@/lib/billing/metered-usage";
import { prisma } from "@/lib/prisma";

function stubObjectMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  Object.defineProperty(object, methodName, {
    configurable: true,
    value: (...args: unknown[]) => {
      calls.push(args);
      return (implementation as (...args: unknown[]) => unknown)(...args);
    },
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      configurable: true,
      value: original,
    });
  });
  return { calls };
}

function stubTransactionPassthrough(t: {
  after: (fn: () => void) => void;
}): void {
  stubObjectMethod(t, prisma, "$transaction", async (arg) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
}

function withLimitedCreditsEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.BILLING_UNLIMITED_CREDITS;
  delete process.env.BILLING_UNLIMITED_CREDITS;
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.BILLING_UNLIMITED_CREDITS;
    } else {
      process.env.BILLING_UNLIMITED_CREDITS = previous;
    }
  });
}

describe("metered usage unlimited-credit shortcuts", () => {
  it("reserveMeteredUsage bypasses credit checks when unlimited credits are enabled", async () => {
    const previous = process.env.BILLING_UNLIMITED_CREDITS;
    process.env.BILLING_UNLIMITED_CREDITS = "true";
    try {
      const result = await reserveMeteredUsage({
        idempotencyKey: "usage-unlimited",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "A long prompt that would otherwise cost credits.",
      });

      assert.equal(result.ok, true);
      assert.equal(result.reservation.creditCost, 0);
      assert.equal(result.reservation.ledgerReserved, false);
    } finally {
      if (previous === undefined) {
        delete process.env.BILLING_UNLIMITED_CREDITS;
      } else {
        process.env.BILLING_UNLIMITED_CREDITS = previous;
      }
    }
  });

  it("captureMeteredUsage succeeds without writes for zero-cost reservations", async () => {
    const reservation: MeteredUsageReservation = {
      idempotencyKey: "usage-zero",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 0,
      ledgerReserved: false,
    };

    await assert.doesNotReject(() => captureMeteredUsage(reservation));
  });

  it("refundMeteredUsage skips reservations that were not ledger-reserved", async () => {
    const reservation: MeteredUsageReservation = {
      idempotencyKey: "usage-not-reserved",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 3,
      ledgerReserved: false,
    };

    await assert.doesNotReject(() => refundMeteredUsage(reservation));
  });
});

describe("metered usage durable ledger behavior", () => {
  it("reserveMeteredUsage denies requests above the synced credit balance", async (t) =>
    withLimitedCreditsEnv(async () => {
      const periodStart = new Date();
      stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
        plan: "free",
        creditBalance: 1,
        creditPeriodStart: periodStart,
        subscription: null,
      }));

      const result = await reserveMeteredUsage({
        idempotencyKey: "usage-denied",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "two words",
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, "insufficient-credits");
      assert.equal(result.creditCost, 2);
      assert.equal(result.balance, 1);
    }));

  it("reserveMeteredUsage records a durable reservation for positive cost", async (t) =>
    withLimitedCreditsEnv(async () => {
      stubTransactionPassthrough(t);
      const periodStart = new Date();
      stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
        plan: "free",
        creditBalance: 10,
        creditPeriodStart: periodStart,
        subscription: null,
      }));
      stubObjectMethod(
        t,
        prisma.usageLedgerEntry,
        "findUnique",
        async () => null,
      );
      const create = stubObjectMethod(
        t,
        prisma.usageLedgerEntry,
        "create",
        async (args) => {
          const { data } = args as { data: Record<string, unknown> };
          return {
            id: "ledger-reserved",
            ...data,
            reservedAt: new Date("2026-01-01T00:00:00.000Z"),
            capturedAt: null,
            refundedAt: null,
          };
        },
      );

      const result = await reserveMeteredUsage({
        idempotencyKey: "usage-reserved",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "three clear words",
      });

      assert.equal(result.ok, true);
      assert.equal(result.reservation.creditCost, 3);
      assert.equal(result.reservation.ledgerReserved, true);
      assert.equal(create.calls.length, 1);
    }));

  it("reserveMeteredUsage fail-closes when durable reservation cannot be written", async (t) =>
    withLimitedCreditsEnv(async () => {
      stubTransactionPassthrough(t);
      const periodStart = new Date();
      stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
        plan: "free",
        creditBalance: 10,
        creditPeriodStart: periodStart,
        subscription: null,
      }));
      stubObjectMethod(
        t,
        prisma.usageLedgerEntry,
        "findUnique",
        async () => null,
      );
      stubObjectMethod(t, prisma.usageLedgerEntry, "create", async () => {
        throw new Error("ledger unavailable");
      });

      await assert.rejects(
        () =>
          reserveMeteredUsage({
            idempotencyKey: "usage-ledger-failed",
            userId: "user-metered",
            operation: "deck-generation",
            creditText: "two words",
          }),
        /ledger unavailable/,
      );
    }));

  it("reserveMeteredUsage maps transactional insufficiency races to insufficient-credits", async (t) =>
    withLimitedCreditsEnv(async () => {
      const periodStart = new Date();
      stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
        plan: "free",
        creditBalance: 10,
        creditPeriodStart: periodStart,
        subscription: null,
      }));
      stubObjectMethod(t, prisma, "$transaction", async () => {
        throw new InsufficientCreditsError(1, 2);
      });

      const result = await reserveMeteredUsage({
        idempotencyKey: "usage-race-insufficient",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "two words",
      });

      assert.equal(result.ok, false);
      assert.equal(result.reason, "insufficient-credits");
      assert.equal(result.balance, 1);
      assert.equal(result.creditCost, 2);
    }));

  it("captureMeteredUsage captures a durable reservation", async (t) => {
    stubTransactionPassthrough(t);
    stubObjectMethod(t, prisma.usageLedgerEntry, "findUnique", async () => ({
      id: "ledger-entry",
      idempotencyKey: "usage-capture",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      status: "reserved",
      reservedAt: new Date("2026-01-01T00:00:00.000Z"),
      capturedAt: null,
      refundedAt: null,
    }));
    stubObjectMethod(t, prisma.usageLedgerEntry, "updateMany", async () => ({
      count: 1,
    }));
    stubObjectMethod(t, prisma.user, "updateMany", async () => ({ count: 1 }));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      creditBalance: 8,
    }));
    const findUniqueOrThrow = stubObjectMethod(
      t,
      prisma.usageLedgerEntry,
      "findUniqueOrThrow",
      async () => ({
        id: "ledger-entry",
        idempotencyKey: "usage-capture",
        userId: "user-metered",
        operation: "deck-generation",
        creditCost: 2,
        status: "captured",
        reservedAt: new Date("2026-01-01T00:00:00.000Z"),
        capturedAt: new Date("2026-01-01T00:00:01.000Z"),
        refundedAt: null,
      }),
    );

    const result = await captureMeteredUsage({
      idempotencyKey: "usage-capture",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      ledgerReserved: true,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(findUniqueOrThrow.calls.length, 1);
  });

  it("captureMeteredUsage fails when no durable reservation exists", async () => {
    const result = await captureMeteredUsage({
      idempotencyKey: "usage-direct-capture",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 4,
      ledgerReserved: false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.insufficientCredits, false);
  });

  it("captureMeteredUsage surfaces insufficient-credit capture failures", async (t) => {
    stubObjectMethod(t, prisma, "$transaction", async () => {
      throw new InsufficientCreditsError(1, 4);
    });

    const result = await captureMeteredUsage({
      idempotencyKey: "usage-insufficient",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 4,
      ledgerReserved: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.insufficientCredits, true);
  });

  it("refundMeteredUsage marks durable reservations as refunded", async (t) => {
    stubTransactionPassthrough(t);
    stubObjectMethod(t, prisma.usageLedgerEntry, "findUnique", async () => ({
      id: "ledger-entry",
      idempotencyKey: "usage-refund",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      status: "reserved",
      reservedAt: new Date("2026-01-01T00:00:00.000Z"),
      capturedAt: null,
      refundedAt: null,
    }));
    const updateMany = stubObjectMethod(
      t,
      prisma.usageLedgerEntry,
      "updateMany",
      async () => ({ count: 1 }),
    );
    stubObjectMethod(
      t,
      prisma.usageLedgerEntry,
      "findUniqueOrThrow",
      async () => ({
        id: "ledger-entry",
        idempotencyKey: "usage-refund",
        userId: "user-metered",
        operation: "deck-generation",
        creditCost: 2,
        status: "refunded",
        reservedAt: new Date("2026-01-01T00:00:00.000Z"),
        capturedAt: null,
        refundedAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
    );

    await refundMeteredUsage({
      idempotencyKey: "usage-refund",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      ledgerReserved: true,
    });

    assert.equal(updateMany.calls.length, 1);
  });
});
