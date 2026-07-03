/**
 * Unit tests for credit calculation helpers (US-010 epic).
 *
 * Tests are pure — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  countWords,
  computeCreditCost,
  hasSufficientCredits,
  deductCredits,
  InsufficientCreditsError,
} from "@/lib/billing/credits";
import { loadAndSyncBillingState } from "@/lib/billing/service";

import { prisma } from "@/lib/prisma";

function prismaClientFixture(value: unknown): typeof prisma {
  return value as unknown as typeof prisma;
}

// ---------------------------------------------------------------------------
// In-memory fake of the Prisma calls the credit helpers use, so the atomic
// deduction and period-reset logic can be exercised without a live DB.
// ---------------------------------------------------------------------------

interface FakeRow {
  creditBalance: number;
  plan: string;
  creditPeriodStart: Date | null;
}

function makeFakeClient(initial: Partial<FakeRow> & { creditBalance: number }) {
  const row: FakeRow = {
    creditBalance: initial.creditBalance,
    plan: initial.plan ?? "free",
    creditPeriodStart: initial.creditPeriodStart ?? null,
  };
  const calls = { updateMany: 0, update: 0 };

  const client = {
    user: {
      async findUniqueOrThrow() {
        return { ...row };
      },
      async update({
        data,
      }: {
        data: { creditBalance?: number; creditPeriodStart?: Date };
      }) {
        calls.update++;
        if (data.creditBalance !== undefined)
          row.creditBalance = data.creditBalance;
        if (data.creditPeriodStart !== undefined)
          row.creditPeriodStart = data.creditPeriodStart;
        return { ...row };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { creditBalance?: { gte: number } };
        data: { creditBalance?: { decrement: number } };
      }) {
        calls.updateMany++;
        const gte = where.creditBalance?.gte ?? 0;
        if (row.creditBalance >= gte) {
          const decrement = data.creditBalance?.decrement ?? 0;
          row.creditBalance -= decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };

  return {
    row,
    calls,
    client: prismaClientFixture(client),
  };
}

describe("countWords", () => {
  it("counts whitespace-delimited tokens", () => {
    assert.strictEqual(countWords("hello world"), 2);
    assert.strictEqual(countWords("one two three four"), 4);
  });

  it("returns at least 1 for non-empty strings", () => {
    assert.strictEqual(countWords("x"), 1);
    assert.strictEqual(countWords("."), 1);
  });

  it("trims and collapses whitespace", () => {
    assert.strictEqual(countWords("  hello   world  "), 2);
    assert.strictEqual(countWords("\thello\nworld"), 2);
  });

  it("returns 1 for strings with only whitespace (no tokens)", () => {
    // "   ".split(/\s+/).filter(Boolean) = [] → max(1, 0) = 1
    assert.strictEqual(countWords("   "), 1);
  });

  it("handles empty string", () => {
    assert.strictEqual(countWords(""), 1);
  });

  it("handles a longer sentence", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    assert.strictEqual(countWords(text), 9);
  });
});

describe("computeCreditCost", () => {
  it("equals wordCount for typical input", () => {
    const text = "machine learning pipeline architecture diagram";
    assert.strictEqual(computeCreditCost(text), countWords(text));
  });

  it("returns at least 1 for any input", () => {
    assert.strictEqual(computeCreditCost(""), 1);
    assert.strictEqual(computeCreditCost("x"), 1);
  });

  it("scales linearly with word count", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    assert.strictEqual(computeCreditCost(words), 50);
  });
});

describe("hasSufficientCredits", () => {
  it("allows when balance exceeds cost", () => {
    assert.strictEqual(hasSufficientCredits(100, 10), true);
  });

  it("allows when balance exactly equals cost (boundary)", () => {
    assert.strictEqual(hasSufficientCredits(10, 10), true);
  });

  it("denies when balance is below cost (insufficient credits)", () => {
    assert.strictEqual(hasSufficientCredits(9, 10), false);
    assert.strictEqual(hasSufficientCredits(0, 1), false);
  });
});

describe("deductCredits (atomic conditional decrement)", () => {
  it("applies the deduction when the balance covers the cost", async () => {
    const { client, row, calls } = makeFakeClient({ creditBalance: 100 });
    const newBalance = await deductCredits("user-1", 10, client);
    assert.strictEqual(newBalance, 90);
    assert.strictEqual(row.creditBalance, 90);
    assert.strictEqual(calls.updateMany, 1);
  });

  it("applies the deduction at the exact boundary (balance === cost)", async () => {
    const { client, row } = makeFakeClient({ creditBalance: 10 });
    const newBalance = await deductCredits("user-1", 10, client);
    assert.strictEqual(newBalance, 0);
    assert.strictEqual(row.creditBalance, 0);
  });

  it("rejects (count === 0) and never goes negative when insufficient", async () => {
    const { client, row, calls } = makeFakeClient({ creditBalance: 5 });
    await assert.rejects(
      () => deductCredits("user-1", 10, client),
      (err: unknown) => {
        assert.ok(err instanceof InsufficientCreditsError);
        assert.strictEqual(err.balance, 5);
        assert.strictEqual(err.cost, 10);
        return true;
      },
    );
    // The guarded updateMany matched no row, so the balance is untouched.
    assert.strictEqual(row.creditBalance, 5);
    assert.strictEqual(calls.updateMany, 1);
  });

  it("is a no-op for a non-positive cost (unlimited-credits gate, #97)", async () => {
    const { client, row, calls } = makeFakeClient({ creditBalance: 50 });
    const newBalance = await deductCredits("user-1", 0, client);
    assert.strictEqual(newBalance, 50);
    assert.strictEqual(row.creditBalance, 50);
    // No write is attempted when cost is zero.
    assert.strictEqual(calls.updateMany, 0);
  });
});

describe("loadAndSyncBillingState (entitlements-derived balance)", () => {
  it("returns the live balance within an active period", async () => {
    const { client } = makeFakeClient({
      creditBalance: 320,
      plan: "free",
      creditPeriodStart: new Date(),
    });
    const state = await loadAndSyncBillingState("user-1", client);
    assert.strictEqual(state.creditBalance, 320);
    assert.strictEqual(state.rawPlan, "free");
  });

  it("resets the balance to creditsPerPeriod on first access", async () => {
    const { client, row } = makeFakeClient({
      creditBalance: 0,
      plan: "free",
      creditPeriodStart: null,
    });
    const state = await loadAndSyncBillingState("user-1", client);
    // free plan = 500 credits/week.
    assert.strictEqual(state.creditBalance, 500);
    assert.strictEqual(row.creditBalance, 500);
  });

  it("resets the balance when the period has elapsed", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { client, row } = makeFakeClient({
      creditBalance: 3,
      plan: "free",
      creditPeriodStart: eightDaysAgo,
    });
    const state = await loadAndSyncBillingState("user-1", client);
    assert.strictEqual(state.creditBalance, 500);
    assert.strictEqual(row.creditBalance, 500);
  });
});

describe("credit period reset boundary", () => {
  // This tests the conceptual boundary: period elapsed means reset
  it("period elapsed when now >= periodStart + periodDays * ms", () => {
    const periodDays = 7;
    const periodMs = periodDays * 24 * 60 * 60 * 1000;

    const now = Date.now();
    const periodStart = now - periodMs; // exactly expired
    assert.ok(now >= periodStart + periodMs, "period should have elapsed");
  });

  it("period NOT elapsed when now < periodStart + periodDays * ms", () => {
    const periodDays = 7;
    const periodMs = periodDays * 24 * 60 * 60 * 1000;

    const now = Date.now();
    const periodStart = now - periodMs + 60_000; // 1 minute to go
    assert.ok(now < periodStart + periodMs, "period should not have elapsed");
  });
});
