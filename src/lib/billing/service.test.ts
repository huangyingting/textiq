import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PLAN_ENTITLEMENTS } from "@/lib/billing/catalog";
import {
  applyLocalPlanChange,
  applyLocalSubscriptionDeleted,
  applyLocalSubscriptionUpdate,
  getBillingSubscription,
  getSubscriptionCancellationState,
  loadAndSyncBillingState,
  markSubscriptionCancelAtPeriodEnd,
  recordStripeCustomer,
  shouldApplyCheckoutPlanChange,
  shouldApplySubscriptionUpdate,
  writeCheckoutSessionCompletedPlanChange,
  writeLocalSubscriptionDeleted,
  writeLocalSubscriptionUpdate,
} from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

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
  updatedAt?: Date;
}

function makeFakeClient() {
  const users = new Map<string, FakeUser>();
  const subs = new Map<string, FakeSub>();
  const client = {
    user: {
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const user = users.get(where.id);
        if (!user) throw new Error("User not found");
        return { ...user, subscription: subs.get(where.id) ?? null };
      },
      updateMany({
        where,
        data,
      }: {
        where: {
          id: string;
          plan?: string;
          creditBalance?: number;
          creditPeriodStart?: Date | null;
        };
        data: Partial<FakeUser>;
      }) {
        const user = users.get(where.id);
        if (!user) return Promise.resolve({ count: 0 });
        if (where.plan !== undefined && user.plan !== where.plan) {
          return Promise.resolve({ count: 0 });
        }
        if (
          where.creditBalance !== undefined &&
          user.creditBalance !== where.creditBalance
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (where.creditPeriodStart !== undefined) {
          const current = user.creditPeriodStart?.getTime() ?? null;
          const expected = where.creditPeriodStart?.getTime() ?? null;
          if (current !== expected) {
            return Promise.resolve({ count: 0 });
          }
        }

        Object.assign(user, data);
        return Promise.resolve({ count: 1 });
      },
      update({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeUser>;
      }) {
        const user = users.get(where.id);
        if (!user) throw new Error("User not found");
        Object.assign(user, data);
        return Promise.resolve(user);
      },
    },
    subscription: {
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
      findUnique({
        where,
      }: {
        where: { userId?: string; stripeSubscriptionId?: string };
      }) {
        if (where.userId)
          return Promise.resolve(subs.get(where.userId) ?? null);
        return Promise.resolve(
          Array.from(subs.values()).find(
            (s) => s.stripeSubscriptionId === where.stripeSubscriptionId,
          ) ?? null,
        );
      },
    },
    $transaction<T>(arg: Promise<unknown>[] | ((tx: unknown) => Promise<T>)) {
      return typeof arg === "function" ? arg(client) : Promise.all(arg);
    },
    _users: users,
    _subs: subs,
  };
  return client as unknown as typeof prisma & {
    _users: Map<string, FakeUser>;
    _subs: Map<string, FakeSub>;
  };
}

