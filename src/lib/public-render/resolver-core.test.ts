import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolvePublicRenderWithSource,
  type PublicRenderDocumentRow,
  type PublicRenderMetadataRow,
  type PublicRenderMode,
  type PublicRenderPresentationRow,
  type PublicRenderProjection,
  type PublicRenderSource,
  type ResolvePublicRenderInput,
} from "./resolver-core";
import {
  PUBLIC_RENDER_DOCUMENT_SELECT,
  PUBLIC_RENDER_METADATA_SELECT,
  PUBLIC_RENDER_PRESENTATION_SELECT,
  selectForPublicRenderProjection,
} from "./resolver-selects";
import {
  buildCoverSlide,
  buildDeck,
  buildImageAsset,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

const NOW = new Date("2026-06-25T00:00:00Z");

function shareFields(overrides: Partial<PublicRenderMetadataRow> = {}) {
  return {
    shareId: "share123",
    isShared: true,
    deletedAt: null,
    shareExpiresAt: null,
    shareEmbedEnabled: true,
    sharePresentEnabled: true,
    sharePasscodeHash: null,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    ...overrides,
  } satisfies Omit<PublicRenderMetadataRow, "title" | "contentJson" | "slug">;
}

function metadataRow(
  overrides: Partial<PublicRenderMetadataRow> = {},
): PublicRenderMetadataRow {
  return {
    ...shareFields(),
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    slug: "shared-doc",
    ...overrides,
  };
}

function documentRow(
  overrides: Partial<PublicRenderDocumentRow> = {},
): PublicRenderDocumentRow {
  return {
    ...shareFields(),
    id: "doc-1",
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    owner: { name: null, plan: "free" },
    ...overrides,
  };
}

function presentationRow(
  overrides: Partial<PublicRenderPresentationRow> = {},
): PublicRenderPresentationRow {
  return {
    ...shareFields(),
    id: "doc-1",
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    deckJson: null,
    owner: { name: null, plan: "free" },
    ...overrides,
  };
}

function source(rows: {
  document?: PublicRenderDocumentRow | null;
  metadata?: PublicRenderMetadataRow | null;
  presentation?: PublicRenderPresentationRow | null;
}): PublicRenderSource {
  return {
    async findDocumentByShareId() {
      return rows.document ?? null;
    },
    async findMetadataByShareId() {
      return rows.metadata ?? null;
    },
    async findPresentationByShareId() {
      return rows.presentation ?? null;
    },
  };
}

function trackedSource() {
  const calls = { document: 0, metadata: 0, presentation: 0 };
  const tracked: PublicRenderSource = {
    async findDocumentByShareId() {
      calls.document += 1;
      return documentRow();
    },
    async findMetadataByShareId() {
      calls.metadata += 1;
      return metadataRow();
    },
    async findPresentationByShareId() {
      calls.presentation += 1;
      return presentationRow();
    },
  };
  return { source: tracked, calls };
}

test("resolvePublicRenderWithSource characterizes every mode/projection pair and rejects invalid pairs before lookup", async () => {
  const cases: Array<{
    mode: PublicRenderMode;
    projection: PublicRenderProjection;
    valid: boolean;
    lookup: keyof ReturnType<typeof trackedSource>["calls"] | null;
  }> = [
    { mode: "view", projection: "document", valid: true, lookup: "document" },
    { mode: "view", projection: "metadata", valid: true, lookup: "metadata" },
    {
      mode: "view",
      projection: "presentation",
      valid: false,
      lookup: null,
    },
    { mode: "embed", projection: "document", valid: true, lookup: "document" },
    {
      mode: "embed",
      projection: "metadata",
      valid: false,
      lookup: null,
    },
    {
      mode: "embed",
      projection: "presentation",
      valid: true,
      lookup: "presentation",
    },
    {
      mode: "present",
      projection: "document",
      valid: false,
      lookup: null,
    },
    {
      mode: "present",
      projection: "metadata",
      valid: true,
      lookup: "metadata",
    },
    {
      mode: "present",
      projection: "presentation",
      valid: true,
      lookup: "presentation",
    },
    { mode: "og", projection: "document", valid: false, lookup: null },
    { mode: "og", projection: "metadata", valid: true, lookup: "metadata" },
    { mode: "og", projection: "presentation", valid: false, lookup: null },
  ];

  for (const pair of cases) {
    const tracked = trackedSource();
    const input = {
      params: { shareId: "share123" },
      mode: pair.mode,
      projection: pair.projection,
      now: NOW,
    } as unknown as ResolvePublicRenderInput;

    if (!pair.valid) {
      await assert.rejects(
        resolvePublicRenderWithSource(tracked.source, input),
        /Invalid public render request pair/,
      );
      assert.deepEqual(tracked.calls, {
        document: 0,
        metadata: 0,
        presentation: 0,
      });
      continue;
    }

    const result = await resolvePublicRenderWithSource(tracked.source, input);
    assert.equal(result.projection, pair.projection);
    assert.equal(result.ok, true);
    assert.equal(
      tracked.calls.document +
        tracked.calls.metadata +
        tracked.calls.presentation,
      1,
    );
    assert.equal(
      pair.lookup ? tracked.calls[pair.lookup] : 0,
      1,
      `expected ${pair.mode}/${pair.projection} to use ${pair.lookup} lookup`,
    );
  }
});

test("resolvePublicRenderWithSource parses raw share segments and returns a render-ready document", async () => {
  const result = await resolvePublicRenderWithSource(
    source({ document: documentRow() }),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
      now: NOW,
    },
  );

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
    source({ document: documentRow({ owner: { name: "Ada", plan: "free" } }) }),
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
    source({ metadata: metadataRow({ shareId: "new-share" }) }),
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
    source({ document: documentRow({ shareEmbedEnabled: false }) }),
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

test("resolvePublicRenderWithSource gates passcode-protected shares without leaking content", async () => {
  const locked = await resolvePublicRenderWithSource(
    source({ document: documentRow({ sharePasscodeHash: "hash" }) }),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
      now: NOW,
    },
  );
  assert.equal(locked.ok, false);
  assert.equal(locked.decision.allow, false);
  if (locked.decision.allow) {
    throw new Error("Expected a denied access decision.");
  }
  assert.equal(locked.decision.reason, "passcode-required");
  assert.equal(locked.decision.status, 403);
  assert.equal(locked.decision.concealResource, false);

  const unlocked = await resolvePublicRenderWithSource(
    source({ document: documentRow({ sharePasscodeHash: "hash" }) }),
    {
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
      now: NOW,
      passcodeUnlocked: true,
    },
  );
  assert.equal(unlocked.ok, true);
});

test("resolvePublicRenderWithSource enforces independent present/embed policy for presentation projection", async () => {
  const embedDenied = await resolvePublicRenderWithSource(
    source({
      presentation: presentationRow({
        shareEmbedEnabled: false,
        sharePresentEnabled: true,
      }),
    }),
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
    source({
      presentation: presentationRow({
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
      }),
    }),
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
    source({
      presentation: presentationRow({
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
      }),
    }),
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

test("resolvePublicRenderWithSource accepts raw share IDs for presentation embed routes", async () => {
  const result = await resolvePublicRenderWithSource(
    source({ presentation: presentationRow() }),
    {
      params: { shareId: "share123" },
      mode: "embed",
      projection: "presentation",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.projection !== "presentation") {
    throw new Error("Expected presentation projection.");
  }
  assert.equal(result.shareId, "share123");
  assert.equal(result.mode, "embed");
});

test("resolvePublicRenderWithSource keeps document embeds on the document projection", async () => {
  const result = await resolvePublicRenderWithSource(
    source({ document: documentRow() }),
    {
      params: { shareId: "share123" },
      mode: "embed",
      projection: "document",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.projection !== "document") {
    throw new Error("Expected document projection.");
  }
  assert.equal(result.document.title, "Shared Doc");
  assert.equal(result.mode, "embed");
});

test("resolvePublicRenderWithSource returns a concealed miss for absent shares", async () => {
  const result = await resolvePublicRenderWithSource(source({}), {
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
    source({ document: documentRow({ contentJson: null }) }),
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
    source({
      metadata: metadataRow({
        shareMetadataMode: null,
        shareDiscoverable: null,
        slug: null,
      }),
    }),
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
    source({
      presentation: presentationRow({ deckJson: deckWithProtectedAsset }),
    }),
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
});
