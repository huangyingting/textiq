/**
 * Unit tests for the billing entitlements map (US-010 epic).
 *
 * Tests are pure — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_ENTITLEMENTS,
  getEntitlements,
  isPlan,
  resolvePlan,
  type Plan,
} from "@/lib/billing/catalog";
import {
  isUnlimitedCreditsEnabled,
  parseBillingFlag,
  BILLING_UNLIMITED_CREDITS_ENV,
} from "@/lib/billing/config";
import { decideEntitlement } from "@/lib/billing/entitlement-decision";

describe("PLAN_ENTITLEMENTS", () => {
  it("defines all three tiers", () => {
    const tiers: Plan[] = ["free", "plus", "pro"];
    for (const tier of tiers) {
      assert.ok(PLAN_ENTITLEMENTS[tier], `missing tier: ${tier}`);
    }
  });

  it("free tier: 500 credits, 7-day period, no paid features", () => {
    const e = PLAN_ENTITLEMENTS.free;
    assert.strictEqual(e.creditsPerPeriod, 500);
    assert.strictEqual(e.periodDays, 7);
    assert.strictEqual(e.svgExport, false);
    assert.strictEqual(e.pptxExport, false);
    assert.strictEqual(e.brandStyles, false);
    assert.strictEqual(e.removeWatermark, false);
    assert.strictEqual(e.fontUpload, false);
  });

  it("plus tier: 10 000 credits, 30-day period, svg/pptx/brand/no-watermark", () => {
    const e = PLAN_ENTITLEMENTS.plus;
    assert.strictEqual(e.creditsPerPeriod, 10_000);
    assert.strictEqual(e.periodDays, 30);
    assert.strictEqual(e.svgExport, true);
    assert.strictEqual(e.pptxExport, true);
    assert.strictEqual(e.brandStyles, true);
    assert.strictEqual(e.removeWatermark, true);
    assert.strictEqual(e.fontUpload, false);
  });

  it("pro tier: 30 000 credits, 30-day period, all features", () => {
    const e = PLAN_ENTITLEMENTS.pro;
    assert.strictEqual(e.creditsPerPeriod, 30_000);
    assert.strictEqual(e.periodDays, 30);
    assert.strictEqual(e.svgExport, true);
    assert.strictEqual(e.pptxExport, true);
    assert.strictEqual(e.brandStyles, true);
    assert.strictEqual(e.removeWatermark, true);
    assert.strictEqual(e.fontUpload, true);
  });

  it("does not expose future top-up purchasing as a current entitlement", () => {
    for (const e of Object.values(PLAN_ENTITLEMENTS)) {
      assert.equal("topUps" in e, false);
    }
  });
});

describe("resolvePlan", () => {
  it("returns valid plan strings unchanged and falls back unknown/null to free", () => {
    assert.equal(resolvePlan("plus"), "plus");
    assert.equal(resolvePlan("legacy-enterprise"), "free");
    assert.equal(resolvePlan(null), "free");
  });
});

describe("isPlan", () => {
  it("accepts valid plan strings", () => {
    assert.strictEqual(isPlan("free"), true);
    assert.strictEqual(isPlan("plus"), true);
    assert.strictEqual(isPlan("pro"), true);
  });

  it("rejects invalid values", () => {
    assert.strictEqual(isPlan("starter"), false);
    assert.strictEqual(isPlan(""), false);
    assert.strictEqual(isPlan(null), false);
    assert.strictEqual(isPlan(undefined), false);
    assert.strictEqual(isPlan(42), false);
  });
});

describe("getEntitlements", () => {
  it("returns correct entitlements for each plan", () => {
    assert.strictEqual(getEntitlements("free").creditsPerPeriod, 500);
    assert.strictEqual(getEntitlements("plus").creditsPerPeriod, 10_000);
    assert.strictEqual(getEntitlements("pro").creditsPerPeriod, 30_000);
  });

  it("falls back to free tier for unknown plans", () => {
    assert.deepStrictEqual(
      getEntitlements("enterprise"),
      PLAN_ENTITLEMENTS.free,
    );
    assert.deepStrictEqual(getEntitlements(null), PLAN_ENTITLEMENTS.free);
    assert.deepStrictEqual(getEntitlements(undefined), PLAN_ENTITLEMENTS.free);
  });
});

describe("decideEntitlement", () => {
  it("returns a single typed decision shape for allowed gates", () => {
    assert.deepStrictEqual(decideEntitlement("pro", "fontUpload"), {
      allowed: true,
      feature: "fontUpload",
      plan: "pro",
      reason: "included",
    });
  });

  it("safe-defaults unknown plans to free and denies paid gates", () => {
    assert.deepStrictEqual(decideEntitlement("enterprise", "pptxExport"), {
      allowed: false,
      feature: "pptxExport",
      plan: "free",
      reason: "upgrade_required",
    });
  });
});

describe("parseBillingFlag", () => {
  it("treats 1/true/yes/on (any case) as true", () => {
    for (const v of ["1", "true", "TRUE", "Yes", "on", "  on  "]) {
      assert.strictEqual(parseBillingFlag(v), true, `expected true for ${v}`);
    }
  });

  it("treats everything else as false", () => {
    for (const v of ["0", "false", "no", "off", "", "maybe", undefined, null]) {
      assert.strictEqual(
        parseBillingFlag(v),
        false,
        `expected false for ${String(v)}`,
      );
    }
  });
});

describe("isUnlimitedCreditsEnabled", () => {
  it("defaults to false (production-safe) when the flag is unset", () => {
    assert.strictEqual(isUnlimitedCreditsEnabled({}), false);
  });

  it("is enabled only when the env flag is explicitly truthy", () => {
    assert.strictEqual(
      isUnlimitedCreditsEnabled({ [BILLING_UNLIMITED_CREDITS_ENV]: "true" }),
      true,
    );
    assert.strictEqual(
      isUnlimitedCreditsEnabled({ [BILLING_UNLIMITED_CREDITS_ENV]: "1" }),
      true,
    );
    assert.strictEqual(
      isUnlimitedCreditsEnabled({ [BILLING_UNLIMITED_CREDITS_ENV]: "false" }),
      false,
    );
  });

  it("is NOT unlimited by default in production", () => {
    assert.strictEqual(
      isUnlimitedCreditsEnabled({ NODE_ENV: "production" }),
      false,
    );
  });
});
