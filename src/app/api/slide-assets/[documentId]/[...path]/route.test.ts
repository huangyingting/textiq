/**
 * Access-control regression coverage for the slide-asset serving route
 * (Epic #495, issue #510; route: `/api/slide-assets/[documentId]/[...path]`).
 *
 * Why this tests `decideSlideAssetAccess` rather than the `GET` handler:
 * the handler imports `@/lib/prisma` and `@/lib/session`, which require a live
 * DB and Auth.js context, and this harness runs under `node --import tsx
 * --test` with NO module-mocking flag (`mock.module` is unavailable), so the
 * HTTP handler cannot be invoked in isolation. The route was refactored (#510)
 * so its ENTIRE allow/deny decision lives in the pure `decideSlideAssetAccess`
 * function it calls; exercising that function therefore exercises the exact
 * route boundary decision — authenticated owner/editor/viewer/unrelated user,
 * anonymous present/embed (enabled and disabled), and expired/revoked/deleted/
 * missing cases — including the privacy guarantee that private assets are never
 * served via a predictable URL.
 *
 * Canonical-shape coverage (#1119): the two non-access-control error responses
 * emitted by the route — 429 rate-limit and 404 storage-miss — are asserted via
 * the `tooManyRequests` / `notFound` helpers used directly in the handler.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { notFound, tooManyRequests } from "@/lib/api/errors";
import {
  decideSlideAssetAccess,
  type SlideAssetDocument,
} from "@/lib/slides/asset-access";

const NOW = new Date("2026-06-23T00:00:00Z");
const ASSET = { id: "asset-1" };

/** Builds a document row, defaulting to a private, owned, live document. */
function makeDoc(
  overrides: Partial<SlideAssetDocument> = {},
): SlideAssetDocument {
  return {
    ownerId: "owner-1",
    workspaceId: null,
    workspace: null,
    shareId: null,
    isShared: false,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: false,
    sharePresentEnabled: false,
    ...overrides,
  };
}

/** A document publicly shared via a present/embed link. */
function sharedDoc(
  overrides: Partial<SlideAssetDocument> = {},
): SlideAssetDocument {
  return makeDoc({
    shareId: "share-abc",
    isShared: true,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    workspaceId: "ws-1",
    workspace: { ownerId: "owner-1", members: [] },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Authenticated capability access
// ---------------------------------------------------------------------------

test("#510: owner is served their own private asset", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({ ownerId: "owner-1" }),
    userId: "owner-1",
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "capability" });
});

test("#1717: owner access does not require share-bound public asset proof", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({ ownerId: "owner-1" }),
    userId: "owner-1",
    publicAssetAccess: { allow: false, status: 403, reason: "forbidden" },
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "capability" });
});

test("#510: workspace editor is served the asset", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({
      ownerId: "owner-1",
      workspaceId: "ws-1",
      workspace: {
        ownerId: "ws-owner",
        members: [{ userId: "editor-1", role: "EDITOR" }],
      },
    }),
    userId: "editor-1",
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "capability" });
});

test("#510: workspace viewer is served the asset (read access is enough)", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({
      ownerId: "owner-1",
      workspaceId: "ws-1",
      workspace: {
        ownerId: "ws-owner",
        members: [{ userId: "viewer-1", role: "VIEWER" }],
      },
    }),
    userId: "viewer-1",
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "capability" });
});

test("#510: unrelated authenticated user is forbidden (private asset not served)", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({
      ownerId: "owner-1",
      workspaceId: "ws-1",
      workspace: { ownerId: "ws-owner", members: [] },
    }),
    userId: "stranger-1",
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

// ---------------------------------------------------------------------------
// Anonymous share access (enabled)
// ---------------------------------------------------------------------------

test("#510: anonymous request is served when present link is enabled", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc(),
    userId: null,
    publicAssetAccess: { allow: true, via: "share-present" },
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "share-present" });
});

test("#510: anonymous request falls back to embed link when present is disabled", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({
      sharePresentEnabled: false,
      shareEmbedEnabled: true,
    }),
    userId: null,
    publicAssetAccess: { allow: true, via: "share-embed" },
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "share-embed" });
});

test("#721/#747: anonymous public asset access can be supplied by the public render resolver", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({
      sharePresentEnabled: false,
      shareEmbedEnabled: true,
    }),
    userId: null,
    publicAssetAccess: { allow: true, via: "share-embed" },
    now: NOW,
  });
  assert.deepEqual(decision, { allow: true, via: "share-embed" });
});

// ---------------------------------------------------------------------------
// Anonymous share access (disabled / unauthorized — private never served)
// ---------------------------------------------------------------------------

test("#1717: anonymous shared asset requires explicit share-bound proof", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc(),
    userId: null,
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

test("#510: anonymous request to a private (unshared) document is forbidden", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({ isShared: false }),
    userId: null,
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

test("#510: anonymous request denied when both present and embed are disabled", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({
      sharePresentEnabled: false,
      shareEmbedEnabled: false,
    }),
    userId: null,
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

test("#510: anonymous request denied for an expired share link", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({
      shareExpiresAt: new Date(NOW.getTime() - 1000),
    }),
    userId: null,
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

test("#1420: anonymous request denied when share-bound public access is stale", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({ shareId: "rotated-id" }),
    userId: null,
    publicAssetAccess: { allow: false, status: 403, reason: "forbidden" },
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

// ---------------------------------------------------------------------------
// Existence-hiding (privacy 404 — never downgraded to 403)
// ---------------------------------------------------------------------------

test("#510: missing asset yields a privacy 404 (not a 403)", () => {
  const decision = decideSlideAssetAccess({
    asset: null,
    document: makeDoc({ ownerId: "owner-1" }),
    userId: "owner-1",
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 404,
    reason: "asset-not-found",
  });
});

test("#510: missing document yields a privacy 404", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: null,
    userId: "owner-1",
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 404,
    reason: "document-not-found",
  });
});

test("#510: soft-deleted document yields a privacy 404 even for the owner", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: makeDoc({ ownerId: "owner-1", deletedAt: NOW }),
    userId: "owner-1",
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 404,
    reason: "document-not-found",
  });
});

test("#510: a deleted but publicly shared document is not served anonymously", () => {
  const decision = decideSlideAssetAccess({
    asset: ASSET,
    document: sharedDoc({ deletedAt: NOW }),
    userId: null,
    now: NOW,
  });
  assert.deepEqual(decision, {
    allow: false,
    status: 404,
    reason: "document-not-found",
  });
});

// ---------------------------------------------------------------------------
// Canonical error-body shape (#1119)
// ---------------------------------------------------------------------------

test("#1119: rate-limit 429 emits canonical envelope with Retry-After header", async () => {
  const resp = tooManyRequests(30);
  assert.strictEqual(resp.status, 429);
  assert.strictEqual(resp.headers.get("Retry-After"), "30");
  const body = await resp.json();
  assert.deepEqual(body, {
    error: "Too many requests. Please wait a moment and try again.",
    code: "RATE_LIMITED",
  });
});

test("#1119: rate-limit 429 omits Retry-After when seconds are not available", async () => {
  const resp = tooManyRequests(undefined);
  assert.strictEqual(resp.status, 429);
  assert.strictEqual(resp.headers.get("Retry-After"), null);
  const body = await resp.json();
  assert.strictEqual(body.code, "RATE_LIMITED");
});

test("#1119: storage-miss 404 emits canonical envelope", async () => {
  const resp = notFound();
  assert.strictEqual(resp.status, 404);
  const body = await resp.json();
  assert.deepEqual(body, { error: "Not found.", code: "NOT_FOUND" });
});
