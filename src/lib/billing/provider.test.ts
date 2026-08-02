/**
 * Unit tests for billing provider selection.
 *
 * Pure decision functions — no DB, no network. Verifies the production
 * fail-closed behaviour (criterion 2) and the mock-provider paid-plan guard
 * (criterion 3).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decideBillingProvider,
  getBillingProvider,
  isE2EProfileMockBillingAllowed,
  isProductionEnv,
  shouldCancelSubscription,
  BillingMisconfiguredError,
} from "@/lib/billing/provider";
import { MockBillingProvider } from "@/lib/billing/mock-provider";
import { isMockPlanChangeAllowed } from "@/lib/billing/mock-provider";

describe("isProductionEnv", () => {
  it("is true only when NODE_ENV === 'production'", () => {
    assert.strictEqual(isProductionEnv({ NODE_ENV: "production" }), true);
    assert.strictEqual(isProductionEnv({ NODE_ENV: "development" }), false);
    assert.strictEqual(isProductionEnv({ NODE_ENV: "test" }), false);
    assert.strictEqual(isProductionEnv({}), false);
  });
});

describe("decideBillingProvider", () => {
  it("selects stripe when STRIPE_SECRET_KEY is set", () => {
    assert.strictEqual(
      decideBillingProvider({ STRIPE_SECRET_KEY: "sk_test_123" }),
      "stripe",
    );
    assert.strictEqual(
      decideBillingProvider({
        STRIPE_SECRET_KEY: "sk_live_123",
        NODE_ENV: "production",
      }),
      "stripe",
    );
  });

  it("falls back to mock in non-production when Stripe is unconfigured", () => {
    assert.strictEqual(decideBillingProvider({}), "mock");
    assert.strictEqual(
      decideBillingProvider({ NODE_ENV: "development" }),
      "mock",
    );
    assert.strictEqual(decideBillingProvider({ NODE_ENV: "test" }), "mock");
  });

  it("FAILS CLOSED in production when Stripe is unconfigured", () => {
    assert.throws(
      () => decideBillingProvider({ NODE_ENV: "production" }),
      BillingMisconfiguredError,
    );
  });

  it("allows only the explicit SQLite production profile to use mock billing", () => {
    const profileEnv = {
      NODE_ENV: "production",
      E2E_PROFILE: "1",
      E2E_PROFILE_MOCK_BILLING: "1",
      DB_PROVIDER: "sqlite",
      DATABASE_URL: "file:/tmp/textiq-e2e.db",
    };
    assert.strictEqual(isE2EProfileMockBillingAllowed(profileEnv), true);
    assert.strictEqual(decideBillingProvider(profileEnv), "mock");

    for (const key of [
      "E2E_PROFILE",
      "E2E_PROFILE_MOCK_BILLING",
      "DB_PROVIDER",
      "DATABASE_URL",
    ] as const) {
      const incomplete: Record<string, string | undefined> = { ...profileEnv };
      delete incomplete[key];
      assert.strictEqual(isE2EProfileMockBillingAllowed(incomplete), false);
      assert.throws(
        () => decideBillingProvider(incomplete),
        BillingMisconfiguredError,
      );
    }
  });
});

describe("isMockPlanChangeAllowed", () => {
  it("always allows downgrade to free", () => {
    assert.strictEqual(
      isMockPlanChangeAllowed("free", { NODE_ENV: "production" }),
      true,
    );
    assert.strictEqual(
      isMockPlanChangeAllowed("free", { NODE_ENV: "development" }),
      true,
    );
  });

  it("allows paid plans in non-production", () => {
    assert.strictEqual(
      isMockPlanChangeAllowed("plus", { NODE_ENV: "development" }),
      true,
    );
    assert.strictEqual(
      isMockPlanChangeAllowed("pro", { NODE_ENV: "test" }),
      true,
    );
  });

  it("refuses paid plans in production (mock cannot take payment)", () => {
    assert.strictEqual(
      isMockPlanChangeAllowed("plus", { NODE_ENV: "production" }),
      false,
    );
    assert.strictEqual(
      isMockPlanChangeAllowed("pro", { NODE_ENV: "production" }),
      false,
    );
  });

  it("allows paid plans only in the explicit SQLite production profile", () => {
    assert.strictEqual(
      isMockPlanChangeAllowed("plus", {
        NODE_ENV: "production",
        E2E_PROFILE: "1",
        E2E_PROFILE_MOCK_BILLING: "1",
        DB_PROVIDER: "sqlite",
        DATABASE_URL: "file:/tmp/textiq-e2e.db",
      }),
      true,
    );
  });
});

describe("shouldCancelSubscription", () => {
  it("returns false for null/undefined subscription", () => {
    assert.strictEqual(shouldCancelSubscription(null), false);
    assert.strictEqual(shouldCancelSubscription(undefined), false);
  });

  it("returns false when stripeSubscriptionId is absent", () => {
    assert.strictEqual(
      shouldCancelSubscription({
        stripeSubscriptionId: null,
        status: "active",
      }),
      false,
    );
    assert.strictEqual(
      shouldCancelSubscription({ stripeSubscriptionId: "", status: "active" }),
      false,
    );
  });

  it("returns true for active subscription with a stripeSubscriptionId", () => {
    assert.strictEqual(
      shouldCancelSubscription({
        stripeSubscriptionId: "sub_123",
        status: "active",
      }),
      true,
    );
  });

  it("returns true for past_due subscription with a stripeSubscriptionId", () => {
    assert.strictEqual(
      shouldCancelSubscription({
        stripeSubscriptionId: "sub_123",
        status: "past_due",
      }),
      true,
    );
  });

  it("returns false for already-cancelled subscription", () => {
    assert.strictEqual(
      shouldCancelSubscription({
        stripeSubscriptionId: "sub_123",
        status: "cancelled",
      }),
      false,
    );
  });

  it("returns true for inactive subscription with a stripeSubscriptionId", () => {
    assert.strictEqual(
      shouldCancelSubscription({
        stripeSubscriptionId: "sub_123",
        status: "inactive",
      }),
      true,
    );
  });
});

describe("getBillingProvider", () => {
  it("returns the mock provider in non-production without Stripe", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousStripeKey = process.env.STRIPE_SECRET_KEY;
    env.NODE_ENV = "test";
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const provider = await getBillingProvider();
      assert.ok(provider instanceof MockBillingProvider);
      assert.strictEqual(await getBillingProvider(), provider);
    } finally {
      if (previousNodeEnv === undefined) {
        delete env.NODE_ENV;
      } else {
        env.NODE_ENV = previousNodeEnv;
      }
      if (previousStripeKey === undefined) {
        delete process.env.STRIPE_SECRET_KEY;
      } else {
        process.env.STRIPE_SECRET_KEY = previousStripeKey;
      }
    }
  });
});
