/**
 * Tests for orphan detection and cleanup (issue #396).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectDeckAssetRefs,
  markOrphanedAssets,
  purgeExpiredAssets,
  ASSET_RETENTION_MS,
  type OrphanDb,
  type OrphanStorage,
} from "./asset-orphan";

// ---------------------------------------------------------------------------
// collectDeckAssetRefs
// ---------------------------------------------------------------------------

test("#396: collectDeckAssetRefs extracts backgroundAssetId from slides", () => {
  const deck = {
    slides: [
      { id: "s1", backgroundAssetId: "bg-asset-1" },
      { id: "s2", backgroundAssetId: "bg-asset-2" },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.ok(refs.has("bg-asset-1"));
  assert.ok(refs.has("bg-asset-2"));
  assert.equal(refs.size, 2);
});

test("#396: collectDeckAssetRefs extracts assetId from image elements", () => {
  const deck = {
    slides: [
      {
        id: "s1",
        elements: [
          { kind: "image", id: "e1", assetId: "img-asset-1" },
          { kind: "image", id: "e2", assetId: "img-asset-2" },
          { kind: "text", id: "e3" },
        ],
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.ok(refs.has("img-asset-1"));
  assert.ok(refs.has("img-asset-2"));
  assert.ok(!refs.has(undefined as unknown as string));
  assert.equal(refs.size, 2);
});

test("#396: collectDeckAssetRefs handles mixed background + element refs", () => {
  const deck = {
    slides: [
      {
        id: "s1",
        backgroundAssetId: "bg-1",
        elements: [{ kind: "image", id: "e1", assetId: "img-1" }],
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.equal(refs.size, 2);
  assert.ok(refs.has("bg-1"));
  assert.ok(refs.has("img-1"));
});

test("#396: collectDeckAssetRefs returns empty set for null deck", () => {
  assert.equal(collectDeckAssetRefs(null).size, 0);
  assert.equal(collectDeckAssetRefs(undefined).size, 0);
  assert.equal(collectDeckAssetRefs("not-an-object").size, 0);
});

test("#396: collectDeckAssetRefs deduplicates repeated asset ids", () => {
  const deck = {
    slides: [
      {
        id: "s1",
        backgroundAssetId: "shared-asset",
        elements: [{ kind: "image", id: "e1", assetId: "shared-asset" }],
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.equal(refs.size, 1);
  assert.ok(refs.has("shared-asset"));
});

test("#396: collectDeckAssetRefs ignores slides without asset refs", () => {
  const deck = {
    slides: [
      {
        id: "s1",
        backgroundImage: "data:image/png;base64,abc",
        elements: [{ kind: "text", id: "t1" }],
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.equal(refs.size, 0);
});

test("#1253: collectDeckAssetRefs extracts presentation image and visual node asset ids", () => {
  const deck = {
    schemaVersion: 7,
    assets: { images: {}, visuals: {} },
    slides: [
      {
        id: "s1",
        children: [
          {
            type: "image",
            id: "img",
            content: { assetId: "img-presentation-1" },
          },
          {
            type: "group",
            id: "group",
            children: [
              {
                type: "visual",
                id: "visual",
                content: { assetId: "visual-presentation-1" },
              },
            ],
          },
        ],
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.ok(refs.has("img-presentation-1"));
  assert.ok(refs.has("visual-presentation-1"));
  assert.equal(refs.size, 2);
});

test("#1253: collectDeckAssetRefs preserves assets.visuals registry refs", () => {
  const deck = {
    schemaVersion: 7,
    assets: {
      images: {},
      visuals: {
        "visual-registry-key": {
          id: "visual-registry-id",
          visualId: "doc-visual-1",
        },
      },
    },
    slides: [{ id: "s1", children: [] }],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.ok(refs.has("visual-registry-key"));
  assert.ok(refs.has("visual-registry-id"));
  assert.equal(refs.size, 2);
});

test("#1395: collectDeckAssetRefs extracts deck chrome logo asset ids", () => {
  const deck = {
    schemaVersion: 7,
    assets: { images: {}, visuals: {} },
    theme: {
      packageId: "theme-default",
      overrides: {
        chrome: {
          logo: { assetId: "theme-logo-asset" },
        },
      },
    },
    chrome: {
      logo: { assetId: "deck-logo-asset" },
    },
    slides: [
      {
        id: "s1",
        props: {
          deckChrome: {
            logo: {
              mode: "override",
              value: { assetId: "slide-logo-asset" },
            },
          },
        },
      },
      {
        id: "s2",
        props: {
          deckChrome: {
            logo: { mode: "inherit" },
          },
        },
      },
    ],
  };
  const refs = collectDeckAssetRefs(deck);
  assert.ok(refs.has("deck-logo-asset"));
  assert.ok(refs.has("theme-logo-asset"));
  assert.ok(refs.has("slide-logo-asset"));
  assert.equal(refs.size, 3);
});

// ---------------------------------------------------------------------------
// markOrphanedAssets
// ---------------------------------------------------------------------------

function makeMockDb(opts: {
  deckJson?: unknown;
  versions?: unknown[];
  liveAssets?: { id: string }[];
}): OrphanDb & { markedIds: string[] } {
  const markedIds: string[] = [];
  return {
    markedIds,
    document: {
      findUnique: async () =>
        opts.deckJson ? { deckJson: opts.deckJson } : null,
    },
    documentVersion: {
      findMany: async () => (opts.versions ?? []).map((v) => ({ deckJson: v })),
    },
    asset: {
      findMany: async () => opts.liveAssets ?? [],
      updateMany: async (args: {
        where: { id: { in: string[] } };
        data: { deletedAt: Date };
      }) => {
        markedIds.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
}

test("#396: markOrphanedAssets marks assets not in current deck", async () => {
  const db = makeMockDb({
    deckJson: {
      slides: [
        { id: "s1", elements: [{ kind: "image", assetId: "active-1" }] },
      ],
    },
    liveAssets: [{ id: "active-1" }, { id: "orphan-1" }, { id: "orphan-2" }],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 2);
  assert.ok(db.markedIds.includes("orphan-1"));
  assert.ok(db.markedIds.includes("orphan-2"));
  assert.ok(!db.markedIds.includes("active-1"));
});

test("#396: markOrphanedAssets preserves assets referenced in version snapshots", async () => {
  const db = makeMockDb({
    deckJson: { slides: [] },
    versions: [
      {
        slides: [{ id: "s1", backgroundAssetId: "version-bg-1" }],
      },
    ],
    liveAssets: [{ id: "version-bg-1" }, { id: "orphan-1" }],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 1);
  assert.ok(db.markedIds.includes("orphan-1"));
  assert.ok(!db.markedIds.includes("version-bg-1"));
});

test("#1253: markOrphanedAssets preserves assets referenced by presentation visual registry", async () => {
  const db = makeMockDb({
    deckJson: {
      schemaVersion: 7,
      assets: {
        images: {},
        visuals: {
          "visual-asset-1": {
            id: "visual-asset-1",
            visualId: "doc-visual-1",
          },
        },
      },
      slides: [],
    },
    liveAssets: [{ id: "visual-asset-1" }, { id: "orphan-1" }],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 1);
  assert.ok(db.markedIds.includes("orphan-1"));
  assert.ok(!db.markedIds.includes("visual-asset-1"));
});

test("#1253: markOrphanedAssets preserves assets referenced by presentation visual nodes", async () => {
  const db = makeMockDb({
    deckJson: {
      schemaVersion: 7,
      assets: { images: {}, visuals: {} },
      slides: [
        {
          id: "s1",
          children: [
            {
              type: "visual",
              id: "visual-1",
              content: { assetId: "visual-node-asset" },
            },
          ],
        },
      ],
    },
    liveAssets: [{ id: "visual-node-asset" }, { id: "orphan-1" }],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 1);
  assert.ok(db.markedIds.includes("orphan-1"));
  assert.ok(!db.markedIds.includes("visual-node-asset"));
});

test("#1395: markOrphanedAssets preserves deck chrome logo assets", async () => {
  const db = makeMockDb({
    deckJson: {
      schemaVersion: 7,
      assets: { images: {}, visuals: {} },
      theme: {
        packageId: "theme-default",
        overrides: {
          chrome: {
            logo: { assetId: "theme-logo-asset" },
          },
        },
      },
      chrome: {
        logo: { assetId: "deck-logo-asset" },
      },
      slides: [
        {
          id: "s1",
          props: {
            deckChrome: {
              logo: {
                mode: "override",
                value: { assetId: "slide-logo-asset" },
              },
            },
          },
        },
      ],
    },
    liveAssets: [
      { id: "deck-logo-asset" },
      { id: "theme-logo-asset" },
      { id: "slide-logo-asset" },
      { id: "orphan-1" },
    ],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 1);
  assert.ok(db.markedIds.includes("orphan-1"));
  assert.ok(!db.markedIds.includes("deck-logo-asset"));
  assert.ok(!db.markedIds.includes("theme-logo-asset"));
  assert.ok(!db.markedIds.includes("slide-logo-asset"));
});

test("#396: markOrphanedAssets returns 0 when all assets are active", async () => {
  const db = makeMockDb({
    deckJson: {
      slides: [
        {
          id: "s1",
          backgroundAssetId: "asset-1",
          elements: [{ kind: "image", assetId: "asset-2" }],
        },
      ],
    },
    liveAssets: [{ id: "asset-1" }, { id: "asset-2" }],
  });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 0);
});

test("#396: markOrphanedAssets returns 0 when no live assets", async () => {
  const db = makeMockDb({ liveAssets: [] });
  const count = await markOrphanedAssets("doc-1", db);
  assert.equal(count, 0);
});

// ---------------------------------------------------------------------------
// purgeExpiredAssets
// ---------------------------------------------------------------------------

function makePurgeDb(
  expiredAssets: { id: string; storageKey: string }[],
): OrphanDb & {
  deletedIds: string[];
} {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    document: { findUnique: async () => null },
    documentVersion: { findMany: async () => [] },
    asset: {
      findMany: async () => expiredAssets,
      updateMany: async () => ({ count: 0 }),
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        deletedIds.push(...args.where.id.in);
        return { count: args.where.id.in.length };
      },
    },
  };
}

function makeStorage(deletedKeys: string[]): OrphanStorage {
  return {
    delete: async (key) => {
      deletedKeys.push(key);
    },
  };
}

test("#396: purgeExpiredAssets purges assets past the retention window", async () => {
  const expiredAssets = [
    { id: "dead-1", storageKey: "doc/dead-1.png" },
    { id: "dead-2", storageKey: "doc/dead-2.png" },
  ];
  const db = makePurgeDb(expiredAssets);
  const deletedKeys: string[] = [];
  const storage = makeStorage(deletedKeys);

  const count = await purgeExpiredAssets("doc-1", db, storage);
  assert.equal(count, 2);
  assert.ok(deletedKeys.includes("doc/dead-1.png"));
  assert.ok(deletedKeys.includes("doc/dead-2.png"));
  assert.ok(db.deletedIds.includes("dead-1"));
  assert.ok(db.deletedIds.includes("dead-2"));
});

test("#396: purgeExpiredAssets is idempotent — returns 0 when nothing to purge", async () => {
  const db = makePurgeDb([]);
  const storage = makeStorage([]);
  const count = await purgeExpiredAssets("doc-1", db, storage);
  assert.equal(count, 0);
});

test("#396: purgeExpiredAssets skips assets where storage.delete fails", async () => {
  const expiredAssets = [
    { id: "ok-1", storageKey: "doc/ok-1.png" },
    { id: "fail-1", storageKey: "doc/fail-1.png" },
  ];
  const db = makePurgeDb(expiredAssets);
  const storage: OrphanStorage = {
    delete: async (key) => {
      if (key.includes("fail")) throw new Error("Storage error");
    },
  };

  const count = await purgeExpiredAssets("doc-1", db, storage);
  assert.equal(count, 1);
  assert.ok(db.deletedIds.includes("ok-1"));
  assert.ok(!db.deletedIds.includes("fail-1"));
});

test("#396: ASSET_RETENTION_MS is 7 days", () => {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.equal(ASSET_RETENTION_MS, sevenDays);
});
