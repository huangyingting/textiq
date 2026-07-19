/**
 * Pure slide-asset access decision (Epic #495, issue #510; Epic #374 / #395).
 *
 * The `/api/slide-assets/[documentId]/[...path]` route serves private slide
 * assets, so it must make EXACTLY the right allow/deny decision: serve only to
 * users with document view capability, or anonymously when the owning document
 * is publicly shared with a valid present/embed link — and otherwise refuse
 * without leaking whether a private asset exists. That decision combines two
 * existing pure helpers (`documentCapabilities` and `evaluateShareAccess`),
 * and keeps the route and its regression tests on the same code path.
 *
 * This module performs no I/O: the caller does the asset/document lookups and
 * passes the rows in.
 *
 * Privacy contract (do NOT weaken):
 *   - missing asset, missing document, or soft-deleted document → `404`
 *     (existence must not leak).
 *   - asset exists on a live document but the caller has neither view
 *     capability nor a valid public share link → `403`.
 *   - a privacy `404` must NEVER be downgraded to a `403` (which would confirm
 *     the asset exists).
 */

import {
  documentCapabilities,
  type DocumentRoleInput,
} from "@/lib/auth/document-permissions";
import { type PublicAssetAccessDecision } from "@/lib/share/public-asset-policy";
import { type ShareAccessFields } from "@/lib/share-access";
import {
  allowAccess,
  denyAccess,
  type AccessDecision,
} from "@/lib/access-policy/taxonomy";

/** Why an asset request was allowed (for observability / tests). */
export type SlideAssetAllowReason =
  "capability" | "share-present" | "share-embed";

/** Why an asset request was denied. */
export type SlideAssetDenyReason =
  "asset-not-found" | "document-not-found" | "forbidden";

/** Outcome of a slide-asset access check. */
export type SlideAssetAccessDecision =
  | { allow: true; via: SlideAssetAllowReason }
  | { allow: false; status: 403 | 404; reason: SlideAssetDenyReason };

/* node:coverage disable */
/* Slide-asset access input types and field docs are erased at runtime. */
/**
 * The document row shape needed to decide access: ownership/workspace columns
 * (for capability) plus the share-policy columns and soft-delete timestamp.
 */
export type SlideAssetDocument = DocumentRoleInput &
  ShareAccessFields & {
    deletedAt: Date | null;
  };
/* node:coverage enable */

/** Inputs to the decision — all already-fetched rows, no I/O performed here. */
export interface SlideAssetAccessInput {
  /** The asset row, or `null` when no matching asset exists for the key. */
  asset: { id: string } | null;
  /** The owning document row, or `null` when it does not exist. */
  document: SlideAssetDocument | null;
  /** The authenticated user id, or `null` for anonymous requests. */
  userId: string | null;
  /** Clock injection point for deterministic tests (default `new Date()`). */
  now?: Date;
  /** Public share access resolved by the public render resolver. */
  publicAssetAccess?: PublicAssetAccessDecision;
}
/* node:coverage ignore stop */

/**
 * Decides whether a slide-asset request may be served.
 *
 * Mirrors the route's ordering exactly: asset existence → document
 * existence/live → authenticated view capability → public present link →
 * public embed link → deny. Missing rows resolve to a privacy `404`; an
 * existing-but-unauthorized request resolves to `403`.
 */
export function decideSlideAssetAccess(
  input: SlideAssetAccessInput,
): SlideAssetAccessDecision {
  if (!input.asset) {
    return { allow: false, status: 404, reason: "asset-not-found" };
  }

  const doc = input.document;
  if (!doc || doc.deletedAt) {
    return { allow: false, status: 404, reason: "document-not-found" };
  }

  // Authenticated user with view capability on the document.
  if (input.userId) {
    const caps = documentCapabilities(doc, input.userId);
    if (caps.canView) {
      return { allow: true, via: "capability" };
    }
  }

  // Anonymous (or no-capability): allow only via an explicit, share-bound public
  // asset decision. Do not synthesize access from the stored shareId alone; the
  // request must carry current shareId + shareMode proof.
  const publicAccess = input.publicAssetAccess ?? {
    allow: false,
    status: 403,
    reason: "forbidden",
  };
  if (publicAccess.allow) {
    return { allow: true, via: publicAccess.via };
  }

  return {
    allow: false,
    status: publicAccess.status,
    reason:
      publicAccess.reason === "document-not-found"
        ? "document-not-found"
        : "forbidden",
  };
}

/** Maps slide-asset route decisions to the shared access-decision taxonomy. */
export function slideAssetAccessDecisionToAccessDecision(
  decision: SlideAssetAccessDecision,
): AccessDecision {
  if (decision.allow) {
    return allowAccess({
      resource: { kind: "slide-asset" },
      capability: "serve",
    });
  }

  return denyAccess({
    resource: { kind: "slide-asset" },
    capability: "serve",
    reason:
      decision.reason === "asset-not-found"
        ? "asset-not-found"
        : decision.reason === "document-not-found"
          ? "resource-not-found"
          : "forbidden",
    status: decision.status,
    safeMessage: decision.status === 404 ? "Not found" : "Forbidden",
    concealResource: decision.status === 404,
  });
}