describe("billing service state", () => {
  it("centralizes credit period reset when reading billing state", async () => {
    const client = makeFakeClient();
    client._users.set("u1", {
      id: "u1",
      plan: "free",
      creditBalance: 1,
      creditPeriodStart: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const state = await loadAndSyncBillingState("u1", client);

    assert.equal(state.plan, "free");
    assert.equal(state.creditBalance, PLAN_ENTITLEMENTS.free.creditsPerPeriod);
    assert.equal(
      client._users.get("u1")?.creditBalance,
      PLAN_ENTITLEMENTS.free.creditsPerPeriod,
    );
  });

  it("keeps a fresh credit period when reading billing state", async () => {
    const client = makeFakeClient();
    const periodStart = new Date();
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 1234,
      creditPeriodStart: periodStart,
    });

    const state = await loadAndSyncBillingState("u1", client);

    assert.equal(state.plan, "plus");
    assert.equal(state.creditBalance, 1234);
    assert.deepEqual(state.creditPeriodStart, periodStart);
  });

  it("applies provider-independent local plan transitions", async () => {
    const client = makeFakeClient();
    client._users.set("u1", {
      id: "u1",
      plan: "free",
      creditBalance: 500,
      creditPeriodStart: null,
    });

    await applyLocalPlanChange("u1", "pro", { client });

    assert.equal(client._users.get("u1")?.plan, "pro");
    assert.equal(
      client._users.get("u1")?.creditBalance,
      PLAN_ENTITLEMENTS.pro.creditsPerPeriod,
    );
    assert.equal(client._subs.get("u1")?.plan, "pro");
    assert.equal(client._subs.get("u1")?.status, "active");
  });

  it("records Stripe customer ids without mutating the current plan", async () => {
    const client = makeFakeClient();
    client._users.set("u1", {
      id: "u1",
      plan: "free",
      creditBalance: 500,
      creditPeriodStart: null,
    });

    await recordStripeCustomer("u1", "cus_123", {
      client,
      fallbackPlan: "free",
      periodPlan: "pro",
    });

    assert.equal(client._users.get("u1")?.plan, "free");
    assert.equal(client._subs.get("u1")?.plan, "free");
    assert.equal(client._subs.get("u1")?.stripeCustomerId, "cus_123");
  });

  it("updates an existing subscription when recording a Stripe customer id", async () => {
    const client = makeFakeClient();
    const periodStart = new Date("2026-06-01T00:00:00Z");
    const periodEnd = new Date("2026-07-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: periodStart,
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_old",
      stripeSubscriptionId: null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    await recordStripeCustomer("u1", "cus_new", { client });

    assert.equal(client._subs.get("u1")?.stripeCustomerId, "cus_new");
    assert.equal(client._subs.get("u1")?.plan, "plus");
  });

  it("can preserve an existing subscription period during local free-plan fallback", async () => {
    const client = makeFakeClient();
    const periodStart = new Date("2026-06-01T00:00:00Z");
    const periodEnd = new Date("2026-07-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: periodStart,
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "plus",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });

    await applyLocalPlanChange("u1", "free", {
      client,
      updateSubscriptionPeriodOnExisting: false,
    });

    assert.equal(client._subs.get("u1")?.plan, "free");
    assert.deepEqual(client._subs.get("u1")?.currentPeriodStart, periodStart);
    assert.deepEqual(client._subs.get("u1")?.currentPeriodEnd, periodEnd);
  });

  it("reads and marks subscription cancellation state", async () => {
    const client = makeFakeClient();
    const periodStart = new Date("2026-06-01T00:00:00Z");
    const periodEnd = new Date("2026-07-01T00:00:00Z");
    client._subs.set("u1", {
      userId: "u1",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    const cancellation = await getSubscriptionCancellationState("u1", client);
    assert.equal(cancellation?.status, "active");
    assert.equal(cancellation?.stripeSubscriptionId, "sub_123");
    assert.deepEqual(await getBillingSubscription("u1", client), {
      userId: "u1",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    await markSubscriptionCancelAtPeriodEnd("u1", true, client);
    assert.equal(client._subs.get("u1")?.cancelAtPeriodEnd, true);
  });

  it("applies subscription updates only when the incoming period is current", async () => {
    const client = makeFakeClient();
    const storedEnd = new Date("2026-07-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: new Date("2026-06-01T00:00:00Z"),
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: storedEnd,
      cancelAtPeriodEnd: false,
    });

    assert.equal(shouldApplySubscriptionUpdate(null, undefined), true);
    assert.equal(shouldApplySubscriptionUpdate(storedEnd, undefined), false);
    assert.equal(
      shouldApplySubscriptionUpdate(
        storedEnd,
        new Date("2026-06-30T00:00:00Z"),
      ),
      false,
    );
    assert.equal(
      await writeLocalSubscriptionUpdate(client, "sub_missing", {
        status: "active",
        cancelAtPeriodEnd: false,
      }),
      "missing",
    );
    assert.equal(
      await writeLocalSubscriptionUpdate(client, "sub_123", {
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date("2026-06-30T00:00:00Z"),
      }),
      "stale",
    );
    assert.equal(
      await applyLocalSubscriptionUpdate(
        "sub_123",
        {
          status: "past_due",
          cancelAtPeriodEnd: true,
          plan: "pro",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
        },
        client,
      ),
      "applied",
    );
    assert.equal(client._subs.get("u1")?.status, "past_due");
    assert.equal(client._subs.get("u1")?.plan, "pro");
    assert.equal(client._users.get("u1")?.plan, "pro");
    assert.equal(
      client._users.get("u1")?.creditBalance,
      PLAN_ENTITLEMENTS.pro.creditsPerPeriod,
    );
    assert.deepEqual(
      client._users.get("u1")?.creditPeriodStart,
      new Date("2026-07-01T00:00:00Z"),
    );
  });

  it("skips checkout plan changes when local subscription state is already current", async () => {
    const client = makeFakeClient();
    const existingPeriodStart = new Date("2026-07-01T00:00:00Z");
    const existingPeriodEnd = new Date("2026-08-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "pro",
      creditBalance: 12_345,
      creditPeriodStart: existingPeriodStart,
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: existingPeriodStart,
      currentPeriodEnd: existingPeriodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: new Date("2026-07-01T00:05:00Z"),
    });

    assert.equal(
      shouldApplyCheckoutPlanChange(
        client._subs.get("u1"),
        new Date("2026-08-01T00:00:00Z"),
      ),
      false,
    );
    assert.equal(
      shouldApplyCheckoutPlanChange(
        {
          currentPeriodEnd: new Date("2026-07-15T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:05:00Z"),
        },
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-07-01T00:00:00Z"),
      ),
      false,
    );
    assert.equal(
      await writeCheckoutSessionCompletedPlanChange(client, "u1", "pro", {
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        currentPeriodStart: new Date("2026-07-01T00:10:00Z"),
        currentPeriodEnd: new Date("2026-07-31T00:10:00Z"),
        cancelAtPeriodEnd: false,
      }),
      "stale",
    );

    assert.equal(client._users.get("u1")?.creditBalance, 12_345);
    assert.deepEqual(
      client._users.get("u1")?.creditPeriodStart,
      existingPeriodStart,
    );
    assert.deepEqual(
      client._subs.get("u1")?.currentPeriodEnd,
      existingPeriodEnd,
    );
  });

  it("applies checkout plan changes when no matching Stripe subscription is stored", async () => {
    const client = makeFakeClient();
    const periodStart = new Date("2026-07-01T00:00:00Z");
    const periodEnd = new Date("2026-08-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "free",
      creditBalance: 500,
      creditPeriodStart: new Date("2026-06-01T00:00:00Z"),
    });

    assert.equal(
      await writeCheckoutSessionCompletedPlanChange(client, "u1", "pro", {
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      }),
      "applied",
    );

    assert.equal(client._users.get("u1")?.plan, "pro");
    assert.equal(
      client._users.get("u1")?.creditBalance,
      PLAN_ENTITLEMENTS.pro.creditsPerPeriod,
    );
    assert.deepEqual(client._subs.get("u1")?.currentPeriodEnd, periodEnd);
  });

  it("resets credits when Stripe downgrades a subscription plan", async () => {
    const client = makeFakeClient();
    const storedEnd = new Date("2026-08-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "pro",
      creditBalance: 123,
      creditPeriodStart: new Date("2026-07-01T00:00:00Z"),
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
      currentPeriodEnd: storedEnd,
      cancelAtPeriodEnd: false,
    });

    const periodStart = new Date("2026-08-01T00:00:00Z");
    assert.equal(
      await writeLocalSubscriptionUpdate(client, "sub_123", {
        status: "active",
        cancelAtPeriodEnd: false,
        plan: "plus",
        currentPeriodStart: periodStart,
        currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      }),
      "applied",
    );

    assert.equal(client._subs.get("u1")?.plan, "plus");
    assert.equal(client._users.get("u1")?.plan, "plus");
    assert.equal(
      client._users.get("u1")?.creditBalance,
      PLAN_ENTITLEMENTS.plus.creditsPerPeriod,
    );
    assert.deepEqual(client._users.get("u1")?.creditPeriodStart, periodStart);
  });

  it("applies subscription status updates without changing the user's plan", async () => {
    const client = makeFakeClient();
    const storedEnd = new Date("2026-07-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: new Date("2026-06-01T00:00:00Z"),
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: storedEnd,
      cancelAtPeriodEnd: false,
    });

    assert.equal(
      await writeLocalSubscriptionUpdate(client, "sub_123", {
        status: "past_due",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: storedEnd,
      }),
      "applied",
    );
    assert.equal(client._subs.get("u1")?.status, "past_due");
    assert.equal(client._subs.get("u1")?.cancelAtPeriodEnd, true);
    assert.equal(client._subs.get("u1")?.plan, "plus");
    assert.equal(client._users.get("u1")?.plan, "plus");
  });

  it("reports missing subscription updates without mutating local state", async () => {
    const client = makeFakeClient();
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: new Date("2026-06-01T00:00:00Z"),
    });

    const result = await writeLocalSubscriptionUpdate(client, "sub_missing", {
      status: "active",
      cancelAtPeriodEnd: false,
      plan: "pro",
      currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    });

    assert.equal(result, "missing");
    assert.equal(client._users.get("u1")?.plan, "plus");
  });

  it("skips stale subscription updates before writing subscription fields", async () => {
    const client = makeFakeClient();
    const storedEnd = new Date("2026-08-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "plus",
      creditBalance: 10_000,
      creditPeriodStart: new Date("2026-07-01T00:00:00Z"),
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
      currentPeriodEnd: storedEnd,
      cancelAtPeriodEnd: false,
    });

    const result = await writeLocalSubscriptionUpdate(client, "sub_123", {
      status: "past_due",
      cancelAtPeriodEnd: true,
      plan: "pro",
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    });

    assert.equal(result, "stale");
    assert.equal(client._subs.get("u1")?.status, "active");
    assert.equal(client._subs.get("u1")?.cancelAtPeriodEnd, false);
    assert.equal(client._users.get("u1")?.plan, "plus");
  });

  it("downgrades local state when Stripe reports a subscription deletion", async () => {
    const client = makeFakeClient();
    const periodStart = new Date("2026-06-01T00:00:00Z");
    const periodEnd = new Date("2026-07-01T00:00:00Z");
    client._users.set("u1", {
      id: "u1",
      plan: "pro",
      creditBalance: 20_000,
      creditPeriodStart: periodStart,
    });
    client._subs.set("u1", {
      userId: "u1",
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    assert.equal(
      await writeLocalSubscriptionDeleted(
        client,
        "sub_missing",
        { status: "cancelled", cancelAtPeriodEnd: false },
        periodEnd,
      ),
      "missing",
    );
    assert.equal(
      await applyLocalSubscriptionDeleted(
        "sub_123",
        { status: "cancelled", cancelAtPeriodEnd: false },
        client,
        periodEnd,
      ),
      "applied",
    );
    assert.equal(client._users.get("u1")?.plan, "free");
    assert.equal(client._subs.get("u1")?.plan, "free");
    assert.equal(client._subs.get("u1")?.status, "cancelled");
    assert.deepEqual(client._subs.get("u1")?.currentPeriodEnd, periodEnd);
  });
});
