/**
 * Unit tests for the billing entitlements map (US-010 epic).
 *
 * Tests are pure — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_CATALOG,
  PLAN_ENTITLEMENTS,
  PLAN_NAMES,
  getPlanCatalogEntry,
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

describe("PLAN_CATALOG", () => {
  it("each entry's plan field matches its record key and has a non-empty displayName", () => {
    const plans: Plan[] = ["free", "plus", "pro"];
    for (const key of plans) {
      assert.strictEqual(
        PLAN_CATALOG[key].plan,
        key,
        `PLAN_CATALOG.${key}.plan should equal '${key}'`,
      );
      assert.ok(
        PLAN_CATALOG[key].displayName.length > 0,
        `PLAN_CATALOG.${key}.displayName should not be empty`,
      );
    }
  });

  it("every entry's entitlements are reference-identical to PLAN_ENTITLEMENTS", () => {
    const plans: Plan[] = ["free", "plus", "pro"];
    for (const key of plans) {
      assert.strictEqual(
        PLAN_CATALOG[key].entitlements,
        PLAN_ENTITLEMENTS[key],
        `PLAN_CATALOG.${key}.entitlements should be the same object as PLAN_ENTITLEMENTS.${key}`,
      );
    }
  });
});

describe("PLAN_NAMES", () => {
  it("exposes the expected display names for all three tiers", () => {
    assert.strictEqual(PLAN_NAMES.free, "Free");
    assert.strictEqual(PLAN_NAMES.plus, "Plus");
    assert.strictEqual(PLAN_NAMES.pro, "Pro");
  });
});

describe("getPlanCatalogEntry", () => {
  it("returns the catalog entry for each valid plan with a matching plan field", () => {
    for (const plan of ["free", "plus", "pro"] as Plan[]) {
      const entry = getPlanCatalogEntry(plan);
      assert.strictEqual(entry.plan, plan);
      assert.deepStrictEqual(entry.entitlements, PLAN_ENTITLEMENTS[plan]);
    }
  });

  it("falls back to the free entry for an unknown string", () => {
    const entry = getPlanCatalogEntry("legacy");
    assert.strictEqual(entry.plan, "free");
    assert.deepStrictEqual(entry.entitlements, PLAN_ENTITLEMENTS.free);
  });

  it("falls back to the free entry for null", () => {
    assert.strictEqual(getPlanCatalogEntry(null).plan, "free");
  });

  it("falls back to the free entry for undefined", () => {
    assert.strictEqual(getPlanCatalogEntry(undefined).plan, "free");
  });
});

describe("decideEntitlement full feature matrix", () => {
  type Feature = Parameters<typeof decideEntitlement>[1];

  // All boolean features derived from PlanEntitlements
  const BOOLEAN_FEATURES: Feature[] = [
    "svgExport",
    "pptxExport",
    "brandStyles",
    "removeWatermark",
    "fontUpload",
  ];

  it("free plan: all boolean features are denied with upgrade_required", () => {
    for (const feature of BOOLEAN_FEATURES) {
      const d = decideEntitlement("free", feature);
      assert.strictEqual(d.allowed, false, `free/${feature} should be denied`);
      assert.strictEqual(d.plan, "free");
      assert.strictEqual(d.reason, "upgrade_required");
      assert.strictEqual(d.feature, feature);
    }
  });

  it("plus plan: all features allowed except fontUpload", () => {
    for (const feature of BOOLEAN_FEATURES) {
      const expected = feature !== "fontUpload";
      const d = decideEntitlement("plus", feature);
      assert.strictEqual(
        d.allowed,
        expected,
        `plus/${feature} expected allowed=${String(expected)}`,
      );
      assert.strictEqual(d.plan, "plus");
      assert.strictEqual(d.reason, expected ? "included" : "upgrade_required");
      assert.strictEqual(d.feature, feature);
    }
  });

  it("pro plan: all boolean features are allowed with reason included", () => {
    for (const feature of BOOLEAN_FEATURES) {
      const d = decideEntitlement("pro", feature);
      assert.strictEqual(d.allowed, true, `pro/${feature} should be allowed`);
      assert.strictEqual(d.plan, "pro");
      assert.strictEqual(d.reason, "included");
      assert.strictEqual(d.feature, feature);
    }
  });

  it("null plan falls back to free and denies every feature", () => {
    for (const feature of BOOLEAN_FEATURES) {
      const d = decideEntitlement(null, feature);
      assert.strictEqual(
        d.plan,
        "free",
        `null/${feature}: plan should be free`,
      );
      assert.strictEqual(d.allowed, false, `null/${feature} should be denied`);
      assert.strictEqual(d.reason, "upgrade_required");
    }
  });

  it("undefined plan falls back to free and denies every feature", () => {
    for (const feature of BOOLEAN_FEATURES) {
      const d = decideEntitlement(undefined, feature);
      assert.strictEqual(
        d.plan,
        "free",
        `undefined/${feature}: plan should be free`,
      );
      assert.strictEqual(
        d.allowed,
        false,
        `undefined/${feature} should be denied`,
      );
    }
  });
});
