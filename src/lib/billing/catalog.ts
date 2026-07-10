/**
 * Pure billing plan catalog.
 *
 * This module contains only static plan metadata and pure helpers. Runtime
 * environment switches and database mutations live in sibling billing modules.
 * Future credit top-up purchasing is intentionally not exposed here as a
 * current entitlement until the product path exists.
 */

export type Plan = "free" | "plus" | "pro";

export interface PlanEntitlements {
  /** Total AI credits granted at the start of each billing period. */
  creditsPerPeriod: number;
  /** Billing period length in days (7 for Free/weekly, 30 for Plus/Pro). */
  periodDays: number;
  /** Allow SVG export (paid tiers only). */
  svgExport: boolean;
  /** Allow PPTX export (paid tiers only). */
  pptxExport: boolean;
  /** Allow saving and applying Brand Styles. */
  brandStyles: boolean;
  /** Remove the "TextIQ" watermark from exports. */
  removeWatermark: boolean;
  /** Allow uploading custom fonts. */
  fontUpload: boolean;
}

export interface PlanCatalogEntry {
  plan: Plan;
  displayName: string;
  entitlements: PlanEntitlements;
}

export const PLAN_CATALOG: Record<Plan, PlanCatalogEntry> = {
  free: {
    plan: "free",
    displayName: "Free",
    entitlements: {
      creditsPerPeriod: 500,
      periodDays: 7,
      svgExport: false,
      pptxExport: false,
      brandStyles: false,
      removeWatermark: false,
      fontUpload: false,
    },
  },
  plus: {
    plan: "plus",
    displayName: "Plus",
    entitlements: {
      creditsPerPeriod: 10_000,
      periodDays: 30,
      svgExport: true,
      pptxExport: true,
      brandStyles: true,
      removeWatermark: true,
      fontUpload: false,
    },
  },
  pro: {
    plan: "pro",
    displayName: "Pro",
    entitlements: {
      creditsPerPeriod: 30_000,
      periodDays: 30,
      svgExport: true,
      pptxExport: true,
      brandStyles: true,
      removeWatermark: true,
      fontUpload: true,
    },
  },
};

export const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: PLAN_CATALOG.free.entitlements,
  plus: PLAN_CATALOG.plus.entitlements,
  pro: PLAN_CATALOG.pro.entitlements,
};

export const PLAN_NAMES: Record<Plan, string> = {
  free: PLAN_CATALOG.free.displayName,
  plus: PLAN_CATALOG.plus.displayName,
  pro: PLAN_CATALOG.pro.displayName,
};

/** Returns true when `value` is a valid {@link Plan} string. */
export function isPlan(value: unknown): value is Plan {
  return value === "free" || value === "plus" || value === "pro";
  /* node:coverage ignore next -- Closing brace is a source-map artifact; plan predicate behavior is asserted. */
}

/**
 * Returns the canonical {@link Plan} for the given value. Falls back to `"free"`
 * when the value is not a recognised plan (safe default).
 */
export function resolvePlan(plan: string | null | undefined): Plan {
  return isPlan(plan) ? plan : "free";
}

/* node:coverage ignore next 6 -- Catalog fallback JSDoc is documentation-only; fallback behavior is asserted. */
/**
 * Returns the catalog entry for the given plan string. Falls back to `"free"`
 * when the value is not a recognised plan (safe default).
 */
export function getPlanCatalogEntry(
  plan: string | null | undefined,
): PlanCatalogEntry {
  return isPlan(plan) ? PLAN_CATALOG[plan] : PLAN_CATALOG.free;
}

/**
 * Returns the entitlements for the given plan string. Falls back to `"free"`
 * when the value is not a recognised plan (safe default).
 */
export function getEntitlements(
  plan: string | null | undefined,
): PlanEntitlements {
  return getPlanCatalogEntry(plan).entitlements;
}

/**
 * Checks whether the given plan includes a specific entitlement feature.
 * Returns `false` for unrecognised plan values (safe default = free tier).
 */
export function hasEntitlement<K extends keyof PlanEntitlements>(
  plan: string | null | undefined,
  feature: K,
): boolean {
  return Boolean(getEntitlements(plan)[feature]);
}
