import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolvePublicAssetAccessForDocument,
  resolvePublicRenderWithSource,
  type PublicRenderDocumentRow,
  type PublicRenderSource,
} from "./resolver-core";
import {
  buildCoverSlide,
  buildDeck,
  buildImageAsset,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";
import {
  PUBLIC_RENDER_ASSET_ACCESS_SELECT,
  PUBLIC_RENDER_DOCUMENT_SELECT,
  PUBLIC_RENDER_METADATA_SELECT,
  PUBLIC_RENDER_PRESENTATION_SELECT,
  selectForPublicRenderProjection,
} from "./resolver-selects";

const NOW = new Date("2026-06-25T00:00:00Z");

function document(
  overrides: Partial<PublicRenderDocumentRow> = {},
): PublicRenderDocumentRow {
  return {
    id: "doc-1",
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    deckJson: null,
    slug: "shared-doc",
    ownerId: "owner-1",
    workspaceId: null,
    workspace: null,
    shareId: "share123",
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    owner: { name: null, plan: "free" },
    ...overrides,
  };
}

function source(row: PublicRenderDocumentRow | null): PublicRenderSource {
  return {
    async findByShareId() {
      return row;
    },
    async findByDocumentId() {
      return row;
    },
  };
}

test("resolvePublicRenderWithSource parses raw share segments and returns a render-ready document", async () => {
  const result = await resolvePublicRenderWithSource(source(document()), {
    params: { shareId: "shared-doc-share123" },
    mode: "view",
    projection: "document",
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.projection, "document");
  if (!result.ok || result.projection !== "document") {
    throw new Error("Expected document projection.");
  }
  assert.equal(result.shareId, "share123");
  assert.equal(result.document.ownerName, "Document owner");
  assert.equal(result.document.title, "Shared Doc");
});

test("resolvePublicRenderWithSource preserves display names without email fallback", async () => {
  const result = await resolvePublicRenderWithSource(
    source(document({ owner: { name: "Ada", plan: "free" } })),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.projection !== "document") {
    throw new Error("Expected document projection.");
  }
  assert.equal(result.document.ownerName, "Ada");
});

test("resolvePublicRenderWithSource denies regenerated links without returning document data", async () => {
  const result = await resolvePublicRenderWithSource(
    source(document({ shareId: "new-share" })),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "metadata",
      now: NOW,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.decision.allow, false);
  if (result.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(result.decision.status, 404);
  assert.equal(result.decision.concealResource, true);
});

test("resolvePublicRenderWithSource applies embed mode policy centrally", async () => {
  const result = await resolvePublicRenderWithSource(
    source(document({ shareEmbedEnabled: false })),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "embed",
      projection: "document",
      now: NOW,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.decision.allow, false);
  if (result.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(result.decision.status, 404);
  assert.equal(result.decision.concealResource, true);
});

test("resolvePublicRenderWithSource enforces independent present/embed policy for presentation projection", async () => {
  const embedDenied = await resolvePublicRenderWithSource(
    source(
      document({
        shareEmbedEnabled: false,
        sharePresentEnabled: true,
      }),
    ),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "embed",
      projection: "presentation",
      now: NOW,
    },
  );
  assert.equal(embedDenied.ok, false);
  assert.equal(embedDenied.decision.allow, false);
  if (embedDenied.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(embedDenied.decision.status, 404);
  assert.equal(embedDenied.decision.concealResource, true);

  const embedAllowed = await resolvePublicRenderWithSource(
    source(
      document({
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
      }),
    ),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "embed",
      projection: "presentation",
      now: NOW,
    },
  );
  assert.equal(embedAllowed.ok, true);
  if (!embedAllowed.ok || embedAllowed.projection !== "presentation") {
    throw new Error("Expected presentation projection.");
  }
  assert.equal(embedAllowed.mode, "embed");

  const presentDenied = await resolvePublicRenderWithSource(
    source(
      document({
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
      }),
    ),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "present",
      projection: "presentation",
      now: NOW,
    },
  );
  assert.equal(presentDenied.ok, false);
  assert.equal(presentDenied.decision.allow, false);
  if (presentDenied.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(presentDenied.decision.status, 404);
  assert.equal(presentDenied.decision.concealResource, true);
});

test("resolvePublicRenderWithSource returns a concealed miss for absent shares", async () => {
  const result = await resolvePublicRenderWithSource(source(null), {
    params: { shareId: "missing-share" },
    mode: "og",
    projection: "metadata",
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, "og");
  assert.equal(result.projection, "metadata");
  assert.equal(result.decision.allow, false);
  if (result.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(result.decision.status, 404);
  assert.equal(result.decision.safeMessage, "Shared document not found.");
});

test("resolvePublicRenderWithSource denies document projection when content is missing", async () => {
  const result = await resolvePublicRenderWithSource(
    source(document({ contentJson: null })),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
      now: NOW,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.projection, "document");
  assert.equal(result.decision.allow, false);
});

test("resolvePublicRenderWithSource returns metadata defaults for older shared rows", async () => {
  const result = await resolvePublicRenderWithSource(
    source(
      document({
        shareMetadataMode: null,
        shareDiscoverable: null,
        slug: null,
      } as any),
    ),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "og",
      projection: "metadata",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.projection !== "metadata") {
    throw new Error("Expected metadata projection.");
  }
  assert.deepEqual(result.metadata, {
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    slug: null,
    shareId: "share123",
    metadataMode: "generic",
    discoverable: false,
  });
});

test("resolvePublicRenderWithSource builds presentation projections for present mode", async () => {
  resetBuilderCounter();
  const deckWithProtectedAsset = buildDeck([buildCoverSlide()], {
    assets: {
      images: {
        "asset-1": buildImageAsset("asset-1", {
          src: "/api/slide-assets/doc-1/uploads/protected.png",
        }),
      },
    },
  });
  const result = await resolvePublicRenderWithSource(
    source(document({ deckJson: deckWithProtectedAsset })),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "present",
      projection: "presentation",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.projection !== "presentation") {
    throw new Error("Expected presentation projection.");
  }
  assert.equal(result.mode, "present");
  assert.equal(result.presentation.title, "Shared Doc");
  assert.equal(result.presentation.attribution.ownerName, "Document owner");
  assert.equal(
    result.presentation.deck.assets.images["asset-1"]?.src,
    "/api/slide-assets/doc-1/uploads/protected.png?shareId=share123&shareMode=present",
  );
});

test("resolvePublicAssetAccessForDocument enforces share-bound mode-specific access", () => {
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

test("resolvePublicAssetAccessForDocument denies regenerated, disabled, and expired share inputs", () => {
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

test("resolvePublicRenderWithSource requires share-bound params for asset mode", async () => {
  const allowed = await resolvePublicRenderWithSource(source(document()), {
    params: {
      documentId: "doc-1",
      shareId: "share123",
      shareMode: "present",
    },
    mode: "asset",
    projection: "assetAccess",
    now: NOW,
  });

  assert.equal(allowed.projection, "assetAccess");
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.publicAccess, {
    allow: true,
    via: "share-present",
  });
  assert.equal(allowed.document?.id, "doc-1");

  const missingBinding = await resolvePublicRenderWithSource(
    source(document()),
    {
      params: { documentId: "doc-1" },
      mode: "asset",
      projection: "assetAccess",
      now: NOW,
    },
  );
  if (missingBinding.projection !== "assetAccess") {
    throw new Error("Expected asset access projection.");
  }
  assert.equal(missingBinding.ok, false);
  assert.deepEqual(missingBinding.publicAccess, {
    allow: false,
    status: 403,
    reason: "forbidden",
  });
});

test("resolvePublicRenderWithSource rejects mismatched asset mode and projection", async () => {
  await assert.rejects(
    resolvePublicRenderWithSource(source(document()), {
      params: { documentId: "doc-1" },
      mode: "asset",
      projection: "document",
      now: NOW,
    }),
    /assetAccess projection/,
  );
});

test("resolvePublicRenderWithSource returns not-found asset decisions for missing or deleted documents", async () => {
  const missing = await resolvePublicRenderWithSource(source(null), {
    params: {
      documentId: "doc-missing",
      shareId: "share123",
      shareMode: "present",
    },
    mode: "asset",
    projection: "assetAccess",
    now: NOW,
  });
  assert.equal(missing.ok, false);
  if (missing.ok || missing.projection !== "assetAccess") {
    throw new Error("Expected missing asset access projection.");
  }
  assert.deepEqual(missing.publicAccess, {
    allow: false,
    status: 404,
    reason: "document-not-found",
  });
  assert.equal(missing.decision.allow, false);
  if (missing.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(missing.decision.status, 404);

  const deleted = resolvePublicAssetAccessForDocument(
    document({ deletedAt: new Date("2026-06-24T00:00:00Z") }),
    "share123",
    "present",
    NOW,
  );
  assert.deepEqual(deleted, {
    allow: false,
    status: 404,
    reason: "document-not-found",
  });
});

test("resolvePublicAssetAccessForDocument keeps private live documents forbidden, not not-found", () => {
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

test("selectForPublicRenderProjection returns the matching Prisma select", () => {
  assert.equal(
    selectForPublicRenderProjection("metadata"),
    PUBLIC_RENDER_METADATA_SELECT,
  );
  assert.equal(
    selectForPublicRenderProjection("document"),
    PUBLIC_RENDER_DOCUMENT_SELECT,
  );
  assert.equal(
    selectForPublicRenderProjection("presentation"),
    PUBLIC_RENDER_PRESENTATION_SELECT,
  );
  assert.equal(
    selectForPublicRenderProjection("assetAccess"),
    PUBLIC_RENDER_ASSET_ACCESS_SELECT,
  );
});
