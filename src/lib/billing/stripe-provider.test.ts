/**
 * Unit tests for the Stripe webhook state reducer (#97, criterion 5/7).
 *
 * Pure functions only — no DB, no network. Verifies that subscription
 * update / delete / cancel events map to reliable {plan,status,period,cancel}
 * state.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyStripeWebhookEvent,
  handleStripeWebhookEvent,
  mapStripeSubscriptionStatus,
  planFromPriceId,
  reduceStripeSubscriptionEvent,
  setStripeLoaderForTesting,
  StripeBillingProvider,
  type StripeSubscriptionLike,
} from "@/lib/billing/stripe-provider";
import { shouldApplySubscriptionUpdate } from "@/lib/billing/service";
import { prisma } from "@/lib/prisma";

const ENV = {
  STRIPE_PLUS_PRICE_ID: "price_plus",
  STRIPE_PRO_PRICE_ID: "price_pro",
};

const previousStripePriceEnv = {
  plus: process.env.STRIPE_PLUS_PRICE_ID,
  pro: process.env.STRIPE_PRO_PRICE_ID,
  secret: process.env.STRIPE_SECRET_KEY,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
};

before(() => {
  process.env.STRIPE_PLUS_PRICE_ID = ENV.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = ENV.STRIPE_PRO_PRICE_ID;
});

after(() => {
  if (previousStripePriceEnv.plus === undefined) {
    delete process.env.STRIPE_PLUS_PRICE_ID;
  } else {
    process.env.STRIPE_PLUS_PRICE_ID = previousStripePriceEnv.plus;
  }
  if (previousStripePriceEnv.pro === undefined) {
    delete process.env.STRIPE_PRO_PRICE_ID;
  } else {
    process.env.STRIPE_PRO_PRICE_ID = previousStripePriceEnv.pro;
  }
  if (previousStripePriceEnv.secret === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = previousStripePriceEnv.secret;
  }
  if (previousStripePriceEnv.appUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = previousStripePriceEnv.appUrl;
  }
});

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

describe("mapStripeSubscriptionStatus", () => {
  it("maps active/trialing → active", () => {
    assert.strictEqual(mapStripeSubscriptionStatus("active"), "active");
    assert.strictEqual(mapStripeSubscriptionStatus("trialing"), "active");
  });

  it("maps past_due/unpaid → past_due", () => {
    assert.strictEqual(mapStripeSubscriptionStatus("past_due"), "past_due");
    assert.strictEqual(mapStripeSubscriptionStatus("unpaid"), "past_due");
  });

  it("maps canceled/incomplete_expired → cancelled", () => {
    assert.strictEqual(mapStripeSubscriptionStatus("canceled"), "cancelled");
    assert.strictEqual(
      mapStripeSubscriptionStatus("incomplete_expired"),
      "cancelled",
    );
  });

  it("maps unknown/undefined → inactive", () => {
    assert.strictEqual(mapStripeSubscriptionStatus("incomplete"), "inactive");
    assert.strictEqual(mapStripeSubscriptionStatus(undefined), "inactive");
  });
});

describe("planFromPriceId", () => {
  it("resolves configured price ids to plans", () => {
    assert.strictEqual(planFromPriceId("price_plus", ENV), "plus");
    assert.strictEqual(planFromPriceId("price_pro", ENV), "pro");
  });

  it("returns null for unknown/missing price ids", () => {
    assert.strictEqual(planFromPriceId("price_other", ENV), null);
    assert.strictEqual(planFromPriceId(undefined, ENV), null);
    assert.strictEqual(planFromPriceId(null, ENV), null);
  });
});

describe("StripeBillingProvider local plan guards", () => {
  it("rejects unknown plans before loading Stripe", async () => {
    const provider = new StripeBillingProvider();

    const result = await provider.changePlan(
      "user-stripe",
      "enterprise" as never,
    );

    assert.deepEqual(result, {
      success: false,
      plan: "free",
      message: "Unknown plan: enterprise.",
    });
  });

  it("cancelSubscriptionImmediately skips users without a Stripe subscription", async (t) => {
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => null);
    const provider = new StripeBillingProvider();

    await assert.doesNotReject(() =>
      provider.cancelSubscriptionImmediately("user-without-subscription"),
    );
  });

  it("cancelSubscription downgrades locally when no Stripe subscription is stored", async (t) => {
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => null);
    const userUpdate = stubObjectMethod(
      t,
      prisma.user,
      "update",
      async () => ({}),
    );
    const subUpsert = stubObjectMethod(
      t,
      prisma.subscription,
      "upsert",
      async () => ({}),
    );
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (tx: typeof prisma) => unknown)(prisma),
    );
    const provider = new StripeBillingProvider();

    const result = await provider.cancelSubscription("user-local-downgrade");

    assert.deepEqual(result, {
      success: true,
      plan: "free",
      message: "Subscription cancelled.",
    });
    assert.equal(userUpdate.calls.length, 1);
    assert.equal(subUpsert.calls.length, 1);
  });

  it("routes free plan changes through subscription cancellation", async (t) => {
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => null);
    stubObjectMethod(t, prisma.user, "update", async () => ({}));
    stubObjectMethod(t, prisma.subscription, "upsert", async () => ({}));
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (tx: typeof prisma) => unknown)(prisma),
    );
    const provider = new StripeBillingProvider();

    const result = await provider.changePlan("user-free", "free");

    assert.equal(result.success, true);
    assert.equal(result.plan, "free");
  });

  it("loads configured checkout prerequisites before reporting a missing Stripe SDK", async (t) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_textiq";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
    const userLookup = stubObjectMethod(
      t,
      prisma.user,
      "findUniqueOrThrow",
      async () => ({ email: "billing@example.test" }),
    );
    const subscriptionLookup = stubObjectMethod(
      t,
      prisma.subscription,
      "findUnique",
      async () => null,
    );
    const provider = new StripeBillingProvider();

    await assert.rejects(() => provider.changePlan("user-checkout", "plus"), {
      message:
        "The `stripe` package is not installed. Run `npm install stripe` to enable Stripe billing.",
    });

    assert.equal(userLookup.calls.length, 1);
    assert.equal(subscriptionLookup.calls.length, 0);
  });

  it("creates a Stripe customer and checkout session for new paid subscribers", async (t) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_textiq";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
    process.env.STRIPE_PLUS_PRICE_ID = "price_plus";
    const customerCalls: unknown[] = [];
    const sessionCalls: unknown[] = [];
    setStripeLoaderForTesting(async () => ({
      customers: {
        async create(args) {
          customerCalls.push(args);
          return { id: "cus_new" };
        },
      },
      checkout: {
        sessions: {
          async create(args) {
            sessionCalls.push(args);
            return { url: "https://checkout.example.test/session" };
          },
        },
      },
      subscriptions: {
        async cancel() {},
        async update() {},
      },
      webhooks: {
        constructEvent() {
          throw new Error("not used");
        },
      },
    }));
    t.after(() => setStripeLoaderForTesting(null));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      email: "billing@example.test",
    }));
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => null);
    const upsert = stubObjectMethod(
      t,
      prisma.subscription,
      "upsert",
      async () => ({}),
    );
    const provider = new StripeBillingProvider();

    const result = await provider.changePlan("user-checkout", "plus");

    assert.deepEqual(result, {
      success: true,
      plan: "plus",
      message: "Redirecting to Stripe checkout…",
      redirectUrl: "https://checkout.example.test/session",
    });
    assert.equal(customerCalls.length, 1);
    assert.equal(upsert.calls.length, 1);
    assert.equal(sessionCalls.length, 1);
    const plusSession = sessionCalls[0] as {
      line_items: Array<{ price: string }>;
    };
    assert.equal(plusSession.line_items[0]?.price, "price_plus");
  });

  it("reuses an existing Stripe customer for paid checkout", async (t) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_textiq";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    const customerCalls: unknown[] = [];
    const sessionCalls: unknown[] = [];
    setStripeLoaderForTesting(async () => ({
      customers: {
        async create(args) {
          customerCalls.push(args);
          return { id: "cus_unused" };
        },
      },
      checkout: {
        sessions: {
          async create(args) {
            sessionCalls.push(args);
            return { url: null };
          },
        },
      },
      subscriptions: {
        async cancel() {},
        async update() {},
      },
      webhooks: {
        constructEvent() {
          throw new Error("not used");
        },
      },
    }));
    t.after(() => setStripeLoaderForTesting(null));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      email: "billing@example.test",
    }));
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => ({
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
    }));
    const provider = new StripeBillingProvider();

    const result = await provider.changePlan("user-checkout", "pro");

    assert.equal(result.success, true);
    assert.equal(result.redirectUrl, undefined);
    assert.equal(customerCalls.length, 0);
    const proSession = sessionCalls[0] as {
      customer: string;
      line_items: Array<{ price: string }>;
    };
    assert.equal(proSession.customer, "cus_existing");
    assert.equal(proSession.line_items[0]?.price, "price_pro");
  });

  it("updates an active paid Stripe subscription instead of creating a second checkout subscription", async (t) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_textiq";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    const customerCalls: unknown[] = [];
    const sessionCalls: unknown[] = [];
    const retrieved: string[] = [];
    const updates: unknown[][] = [];
    setStripeLoaderForTesting(async () => ({
      customers: {
        async create(args) {
          customerCalls.push(args);
          return { id: "cus_unused" };
        },
      },
      checkout: {
        sessions: {
          async create(args) {
            sessionCalls.push(args);
            return { url: "https://checkout.example.test/unused" };
          },
        },
      },
      subscriptions: {
        async cancel() {},
        async retrieve(id) {
          retrieved.push(id);
          return { id, items: { data: [{ id: "si_existing" }] } };
        },
        async update(id, args) {
          updates.push([id, args]);
        },
      },
      webhooks: {
        constructEvent() {
          throw new Error("not used");
        },
      },
    }));
    t.after(() => setStripeLoaderForTesting(null));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      email: "billing@example.test",
    }));
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => ({
      plan: "plus",
      status: "active",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_active",
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
    }));
    const provider = new StripeBillingProvider();

    const result = await provider.changePlan("user-checkout", "pro");

    assert.equal(result.success, true);
    assert.equal(result.plan, "pro");
    assert.equal(result.redirectUrl, undefined);
    assert.match(result.message, /Plan change to pro submitted/);
    assert.equal(customerCalls.length, 0);
    assert.equal(sessionCalls.length, 0);
    assert.deepEqual(retrieved, ["sub_active"]);
    assert.deepEqual(updates, [
      [
        "sub_active",
        {
          items: [{ id: "si_existing", price: "price_pro", quantity: 1 }],
          proration_behavior: "create_prorations",
          cancel_at_period_end: false,
        },
      ],
    ]);
  });

  it("requires Stripe customer creation to return an id", async (t) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_textiq";
    setStripeLoaderForTesting(async () => ({
      customers: {
        async create() {
          return { id: null };
        },
      },
      checkout: {
        sessions: {
          async create() {
            return {};
          },
        },
      },
      subscriptions: {
        async cancel() {},
        async update() {},
      },
      webhooks: {
        constructEvent() {
          throw new Error("not used");
        },
      },
    }));
    t.after(() => setStripeLoaderForTesting(null));
    stubObjectMethod(t, prisma.user, "findUniqueOrThrow", async () => ({
      email: "billing@example.test",
    }));
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => null);
    const provider = new StripeBillingProvider();

    await assert.rejects(() => provider.changePlan("user-checkout", "plus"), {
      message: "Stripe customer creation did not return an id.",
    });
  });

  it("cancels and schedules stored Stripe subscriptions through the SDK", async (t) => {
    const cancelled: string[] = [];
    const updates: unknown[][] = [];
    setStripeLoaderForTesting(async () => ({
      customers: {
        async create() {
          return { id: "cus_unused" };
        },
      },
      checkout: {
        sessions: {
          async create() {
            return {};
          },
        },
      },
      subscriptions: {
        async cancel(id) {
          cancelled.push(id);
        },
        async update(id, args) {
          updates.push([id, args]);
        },
      },
      webhooks: {
        constructEvent() {
          throw new Error("not used");
        },
      },
    }));
    t.after(() => setStripeLoaderForTesting(null));
    stubObjectMethod(t, prisma.subscription, "findUnique", async () => ({
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_active",
      currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
    }));
    const markCancel = stubObjectMethod(
      t,
      prisma.subscription,
      "update",
      async () => ({}),
    );
    const provider = new StripeBillingProvider();

    await provider.cancelSubscriptionImmediately("user-paid");
    const result = await provider.cancelSubscription("user-paid");

    assert.deepEqual(cancelled, ["sub_active"]);
    assert.deepEqual(updates, [["sub_active", { cancel_at_period_end: true }]]);
    assert.equal(markCancel.calls.length, 1);
    assert.equal(result.plan, "pro");
  });
});

describe("reduceStripeSubscriptionEvent — updated", () => {
  it("maps an active update with plan, period window, and no cancellation", () => {
    const start = 1_700_000_000;
    const end = start + 30 * 24 * 60 * 60;
    const sub: StripeSubscriptionLike = {
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_start: start,
      current_period_end: end,
      items: { data: [{ price: { id: "price_pro" } }] },
    };
    const state = reduceStripeSubscriptionEvent(
      "customer.subscription.updated",
      sub,
      ENV,
    );
    assert.strictEqual(state.status, "active");
    assert.strictEqual(state.plan, "pro");
    assert.strictEqual(state.cancelAtPeriodEnd, false);
    assert.deepStrictEqual(state.currentPeriodStart, new Date(start * 1000));
    assert.deepStrictEqual(state.currentPeriodEnd, new Date(end * 1000));
  });

  it("captures a scheduled cancellation (cancel_at_period_end)", () => {
    const sub: StripeSubscriptionLike = {
      id: "sub_1",
      status: "active",
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_plus" } }] },
    };
    const state = reduceStripeSubscriptionEvent(
      "customer.subscription.updated",
      sub,
      ENV,
    );
    assert.strictEqual(state.status, "active");
    assert.strictEqual(state.plan, "plus");
    assert.strictEqual(state.cancelAtPeriodEnd, true);
  });

  it("maps a past_due update", () => {
    const sub: StripeSubscriptionLike = {
      id: "sub_1",
      status: "past_due",
      cancel_at_period_end: false,
    };
    const state = reduceStripeSubscriptionEvent(
      "customer.subscription.updated",
      sub,
      ENV,
    );
    assert.strictEqual(state.status, "past_due");
    assert.strictEqual(state.plan, undefined);
  });
});

describe("reduceStripeSubscriptionEvent — deleted", () => {
  it("always resolves to cancelled + free, regardless of stripe payload", () => {
    const sub: StripeSubscriptionLike = {
      id: "sub_1",
      status: "active",
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_pro" } }] },
    };
    const state = reduceStripeSubscriptionEvent(
      "customer.subscription.deleted",
      sub,
      ENV,
    );
    assert.strictEqual(state.status, "cancelled");
    assert.strictEqual(state.plan, "free");
    assert.strictEqual(state.cancelAtPeriodEnd, false);
  });
});

describe("shouldApplySubscriptionUpdate — ordering guard", () => {
  const older = new Date("2026-06-01T00:00:00.000Z");
  const newer = new Date("2026-07-01T00:00:00.000Z");

  it("applies when there is no stored period yet", () => {
    assert.strictEqual(shouldApplySubscriptionUpdate(null, newer), true);
    assert.strictEqual(shouldApplySubscriptionUpdate(undefined, older), true);
  });

  function makeWebhookClient(
    options: { failSubscriptionUpsert?: boolean } = {},
  ) {
    const users = new Map([
      [
        "u1",
        {
          id: "u1",
          plan: "free",
          creditBalance: 500,
          creditPeriodStart: null as Date | null,
        },
      ],
    ]);
    const subs = new Map<string, Record<string, unknown>>();
    const events = new Set<string>();
    const client = {
      user: {
        update({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) {
          const user = users.get(where.id);
          if (!user) throw new Error("user not found");
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
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) {
          if (options.failSubscriptionUpsert) {
            throw new Error("subscription write failed");
          }
          const existing = subs.get(where.userId);
          if (existing) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }
          subs.set(where.userId, create);
          return Promise.resolve(create);
        },
        findUnique({ where }: { where: Record<string, string> }) {
          if (where.userId) {
            return Promise.resolve(subs.get(where.userId) ?? null);
          }
          if (where.stripeSubscriptionId) {
            return Promise.resolve(
              Array.from(subs.values()).find(
                (sub) =>
                  sub.stripeSubscriptionId === where.stripeSubscriptionId,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        },
        update({
          where,
          data,
        }: {
          where: Record<string, string>;
          data: Record<string, unknown>;
        }) {
          const existing = where.userId
            ? subs.get(where.userId)
            : Array.from(subs.values()).find(
                (sub) =>
                  sub.stripeSubscriptionId === where.stripeSubscriptionId,
              );
          if (!existing) throw new Error("subscription not found");
          Object.assign(existing, data);
          return Promise.resolve(existing);
        },
      },
      stripeWebhookEvent: {
        create({ data }: { data: { id: string; type: string } }) {
          if (events.has(data.id)) {
            const err = new Error("duplicate") as Error & { code: string };
            err.code = "P2002";
            throw err;
          }
          events.add(data.id);
          return Promise.resolve(data);
        },
      },
      async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
        const userSnapshot = new Map(
          Array.from(users, ([key, value]) => [key, { ...value }]),
        );
        const subSnapshot = new Map(
          Array.from(subs, ([key, value]) => [key, { ...value }]),
        );
        const eventSnapshot = new Set(events);
        try {
          return await fn(client);
        } catch (error) {
          users.clear();
          for (const [key, value] of userSnapshot) users.set(key, value);
          subs.clear();
          for (const [key, value] of subSnapshot) subs.set(key, value);
          events.clear();
          for (const event of eventSnapshot) events.add(event);
          throw error;
        }
      },
      _users: users,
      _subs: subs,
      _events: events,
    };
    return client as unknown as typeof prisma & {
      _users: typeof users;
      _subs: typeof subs;
      _events: typeof events;
    };
  }

  describe("handleStripeWebhookEvent", () => {
    it("fails closed when the webhook secret is missing", async (t) => {
      const previous = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      t.after(() => {
        if (previous === undefined) {
          delete process.env.STRIPE_WEBHOOK_SECRET;
        } else {
          process.env.STRIPE_WEBHOOK_SECRET = previous;
        }
      });

      const result = await handleStripeWebhookEvent("{}", "sig");

      assert.deepEqual(result, {
        status: 500,
        message: "STRIPE_WEBHOOK_SECRET not configured",
      });
    });

    it("returns 400 when Stripe rejects the webhook signature", async (t) => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      setStripeLoaderForTesting(async () => ({
        customers: {
          async create() {
            return { id: "cus_unused" };
          },
        },
        checkout: {
          sessions: {
            async create() {
              return {};
            },
          },
        },
        subscriptions: {
          async cancel() {},
          async update() {},
        },
        webhooks: {
          constructEvent() {
            throw new Error("bad signature");
          },
        },
      }));
      t.after(() => setStripeLoaderForTesting(null));

      const result = await handleStripeWebhookEvent("{}", "sig_bad");

      assert.deepEqual(result, {
        status: 400,
        message: "Webhook signature verification failed",
      });
    });

    it("treats duplicate webhook ids as idempotent success", async (t) => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      const client = makeWebhookClient();
      client._events.add("evt_duplicate");
      stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
        client.$transaction(fn as Parameters<typeof client.$transaction>[0]),
      );
      setStripeLoaderForTesting(async () => ({
        customers: {
          async create() {
            return { id: "cus_unused" };
          },
        },
        checkout: {
          sessions: {
            async create() {
              return {};
            },
          },
        },
        subscriptions: {
          async cancel() {},
          async update() {},
        },
        webhooks: {
          constructEvent() {
            return {
              id: "evt_duplicate",
              type: "invoice.paid",
              data: { object: {} },
            };
          },
        },
      }));
      t.after(() => setStripeLoaderForTesting(null));

      const result = await handleStripeWebhookEvent("{}", "sig_ok");

      assert.deepEqual(result, {
        status: 200,
        message: "duplicate event ignored",
      });
    });

    it("reports stale subscription updates with a dedicated ok message", async (t) => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      const client = makeWebhookClient();
      client._subs.set("u1", {
        userId: "u1",
        plan: "pro",
        status: "active",
        stripeSubscriptionId: "sub_123",
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      });
      stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
        client.$transaction(fn as Parameters<typeof client.$transaction>[0]),
      );
      setStripeLoaderForTesting(async () => ({
        customers: {
          async create() {
            return { id: "cus_unused" };
          },
        },
        checkout: {
          sessions: {
            async create() {
              return {};
            },
          },
        },
        subscriptions: {
          async cancel() {},
          async update() {},
        },
        webhooks: {
          constructEvent() {
            return {
              id: "evt_stale_handled",
              type: "customer.subscription.updated",
              data: {
                object: {
                  id: "sub_123",
                  status: "active",
                  current_period_end: 1_785_456_000,
                },
              },
            };
          },
        },
      }));
      t.after(() => setStripeLoaderForTesting(null));

      const result = await handleStripeWebhookEvent("{}", "sig_ok");

      assert.deepEqual(result, {
        status: 200,
        message: "stale subscription update ignored",
      });
    });

    it("returns ok after applying a valid webhook event", async (t) => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      const client = makeWebhookClient();
      stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
        client.$transaction(fn as Parameters<typeof client.$transaction>[0]),
      );
      setStripeLoaderForTesting(async () => ({
        customers: {
          async create() {
            return { id: "cus_unused" };
          },
        },
        checkout: {
          sessions: {
            async create() {
              return {};
            },
          },
        },
        subscriptions: {
          async cancel() {},
          async update() {},
        },
        webhooks: {
          constructEvent() {
            return {
              id: "evt_ok_handled",
              type: "invoice.paid",
              data: { object: {} },
            };
          },
        },
      }));
      t.after(() => setStripeLoaderForTesting(null));

      const result = await handleStripeWebhookEvent("{}", "sig_ok");

      assert.deepEqual(result, { status: 200, message: "ok" });
    });
  });

  describe("applyStripeWebhookEvent — idempotency and atomic writes", () => {
    const checkoutEvent = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { userId: "u1", plan: "pro" },
          subscription: "sub_123",
          customer: "cus_123",
        },
      },
    };

    it("records the event and plan/subscription update atomically", async () => {
      const client = makeWebhookClient();

      const outcome = await applyStripeWebhookEvent(client, checkoutEvent);

      assert.equal(outcome, "success");
      assert.equal(client._events.has("evt_1"), true);
      assert.equal(client._users.get("u1")?.plan, "pro");
      assert.equal(client._subs.get("u1")?.stripeSubscriptionId, "sub_123");
    });

    it("skips stale checkout completion after a newer subscription update", async () => {
      const client = makeWebhookClient();
      const existingPeriodStart = new Date("2099-01-01T00:00:00.000Z");
      const existingPeriodEnd = new Date("2099-02-01T00:00:00.000Z");
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
        updatedAt: new Date("2099-01-01T00:05:00.000Z"),
      });

      const outcome = await applyStripeWebhookEvent(client, {
        ...checkoutEvent,
        id: "evt_checkout_stale",
        created: 4_071_849_600,
      });

      assert.equal(outcome, "stale");
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

    it("rolls back the idempotency row and user plan when subscription persistence fails", async () => {
      const client = makeWebhookClient({ failSubscriptionUpsert: true });

      await assert.rejects(() =>
        applyStripeWebhookEvent(client, checkoutEvent),
      );

      assert.equal(client._events.has("evt_1"), false);
      assert.equal(client._users.get("u1")?.plan, "free");
      assert.equal(client._subs.size, 0);
    });

    it("rejects duplicate event ids before reapplying state", async () => {
      const client = makeWebhookClient();

      await applyStripeWebhookEvent(client, checkoutEvent);
      await assert.rejects(
        () => applyStripeWebhookEvent(client, checkoutEvent),
        { name: "DuplicateStripeWebhookEventError" },
      );

      assert.equal(client._subs.size, 1);
    });

    it("applies subscription updates to an existing Stripe subscription", async () => {
      const client = makeWebhookClient();
      client._subs.set("u1", {
        userId: "u1",
        plan: "plus",
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
      });

      const outcome = await applyStripeWebhookEvent(client, {
        id: "evt_update",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "past_due",
            cancel_at_period_end: true,
            current_period_start: 1_782_864_000,
            current_period_end: 1_785_456_000,
            items: { data: [{ price: { id: "price_pro" } }] },
          },
        },
      });

      const sub = client._subs.get("u1");
      assert.equal(outcome, "success");
      assert.equal(client._users.get("u1")?.plan, "pro");
      assert.equal(client._users.get("u1")?.creditBalance, 30_000);
      assert.deepEqual(
        client._users.get("u1")?.creditPeriodStart,
        new Date("2026-07-01T00:00:00.000Z"),
      );
      assert.equal(sub?.status, "past_due");
      assert.equal(sub?.plan, "pro");
      assert.equal(sub?.cancelAtPeriodEnd, true);
    });

    it("returns stale for an older subscription update", async () => {
      const client = makeWebhookClient();
      client._subs.set("u1", {
        userId: "u1",
        plan: "pro",
        status: "active",
        stripeSubscriptionId: "sub_123",
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      });

      const outcome = await applyStripeWebhookEvent(client, {
        id: "evt_stale",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_123",
            status: "active",
            current_period_end: 1_785_456_000,
          },
        },
      });

      assert.equal(outcome, "stale");
      assert.deepEqual(
        client._subs.get("u1")?.currentPeriodEnd,
        new Date("2026-08-01T00:00:00.000Z"),
      );
    });

    it("rolls back idempotency when an update arrives before its subscription row", async () => {
      const client = makeWebhookClient();

      assert.equal(
        await applyStripeWebhookEvent(client, {
          id: "evt_update_missing_id",
          type: "customer.subscription.updated",
          data: { object: { status: "active" } },
        }),
        "ignored",
      );
      await assert.rejects(
        () =>
          applyStripeWebhookEvent(client, {
            id: "evt_update_missing_row",
            type: "customer.subscription.updated",
            data: { object: { id: "sub_missing", status: "active" } },
          }),
        { name: "MissingStripeSubscriptionWebhookEventError" },
      );
      assert.equal(client._events.has("evt_update_missing_row"), false);
    });

    it("returns retryable failure for out-of-order subscription updates", async (t) => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
      const client = makeWebhookClient();
      stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
        client.$transaction(fn as Parameters<typeof client.$transaction>[0]),
      );
      setStripeLoaderForTesting(async () => ({
        customers: {
          async create() {
            return { id: "cus_unused" };
          },
        },
        checkout: {
          sessions: {
            async create() {
              return {};
            },
          },
        },
        subscriptions: {
          async cancel() {},
          async update() {},
        },
        webhooks: {
          constructEvent() {
            return {
              id: "evt_update_missing_row",
              type: "customer.subscription.updated",
              data: { object: { id: "sub_missing", status: "active" } },
            };
          },
        },
      }));
      t.after(() => setStripeLoaderForTesting(null));

      const result = await handleStripeWebhookEvent("{}", "sig_ok");

      assert.deepEqual(result, {
        status: 500,
        message: "subscription state missing; retry later",
      });
      assert.equal(client._events.has("evt_update_missing_row"), false);
    });

    it("returns missing for subscription deletions that cannot target a row", async () => {
      const client = makeWebhookClient();

      assert.equal(
        await applyStripeWebhookEvent(client, {
          id: "evt_update_missing_row",
          type: "customer.subscription.deleted",
          data: { object: { id: "sub_missing", status: "active" } },
        }),
        "missing",
      );
    });

    it("downgrades to free for subscription deletions and ignores unknown event types", async () => {
      const client = makeWebhookClient();
      client._subs.set("u1", {
        userId: "u1",
        plan: "pro",
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
      });

      const deleted = await applyStripeWebhookEvent(client, {
        id: "evt_deleted",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_123" } },
      });
      const ignored = await applyStripeWebhookEvent(client, {
        id: "evt_ignored",
        type: "invoice.paid",
        data: { object: {} },
      });

      assert.equal(deleted, "success");
      assert.equal(ignored, "ignored");
      assert.equal(client._users.get("u1")?.plan, "free");
      assert.equal(client._subs.get("u1")?.status, "cancelled");
    });
  });

  it("applies a newer incoming period", () => {
    assert.strictEqual(shouldApplySubscriptionUpdate(older, newer), true);
  });

  it("applies an equal incoming period (idempotent retry of same state)", () => {
    assert.strictEqual(shouldApplySubscriptionUpdate(newer, newer), true);
  });

  it("ignores an older incoming period (out-of-order redelivery)", () => {
    assert.strictEqual(shouldApplySubscriptionUpdate(newer, older), false);
  });

  it("ignores an update with no incoming period when one is stored", () => {
    assert.strictEqual(shouldApplySubscriptionUpdate(newer, null), false);
    assert.strictEqual(shouldApplySubscriptionUpdate(newer, undefined), false);
  });
});
