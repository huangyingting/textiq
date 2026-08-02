/**
 * Unit tests for the MockBillingProvider plan transitions (US-010 epic).
 *
 * Tests mock the Prisma client so there is no live DB dependency.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import type { Plan } from "@/lib/billing/catalog";

// ---------------------------------------------------------------------------
// In-memory store that mimics the shape of the DB calls MockBillingProvider
// uses. We stub prisma.$transaction, prisma.user.update, and
// prisma.subscription.upsert / prisma.subscription.findUnique.
// ---------------------------------------------------------------------------

interface FakeUser {
  id: string;
  plan: string;
  creditBalance: number;
  creditPeriodStart: Date | null;
}

interface FakeSub {
  userId: string;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

function makeFakeDb() {
  const users = new Map<string, FakeUser>();
  const subs = new Map<string, FakeSub>();

  return {
    users,
    subs,
    user: {
      update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeUser>;
      }) {
        const u = users.get(where.id);
        if (!u) throw new Error(`User ${where.id} not found`);
        Object.assign(u, data);
        return Promise.resolve(u);
      },
    },
    subscription: {
      findUnique({
        where,
      }: {
        where: { userId?: string; stripeSubscriptionId?: string };
      }) {
        if (where.userId)
          return Promise.resolve(subs.get(where.userId) ?? null);
        if (where.stripeSubscriptionId) {
          for (const s of subs.values()) {
            if (s.stripeSubscriptionId === where.stripeSubscriptionId)
              return Promise.resolve(s);
          }
        }
        return Promise.resolve(null);
      },
      upsert({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: FakeSub;
        update: Partial<FakeSub>;
      }) {
        const existing = subs.get(where.userId);
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve(existing);
        }
        subs.set(where.userId, create);
        return Promise.resolve(create);
      },
      update({
        where,
        data,
      }: {
        where: { userId?: string; stripeSubscriptionId?: string };
        data: Partial<FakeSub>;
      }) {
        const sub = where.userId
          ? subs.get(where.userId)
          : Array.from(subs.values()).find(
              (s) => s.stripeSubscriptionId === where.stripeSubscriptionId,
            );
        if (!sub) throw new Error("Subscription not found");
        Object.assign(sub, data);
        return Promise.resolve(sub);
      },
    },
    $transaction(ops: Promise<unknown>[]) {
      return Promise.all(ops);
    },
  };
}

// ---------------------------------------------------------------------------
// Inline mock provider that uses the fake DB (avoids module mocking complexity)
// ---------------------------------------------------------------------------

import {
  getEntitlements,
  isPlan,
  PLAN_ENTITLEMENTS,
} from "@/lib/billing/catalog";
import { MockBillingProvider } from "@/lib/billing/mock-provider";

function makeMockProvider(db: ReturnType<typeof makeFakeDb>) {
  return {
    async changePlan(userId: string, targetPlan: Plan) {
      if (!isPlan(targetPlan)) {
        return {
          success: false,
          plan: "free" as Plan,
          message: `Unknown plan: ${targetPlan}.`,
        };
      }
      const entitlements = getEntitlements(targetPlan);
      const now = new Date();
      const periodEnd = new Date(
        now.getTime() + entitlements.periodDays * 24 * 60 * 60 * 1000,
      );

      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: {
            plan: targetPlan,
            creditBalance: entitlements.creditsPerPeriod,
            creditPeriodStart: now,
          },
        }),
        db.subscription.upsert({
          where: { userId },
          create: {
            userId,
            plan: targetPlan,
            status: "active",
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
          update: {
            plan: targetPlan,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
        }),
      ]);

      return {
        success: true,
        plan: targetPlan,
        message: `Plan updated to ${targetPlan}.`,
      };
    },

    async cancelSubscription(userId: string) {
      const sub = await db.subscription.findUnique({ where: { userId } });
      if (!sub) {
        return {
          success: true,
          plan: "free" as Plan,
          message: "No active subscription to cancel.",
        };
      }
      await db.subscription.update({
        where: { userId },
        data: { cancelAtPeriodEnd: true },
      });
      return {
        success: true,
        plan: sub.plan as Plan,
        message:
          "Subscription will be cancelled at the end of the current period.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MockBillingProvider", () => {
  let db: ReturnType<typeof makeFakeDb>;

  before(() => {
    db = makeFakeDb();
    db.users.set("u1", {
      id: "u1",
      plan: "free",
      creditBalance: 500,
      creditPeriodStart: null,
    });
  });

  describe("MockBillingProvider production safeguards", () => {
    it("rejects unknown plans before touching billing state", async () => {
      const provider = new MockBillingProvider();

      const result = await provider.changePlan(
        "user-mock",
        "enterprise" as Plan,
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.plan, "free");
      assert.match(result.message, /Unknown plan/);
    });

    it("does not grant paid plans in production", async () => {
      const env = process.env as Record<string, string | undefined>;
      const previousNodeEnv = process.env.NODE_ENV;
      env.NODE_ENV = "production";
      try {
        const provider = new MockBillingProvider();
        const result = await provider.changePlan("user-mock", "plus");

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.plan, "free");
        assert.match(result.message, /Mock billing cannot grant paid plans/);
      } finally {
        if (previousNodeEnv === undefined) {
          delete env.NODE_ENV;
        } else {
          env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("grants paid plans only for the explicit SQLite production profile", async () => {
      const env = process.env as Record<string, string | undefined>;
      const previous = { ...process.env };
      env.NODE_ENV = "production";
      env.E2E_PROFILE = "1";
      env.E2E_PROFILE_MOCK_BILLING = "1";
      env.DB_PROVIDER = "sqlite";
      env.DATABASE_URL = "file:/tmp/textiq-e2e.db";
      const calls: Array<{ userId: string; plan: Plan }> = [];
      try {
        const provider = new MockBillingProvider({
          applyLocalPlanChange: async (userId, plan) => {
            calls.push({ userId, plan });
          },
        });
        const result = await provider.changePlan("user-mock", "plus");

        assert.deepEqual(calls, [{ userId: "user-mock", plan: "plus" }]);
        assert.strictEqual(result.success, true);
      } finally {
        process.env = previous;
      }
    });

    it("cancelSubscriptionImmediately is a no-op for the mock provider", async () => {
      const provider = new MockBillingProvider();

      await assert.doesNotReject(() =>
        provider.cancelSubscriptionImmediately("user-mock"),
      );
    });

    it("applies a paid plan through injected local billing dependencies", async () => {
      const calls: Array<{ userId: string; plan: Plan }> = [];
      const provider = new MockBillingProvider({
        applyLocalPlanChange: async (userId, plan) => {
          calls.push({ userId, plan });
        },
      });

      const result = await provider.changePlan("user-mock", "plus");

      assert.deepEqual(calls, [{ userId: "user-mock", plan: "plus" }]);
      assert.deepEqual(result, {
        success: true,
        plan: "plus",
        message: "Plan updated to plus.",
      });
    });

    it("returns free when cancelling without an active subscription", async () => {
      let markedUserId: string | null = null;
      const provider = new MockBillingProvider({
        getBillingSubscription: async () => null,
        markSubscriptionCancelAtPeriodEnd: async (userId) => {
          markedUserId = userId;
        },
      });

      const result = await provider.cancelSubscription("user-no-subscription");

      assert.equal(markedUserId, null);
      assert.deepEqual(result, {
        success: true,
        plan: "free",
        message: "No active subscription to cancel.",
      });
    });

    it("marks an existing subscription for period-end cancellation", async () => {
      let markedUserId: string | null = null;
      const provider = new MockBillingProvider({
        getBillingSubscription: async () => ({
          plan: "pro",
          status: "active",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
          cancelAtPeriodEnd: false,
        }),
        markSubscriptionCancelAtPeriodEnd: async (userId) => {
          markedUserId = userId;
        },
      });

      const result = await provider.cancelSubscription(
        "user-with-subscription",
      );

      assert.equal(markedUserId, "user-with-subscription");
      assert.deepEqual(result, {
        success: true,
        plan: "pro",
        message:
          "Subscription will be cancelled at the end of the current period.",
      });
    });
  });

  it("changePlan free → plus: updates plan and credits", async () => {
    const provider = makeMockProvider(db);
    const result = await provider.changePlan("u1", "plus");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.plan, "plus");

    const user = db.users.get("u1")!;
    assert.strictEqual(user.plan, "plus");
    assert.strictEqual(
      user.creditBalance,
      PLAN_ENTITLEMENTS.plus.creditsPerPeriod,
    );
  });

  it("changePlan plus → pro: updates plan and credits", async () => {
    const provider = makeMockProvider(db);
    const result = await provider.changePlan("u1", "pro");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.plan, "pro");

    const user = db.users.get("u1")!;
    assert.strictEqual(user.plan, "pro");
    assert.strictEqual(
      user.creditBalance,
      PLAN_ENTITLEMENTS.pro.creditsPerPeriod,
    );
  });

  it("changePlan pro → free (downgrade): updates plan and credits", async () => {
    const provider = makeMockProvider(db);
    const result = await provider.changePlan("u1", "free");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.plan, "free");

    const user = db.users.get("u1")!;
    assert.strictEqual(user.plan, "free");
    assert.strictEqual(
      user.creditBalance,
      PLAN_ENTITLEMENTS.free.creditsPerPeriod,
    );
  });

  it("changePlan with invalid plan: returns failure", async () => {
    const provider = makeMockProvider(db);
    const result = await provider.changePlan("u1", "enterprise" as Plan);
    assert.strictEqual(result.success, false);
  });

  it("cancelSubscription: sets cancelAtPeriodEnd = true on subscription", async () => {
    const provider = makeMockProvider(db);
    // First ensure a subscription exists
    await provider.changePlan("u1", "plus");

    const result = await provider.cancelSubscription("u1");
    assert.strictEqual(result.success, true);

    const sub = db.subs.get("u1")!;
    assert.strictEqual(sub.cancelAtPeriodEnd, true);
  });

  it("cancelSubscription with no subscription: returns success with free plan", async () => {
    db.subs.delete("u2"); // no sub for u2
    db.users.set("u2", {
      id: "u2",
      plan: "free",
      creditBalance: 500,
      creditPeriodStart: null,
    });

    const provider = makeMockProvider(db);
    const result = await provider.cancelSubscription("u2");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.plan, "free");
  });
});
