import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InsufficientCreditsError } from "@/lib/billing/credits";
import {
  captureMeteredUsage,
  refundMeteredUsage,
  reserveMeteredUsage,
  type MeteredUsageDeps,
  type MeteredUsageReservation,
} from "@/lib/billing/metered-usage";
import {
  type LedgerStatus,
  type UsageLedgerEntry,
  UsageLedgerConflictError,
} from "@/lib/billing/usage-ledger";
import { deriveUsageLedgerKeyHash } from "@/lib/billing/usage-ledger-key";

const PERIOD_END = new Date("2026-07-31T00:00:00.000Z");

interface CallState {
  reserve: Array<{
    idempotencyKey: string;
    userId: string;
    operation: string;
    creditCost: number;
  }>;
  capture: Array<{
    idempotencyKey: string;
    userId: string;
    operation: string;
    creditCost: number;
  }>;
  refund: Array<{
    idempotencyKey: string;
    userId: string;
    operation: string;
    creditCost: number;
  }>;
  loadBillingStateForUsers: string[];
}

function makeLedgerEntry(
  input: {
    idempotencyKey: string;
    userId: string;
    operation: string;
    creditCost: number;
  },
  status: LedgerStatus,
): UsageLedgerEntry {
  return {
    id: `ledger-${status}-${input.idempotencyKey}`,
    keyHash: deriveUsageLedgerKeyHash(input),
    userId: input.userId,
    operation: input.operation,
    creditCost: input.creditCost,
    status,
    reservationVersion: 1,
    reservedAt: new Date("2026-07-01T00:00:00.000Z"),
    capturedAt:
      status === "captured" ? new Date("2026-07-01T00:00:10.000Z") : null,
    refundedAt:
      status === "refunded" ? new Date("2026-07-01T00:00:20.000Z") : null,
  };
}

function createDeps(overrides: Partial<MeteredUsageDeps> = {}): {
  deps: MeteredUsageDeps;
  calls: CallState;
} {
  const calls: CallState = {
    reserve: [],
    capture: [],
    refund: [],
    loadBillingStateForUsers: [],
  };

  const deps: MeteredUsageDeps = {
    isUnlimitedCreditsEnabled: () => false,
    computeCreditCost: (creditText) => {
      const words = creditText.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(1, words);
    },
    loadAndSyncBillingState: async (userId) => {
      calls.loadBillingStateForUsers.push(userId);
      return {
        creditBalance: 10,
        periodEnd: PERIOD_END,
      };
    },
    reserveUsage: async (opts) => {
      calls.reserve.push(opts);
      return makeLedgerEntry(opts, "reserved");
    },
    captureUsage: async (opts) => {
      calls.capture.push(opts);
      return makeLedgerEntry(opts, "captured");
    },
    refundUsage: async (opts) => {
      calls.refund.push(opts);
      return makeLedgerEntry(opts, "refunded");
    },
    ...overrides,
  };

  return { deps, calls };
}

