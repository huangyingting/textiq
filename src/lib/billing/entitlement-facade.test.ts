import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  assertFeatureAllowed,
  createEntitlementFacade,
  EntitlementGateError,
  getUpgradeMessage,
  resolveUserEntitlements,
} from "@/lib/billing/entitlement-facade";

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
) {
  const original = object[methodName];
  Object.defineProperty(object, methodName, {
    value: implementation,
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      value: original,
      configurable: true,
    });
  });
}

describe("createEntitlementFacade", () => {
  it("allows Plus export features and exposes upgrade copy", () => {
    const facade = createEntitlementFacade("plus");

    assert.equal(facade.plan, "plus");
    assert.equal(facade.can("svgExport"), true);
    assert.equal(facade.decide("fontUpload").allowed, false);
    assert.match(facade.upgradeMessage("fontUpload"), /Pro plan/);
  });

  it("falls back to free entitlements for missing or unknown plans", () => {
    assert.equal(createEntitlementFacade(null).can("pptxExport"), false);
    assert.equal(createEntitlementFacade("enterprise").plan, "free");
    assert.match(getUpgradeMessage("removeWatermark"), /Watermark removal/);
  });
});

describe("assertFeatureAllowed", () => {
  it("throws an EntitlementGateError with feature metadata when blocked", () => {
    const facade = createEntitlementFacade("free");

    assert.throws(
      () => assertFeatureAllowed(facade, "brandStyles"),
      (error: unknown) => {
        assert.ok(error instanceof EntitlementGateError);
        assert.equal(error.status, 403);
        assert.equal(error.feature, "brandStyles");
        assert.match(error.message, /Brand Studio/);
        return true;
      },
    );
  });

  it("does not throw when the facade allows the feature", () => {
    const facade = createEntitlementFacade("pro");

    assert.doesNotThrow(() => assertFeatureAllowed(facade, "fontUpload"));
  });
});

describe("resolveUserEntitlements", () => {
  it("loads the user's plan and returns a facade", async (t) => {
    stubPrismaMethod(t, prisma.user, "findUnique", async () => ({
      plan: "pro",
    }));

    const facade = await resolveUserEntitlements("user-entitlements");

    assert.equal(facade.plan, "pro");
    assert.equal(facade.can("fontUpload"), true);
  });

  it("uses free entitlements when the user row is missing", async (t) => {
    stubPrismaMethod(t, prisma.user, "findUnique", async () => null);

    const facade = await resolveUserEntitlements("user-missing");

    assert.equal(facade.plan, "free");
    assert.equal(facade.can("pptxExport"), false);
  });
});
