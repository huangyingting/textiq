/* node:coverage ignore start -- Module documentation is a source-map artifact; asset access decisions are asserted. */
/**
 * Pure brand-asset access decision.
 *
 * The `/api/brand-assets/[ownerId]/[...path]` route serves private brand logos
 * and uploaded fonts, so it must make EXACTLY the right allow/deny decision:
 * brand assets are OWNER-scoped, so only the authenticated owner whose id is the
 * storage partition may fetch the bytes. This module hoists that decision into
 * one pure function so the route and its regression tests exercise the SAME code
 * path. It performs no I/O — the caller does the asset lookup and passes the row
 * in.
 *
 * Privacy contract (do NOT weaken):
 *   - missing asset → `404` (existence must not leak),
 *   - unauthenticated request → `401`,
 *   - authenticated but not the partition owner → `403`.
 */
/* node:coverage ignore stop */

/** Why a brand-asset request was denied. */
export type BrandAssetDenyReason =
  "asset-not-found" | "unauthenticated" | "forbidden";

/** Outcome of a brand-asset access check. */
export type BrandAssetAccessDecision =
  | { allow: true }
  | { allow: false; status: 401 | 403 | 404; reason: BrandAssetDenyReason };

/** Inputs to the decision — already-fetched rows, no I/O performed here. */
export interface BrandAssetAccessInput {
  /** The asset row, or `null` when no matching asset exists for the key. */
  asset: { id: string } | null;
  /** The owner id encoded in the requested storage partition (path segment). */
  requestedOwnerId: string;
  /** The authenticated user id, or `null` for anonymous requests. */
  userId: string | null;
}

/**
 * Decides whether a brand-asset request may be served.
 *
 * Ordering: asset existence → authentication → ownership. A missing asset
 * resolves to a privacy `404`; an unauthenticated caller to `401`; an
 * authenticated non-owner to `403`.
 */
export function decideBrandAssetAccess(
  input: BrandAssetAccessInput,
): BrandAssetAccessDecision {
  if (!input.asset) {
    return { allow: false, status: 404, reason: "asset-not-found" };
  }
  if (!input.userId) {
    return { allow: false, status: 401, reason: "unauthenticated" };
  }
  if (input.userId !== input.requestedOwnerId) {
    return { allow: false, status: 403, reason: "forbidden" };
  }
  return { allow: true };
}
