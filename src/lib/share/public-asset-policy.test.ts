import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePublicAssetAccessForDocument } from "./public-asset-policy";

const NOW = new Date("2026-06-25T00:00:00Z");

function document(overrides: Record<string, unknown> = {}) {
  return {
    shareId: "share123",
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    ...overrides,
  };
}

test("resolvePublicAssetAccessForDocument allows present/embed links and blocks missing proof", () => {
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(document(), "share123", "present", NOW),
    {
      allow: true,
      via: "share-present",
    },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(document(), "share123", "embed", NOW),
    {
      allow: true,
      via: "share-embed",
    },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(document(), "", null, NOW),
    {
      allow: false,
      status: 403,
      reason: "forbidden",
    },
  );
});

test("resolvePublicAssetAccessForDocument requires passcode unlock for protected shares", () => {
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ sharePasscodeHash: "hash" }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 403, reason: "forbidden" },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ sharePasscodeHash: "hash" }),
      "share123",
      "present",
      NOW,
      true,
    ),
    {
      allow: true,
      via: "share-present",
    },
  );
});

test("resolvePublicAssetAccessForDocument denies rotated, disabled, and expired share proof", () => {
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ shareId: "rotated-share" }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 403, reason: "forbidden" },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ sharePresentEnabled: false }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 403, reason: "forbidden" },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ shareExpiresAt: new Date("2026-06-24T00:00:00Z") }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 403, reason: "forbidden" },
  );
});

test("resolvePublicAssetAccessForDocument returns not-found for missing/deleted documents", () => {
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(null, "share123", "present", NOW),
    { allow: false, status: 404, reason: "document-not-found" },
  );
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ deletedAt: new Date("2026-06-24T00:00:00Z") }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 404, reason: "document-not-found" },
  );
});

test("resolvePublicAssetAccessForDocument keeps private live documents forbidden", () => {
  assert.deepEqual(
    resolvePublicAssetAccessForDocument(
      document({ isShared: false, shareId: null }),
      "share123",
      "present",
      NOW,
    ),
    { allow: false, status: 403, reason: "forbidden" },
  );
});