describe("metered usage reserve", () => {
  it("bypasses billing checks when unlimited credits are enabled", async () => {
    const { deps, calls } = createDeps({
      isUnlimitedCreditsEnabled: () => true,
    });

    const result = await reserveMeteredUsage(
      {
        idempotencyKey: "usage-unlimited",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "A long prompt that would otherwise cost credits.",
      },
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.reservation.creditCost, 0);
    assert.equal(result.reservation.ledgerReserved, false);
    assert.equal(calls.reserve.length, 0);
    assert.equal(calls.loadBillingStateForUsers.length, 0);
  });

  it("uses the ledger as the single reservation gate before any balance read", async () => {
    const { deps, calls } = createDeps();
    deps.reserveUsage = async (opts) => {
      calls.reserve.push(opts);
      return makeLedgerEntry(opts, "captured");
    };
    deps.loadAndSyncBillingState = async () => {
      throw new Error("billing state should not be loaded on idempotent hit");
    };

    const result = await reserveMeteredUsage(
      {
        idempotencyKey: "usage-replay",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "retry me",
      },
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.reservation.creditCost, 2);
    assert.equal(result.reservation.ledgerReserved, true);
    assert.equal(calls.reserve.length, 1);
    assert.equal(calls.loadBillingStateForUsers.length, 0);
  });

  it("maps ledger insufficiency to payment-required details", async () => {
    const { deps, calls } = createDeps();
    deps.reserveUsage = async () => {
      throw new InsufficientCreditsError(1, 2);
    };
    deps.loadAndSyncBillingState = async (userId) => {
      calls.loadBillingStateForUsers.push(userId);
      return {
        creditBalance: 1,
        periodEnd: PERIOD_END,
      };
    };

    const result = await reserveMeteredUsage(
      {
        idempotencyKey: "usage-insufficient",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "two words",
      },
      deps,
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient-credits");
    assert.equal(result.balance, 1);
    assert.equal(result.creditCost, 2);
    assert.equal(result.periodEnd.toISOString(), PERIOD_END.toISOString());
    assert.equal(calls.loadBillingStateForUsers.length, 1);
  });

  it("maps ledger fingerprint conflicts to idempotency-conflict", async () => {
    const { deps, calls } = createDeps();
    deps.reserveUsage = async (opts) => {
      calls.reserve.push(opts);
      throw new UsageLedgerConflictError("fingerprint mismatch");
    };

    const result = await reserveMeteredUsage(
      {
        idempotencyKey: "usage-conflict",
        userId: "user-metered",
        operation: "deck-generation",
        creditText: "two words",
      },
      deps,
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "idempotency-conflict");
    assert.equal(calls.reserve.length, 1);
    assert.equal(calls.loadBillingStateForUsers.length, 0);
  });

  it("fail-closes on unexpected reservation write failures", async () => {
    const { deps } = createDeps({
      reserveUsage: async () => {
        throw new Error("ledger unavailable");
      },
    });

    await assert.rejects(
      () =>
        reserveMeteredUsage(
          {
            idempotencyKey: "usage-ledger-failed",
            userId: "user-metered",
            operation: "deck-generation",
            creditText: "two words",
          },
          deps,
        ),
      /ledger unavailable/,
    );
  });
});

describe("metered usage capture/refund", () => {
  const durableReservation: MeteredUsageReservation = {
    idempotencyKey: "usage-durable",
    keyHash: deriveUsageLedgerKeyHash({
      idempotencyKey: "usage-durable",
      userId: "user-metered",
      operation: "deck-generation",
    }),
    userId: "user-metered",
    operation: "deck-generation",
    creditCost: 2,
    ledgerReserved: true,
  };

  it("capture succeeds without ledger writes for zero-credit reservations", async () => {
    const { deps, calls } = createDeps();
    const zeroCostReservation: MeteredUsageReservation = {
      ...durableReservation,
      idempotencyKey: "usage-zero",
      creditCost: 0,
      ledgerReserved: false,
    };

    const result = await captureMeteredUsage(zeroCostReservation, deps);

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.capture.length, 0);
  });

  it("capture fails fast when no durable reservation exists for positive cost", async () => {
    const { deps, calls } = createDeps();
    const result = await captureMeteredUsage(
      {
        ...durableReservation,
        ledgerReserved: false,
      },
      deps,
    );

    assert.equal(result.ok, false);
    assert.equal(result.insufficientCredits, false);
    assert.equal(calls.capture.length, 0);
  });

  it("capture forwards to usage-ledger and reports insufficient-credit failures", async () => {
    const { deps, calls } = createDeps();
    deps.captureUsage = async (opts) => {
      calls.capture.push(opts);
      throw new InsufficientCreditsError(0, opts.creditCost);
    };

    const result = await captureMeteredUsage(durableReservation, deps);

    assert.equal(result.ok, false);
    assert.equal(result.insufficientCredits, true);
    assert.equal(calls.capture.length, 1);
  });

  it("refund skips non-durable reservations", async () => {
    const { deps, calls } = createDeps();

    const refunded = await refundMeteredUsage(
      {
        ...durableReservation,
        ledgerReserved: false,
      },
      deps,
    );

    assert.equal(refunded, null);
    assert.equal(calls.refund.length, 0);
  });

  it("refund forwards to usage-ledger for durable reservations", async () => {
    const { deps, calls } = createDeps();
    const refunded = await refundMeteredUsage(durableReservation, deps);

    assert.ok(refunded);
    assert.equal(refunded.status, "refunded");
    assert.equal(calls.refund.length, 1);
  });
});
