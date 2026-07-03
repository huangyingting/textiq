import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

describe("metered usage credit and ledger paths", () => {
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

  it("reserveMeteredUsage records a ledger reservation for positive credit cost", async (t) =>
    withLimitedCreditsEnv(async () => {
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

  it("reserveMeteredUsage still returns a reservation when ledger reserve fails", async (t) =>
    withLimitedCreditsEnv(async () => {
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

      const result = await reserveMeteredUsage({
        idempotencyKey: "usage-ledger-failed",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "two words",
      });

      assert.equal(result.ok, true);
      assert.equal(result.reservation.creditCost, 2);
      assert.equal(result.reservation.ledgerReserved, false);
    }));

  it("captureMeteredUsage captures reserved ledger usage", async (t) => {
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
    stubObjectMethod(t, prisma.user, "updateMany", async () => ({ count: 1 }));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      creditBalance: 8,
    }));
    const update = stubObjectMethod(
      t,
      prisma.usageLedgerEntry,
      "update",
      async (args) => {
        const { data } = args as { data: Record<string, unknown> };
        return {
          id: "ledger-entry",
          idempotencyKey: "usage-capture",
          userId: "user-metered",
          operation: "deck-generation",
          creditCost: 2,
          status: data.status,
          reservedAt: new Date("2026-01-01T00:00:00.000Z"),
          capturedAt: data.capturedAt,
          refundedAt: null,
        };
      },
    );

    const result = await captureMeteredUsage({
      idempotencyKey: "usage-capture",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      ledgerReserved: true,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(update.calls.length, 1);
  });

  it("captureMeteredUsage falls back to direct deduction and reports insufficient credits", async (t) => {
    stubObjectMethod(t, prisma.user, "updateMany", async () => ({ count: 0 }));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      creditBalance: 1,
    }));

    const result = await captureMeteredUsage({
      idempotencyKey: "usage-direct-capture",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 4,
      ledgerReserved: false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.insufficientCredits, true);
  });

  it("refundMeteredUsage marks ledger-reserved usage refunded", async (t) => {
    const update = stubObjectMethod(
      t,
      prisma.usageLedgerEntry,
      "update",
      async (args) => {
        const { data } = args as { data: Record<string, unknown> };
        return {
          id: "ledger-entry",
          idempotencyKey: "usage-refund",
          userId: "user-metered",
          operation: "deck-generation",
          creditCost: 2,
          status: data.status,
          reservedAt: new Date("2026-01-01T00:00:00.000Z"),
          capturedAt: null,
          refundedAt: data.refundedAt,
        };
      },
    );

    await refundMeteredUsage({
      idempotencyKey: "usage-refund",
      userId: "user-metered",
      operation: "deck-generation",
      creditCost: 2,
      ledgerReserved: true,
    });

    assert.equal(update.calls.length, 1);
  });
});
