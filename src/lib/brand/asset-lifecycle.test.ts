/**
 * Tests for brand asset storage + access + orphan/cleanup (Epic #496).
 *
 * DOM-free: runs under `node --import tsx --test`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decideBrandAssetAccess } from "@/lib/brand/asset-access";
import { BRAND_MIME_TO_EXT } from "@/lib/brand/asset-policy";
import {
  deriveBrandStorageKey,
  resetBrandStorageAdapter,
  setBrandStorageAdapter,
} from "@/lib/brand/asset-storage";
import {
  serializeBrands,
  toBrandStyle,
  type BrandRow,
} from "@/lib/brand/serialize";
import {
  BRAND_ASSET_RETENTION_MS,
  reconcileBrandAssets,
  purgeExpiredBrandAssets,
  selectBrandOrphanIds,
  type BrandOrphanDb,
  type BrandOrphanStorage,
} from "@/lib/brand/asset-orphan";
import {
  BrandAssetValidationError,
  brandAssetBelongsToOwner,
  createBrandForOwner,
  deleteBrandForOwner,
  updateBrandForOwner,
} from "@/lib/brand/persistence-service";
import { prisma } from "@/lib/prisma";

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  const wrapped = (...args: unknown[]) => {
    calls.push(args);
    return (implementation as (...args: unknown[]) => unknown)(...args);
  };
  Object.defineProperty(object, methodName, {
    value: wrapped,
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      value: original,
      configurable: true,
    });
  });
  return { calls };
}

// ---------------------------------------------------------------------------
// decideBrandAssetAccess
// ---------------------------------------------------------------------------

describe("decideBrandAssetAccess", () => {
  const asset = { id: "a1" };

  it("404 when the asset does not exist (privacy)", () => {
    const d = decideBrandAssetAccess({
      asset: null,
      requestedOwnerId: "u1",
      userId: "u1",
    });
    assert.equal(d.allow, false);
    if (!d.allow) {
      assert.equal(d.status, 404);
      assert.equal(d.reason, "asset-not-found");
    }
  });

  it("returns the privacy 404 when unauthenticated", () => {
    const d = decideBrandAssetAccess({
      asset,
      requestedOwnerId: "u1",
      userId: null,
    });
    assert.equal(d.allow, false);
    if (!d.allow) {
      assert.equal(d.status, 404);
      assert.equal(d.reason, "unauthenticated");
    }
  });

  it("returns the privacy 404 when authenticated but not the partition owner", () => {
    const d = decideBrandAssetAccess({
      asset,
      requestedOwnerId: "u1",
      userId: "u2",
    });
    assert.equal(d.allow, false);
    if (!d.allow) {
      assert.equal(d.status, 404);
      assert.equal(d.reason, "forbidden");
    }
  });

  it("allows the partition owner", () => {
    const d = decideBrandAssetAccess({
      asset,
      requestedOwnerId: "u1",
      userId: "u1",
    });
    assert.equal(d.allow, true);
  });

  it("denial outcomes are indistinguishable by status", () => {
    const cases = [
      decideBrandAssetAccess({
        asset: null,
        requestedOwnerId: "u1",
        userId: "u1",
      }),
      decideBrandAssetAccess({
        asset,
        requestedOwnerId: "u1",
        userId: null,
      }),
      decideBrandAssetAccess({
        asset,
        requestedOwnerId: "u1",
        userId: "u2",
      }),
    ];

    for (const d of cases) {
      assert.equal(d.allow, false);
      if (!d.allow) assert.equal(d.status, 404);
    }
  });
});

// ---------------------------------------------------------------------------
// deriveBrandStorageKey
// ---------------------------------------------------------------------------

describe("deriveBrandStorageKey", () => {
  it("partitions by ownerId and derives extension from MIME", () => {
    assert.equal(
      deriveBrandStorageKey("owner1", "abc123", "image/png"),
      "owner1/abc123.png",
    );
    assert.equal(
      deriveBrandStorageKey("owner1", "def", "font/woff2"),
      "owner1/def.woff2",
    );
  });

  it("falls back to bin for unknown MIME (never the filename)", () => {
    assert.equal(
      deriveBrandStorageKey("o", "x", "application/octet-stream"),
      "o/x.bin",
    );
    assert.equal(deriveBrandStorageKey("o", "x", "weird/type"), "o/x.bin");
  });

  it("covers all accepted logo + font MIME types", () => {
    for (const mime of Object.keys(BRAND_MIME_TO_EXT)) {
      const key = deriveBrandStorageKey("o", "c", mime);
      assert.match(key, /^o\/c\.[a-z0-9]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// toBrandStyle — derives protected URLs from asset refs
// ---------------------------------------------------------------------------

describe("toBrandStyle", () => {
  const baseRow: BrandRow = {
    id: "b1",
    name: "Acme",
    ownerId: "u1",
    palette: ["#ff0000"],
    background: null,
    nodeFill: null,
    nodeStroke: null,
    nodeText: null,
    edgeColor: null,
    fontFamily: null,
    logoAssetId: null,
    fontAssetId: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-02T00:00:00.000Z"),
  };

  it("derives logo/font URLs from the asset map", () => {
    const map = new Map([
      ["la", "/api/brand-assets/u1/aaa.png"],
      ["fa", "/api/brand-assets/u1/bbb.woff2"],
    ]);
    const style = toBrandStyle(
      { ...baseRow, logoAssetId: "la", fontAssetId: "fa" },
      map,
    );
    assert.equal(style.logoAssetUrl, "/api/brand-assets/u1/aaa.png");
    assert.equal(style.fontAssetUrl, "/api/brand-assets/u1/bbb.woff2");
    assert.equal(style.logoAssetId, "la");
    assert.equal(style.fontAssetId, "fa");
  });

  describe("serializeBrands", () => {
    const baseRow: BrandRow = {
      id: "b1",
      name: "Acme",
      ownerId: "u1",
      palette: ["#ff0000"],
      background: null,
      nodeFill: null,
      nodeStroke: null,
      nodeText: null,
      edgeColor: null,
      fontFamily: null,
      logoAssetId: "logo-1",
      fontAssetId: "font-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };

    it("batch-loads referenced assets and serializes protected URLs", async (t) => {
      t.after(resetBrandStorageAdapter);
      setBrandStorageAdapter({
        store: async () => "",
        read: async () => Buffer.from(""),
        delete: async () => {},
        urlFor: (key) => `/brand-assets/${key}`,
      });
      const findMany = stubPrismaMethod(
        t,
        prisma.asset,
        "findMany",
        async () => [
          { id: "logo-1", storageKey: "u1/logo.png" },
          { id: "font-1", storageKey: "u1/font.woff2" },
        ],
      );

      const [style] = await serializeBrands([baseRow]);

      assert.deepEqual(findMany.calls[0], [
        {
          where: { id: { in: ["logo-1", "font-1"] }, deletedAt: null },
          select: { id: true, storageKey: true },
        },
      ]);
      assert.equal(style.logoAssetUrl, "/brand-assets/u1/logo.png");
      assert.equal(style.fontAssetUrl, "/brand-assets/u1/font.woff2");
    });

    it("skips the asset query when rows have no asset references", async (t) => {
      const findMany = stubPrismaMethod(
        t,
        prisma.asset,
        "findMany",
        async () => {
          throw new Error("findMany should not be called without asset ids");
        },
      );

      const [style] = await serializeBrands([
        { ...baseRow, logoAssetId: null, fontAssetId: null },
      ]);

      assert.equal(findMany.calls.length, 0);
      assert.equal(style.logoAssetUrl, null);
      assert.equal(style.fontAssetUrl, null);
    });
  });

  it("null URLs when no asset ref is set", () => {
    const style = toBrandStyle(baseRow, new Map());
    assert.equal(style.logoAssetUrl, null);
    assert.equal(style.fontAssetUrl, null);
  });

  it("null URL when the referenced asset is missing from the map (purged)", () => {
    const style = toBrandStyle({ ...baseRow, logoAssetId: "gone" }, new Map());
    assert.equal(style.logoAssetUrl, null);
    assert.equal(style.logoAssetId, "gone");
  });
});

// ---------------------------------------------------------------------------
// selectBrandOrphanIds (pure)
// ---------------------------------------------------------------------------

describe("selectBrandOrphanIds", () => {
  it("returns assets not in the live reference set", () => {
    const live = new Set(["keep"]);
    const orphans = selectBrandOrphanIds(live, [
      { id: "keep" },
      { id: "drop1" },
      { id: "drop2" },
    ]);
    assert.deepEqual(orphans.sort(), ["drop1", "drop2"]);
  });

  describe("brandAssetBelongsToOwner", () => {
    it("accepts only storage keys in the owner's partition", () => {
      assert.equal(
        brandAssetBelongsToOwner("owner-1/logo.png", "owner-1"),
        true,
      );
      assert.equal(
        brandAssetBelongsToOwner("owner-2/logo.png", "owner-1"),
        false,
      );
    });
  });

  it("returns empty when all assets are referenced", () => {
    const live = new Set(["a", "b"]);
    assert.deepEqual(
      selectBrandOrphanIds(live, [{ id: "a" }, { id: "b" }]),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// In-memory DB harness for reconcile / purge
// ---------------------------------------------------------------------------

interface MemAsset {
  id: string;
  brandId: string | null;
  documentId: string | null;
  workspaceId: string | null;
  storageKey: string;
  deletedAt: Date | null;
}

function makeDb(
  brand: { logoAssetId: string | null; fontAssetId: string | null } | null,
  assets: MemAsset[],
): { db: BrandOrphanDb; assets: MemAsset[] } {
  const db: BrandOrphanDb = {
    brand: {
      async findUnique() {
        return brand
          ? { logoAssetId: brand.logoAssetId, fontAssetId: brand.fontAssetId }
          : null;
      },
    },
    asset: {
      async findMany(args) {
        const w = args.where;
        if ("brandId" in w) {
          return assets
            .filter((a) => a.brandId === w.brandId && a.deletedAt === null)
            .map((a) => ({ id: a.id }));
        }
        // purge query
        const lt = w.deletedAt.lt;
        return assets
          .filter(
            (a) =>
              a.documentId === null &&
              a.workspaceId === null &&
              a.deletedAt !== null &&
              a.deletedAt < lt,
          )
          .map((a) => ({ id: a.id, storageKey: a.storageKey }));
      },
      async updateMany(args) {
        let count = 0;
        for (const a of assets) {
          if (args.where.id.in.includes(a.id)) {
            a.deletedAt = args.data.deletedAt;
            count += 1;
          }
        }
        return { count };
      },
      async deleteMany(args) {
        let count = 0;
        for (let i = assets.length - 1; i >= 0; i -= 1) {
          if (args.where.id.in.includes(assets[i].id)) {
            assets.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return { db, assets };
}

describe("reconcileBrandAssets", () => {
  it("soft-deletes brand assets no longer referenced (replaced logo)", async () => {
    const assets: MemAsset[] = [
      {
        id: "old-logo",
        brandId: "b1",
        documentId: null,
        workspaceId: null,
        storageKey: "u1/old.png",
        deletedAt: null,
      },
      {
        id: "new-logo",
        brandId: "b1",
        documentId: null,
        workspaceId: null,
        storageKey: "u1/new.png",
        deletedAt: null,
      },
    ];
    const { db } = makeDb(
      { logoAssetId: "new-logo", fontAssetId: null },
      assets,
    );
    const count = await reconcileBrandAssets("b1", db, new Date());
    assert.equal(count, 1);
    assert.equal(
      assets.find((a) => a.id === "old-logo")!.deletedAt !== null,
      true,
    );
    assert.equal(assets.find((a) => a.id === "new-logo")!.deletedAt, null);
  });

  it("is idempotent — re-running orphans nothing new", async () => {
    const assets: MemAsset[] = [
      {
        id: "logo",
        brandId: "b1",
        documentId: null,
        workspaceId: null,
        storageKey: "u1/l.png",
        deletedAt: null,
      },
    ];
    const { db } = makeDb({ logoAssetId: "logo", fontAssetId: null }, assets);
    assert.equal(await reconcileBrandAssets("b1", db), 0);
    assert.equal(await reconcileBrandAssets("b1", db), 0);
  });

  it("returns 0 for a missing brand", async () => {
    const { db } = makeDb(null, []);
    assert.equal(await reconcileBrandAssets("gone", db), 0);
  });
});

describe("purgeExpiredBrandAssets", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const expiredAt = new Date(now.getTime() - BRAND_ASSET_RETENTION_MS - 1000);
  const recentAt = new Date(now.getTime() - 1000);

  function storage(deleted: string[]): BrandOrphanStorage {
    return {
      async delete(key) {
        deleted.push(key);
      },
    };
  }

  it("purges soft-deleted brand-origin assets past the retention window", async () => {
    const assets: MemAsset[] = [
      {
        id: "expired",
        brandId: null,
        documentId: null,
        workspaceId: null,
        storageKey: "u1/expired.png",
        deletedAt: expiredAt,
      },
      {
        id: "recent",
        brandId: null,
        documentId: null,
        workspaceId: null,
        storageKey: "u1/recent.png",
        deletedAt: recentAt,
      },
    ];
    const { db } = makeDb(null, assets);
    const deleted: string[] = [];
    const count = await purgeExpiredBrandAssets(
      db,
      storage(deleted),
      BRAND_ASSET_RETENTION_MS,
      now,
    );
    assert.equal(count, 1);
    assert.deepEqual(deleted, ["u1/expired.png"]);
    assert.equal(
      assets.some((a) => a.id === "expired"),
      false,
    );
    assert.equal(
      assets.some((a) => a.id === "recent"),
      true,
    );
  });

  it("does not purge document-scoped (slide) assets", async () => {
    const assets: MemAsset[] = [
      {
        id: "slide",
        brandId: null,
        documentId: "doc1",
        workspaceId: null,
        storageKey: "doc1/x.png",
        deletedAt: expiredAt,
      },
    ];
    const { db } = makeDb(null, assets);
    const deleted: string[] = [];
    const count = await purgeExpiredBrandAssets(
      db,
      storage(deleted),
      BRAND_ASSET_RETENTION_MS,
      now,
    );
    assert.equal(count, 0);
    assert.deepEqual(deleted, []);
  });
});

// ---------------------------------------------------------------------------
// Brand persistence service
// ---------------------------------------------------------------------------

function stubObjectMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: T[K] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : never,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  Object.defineProperty(object, methodName, {
    configurable: true,
    value: (...args: unknown[]) => {
      calls.push(args);
      return (implementation as (...args: unknown[]) => unknown)(...args);
    },
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      configurable: true,
      value: original,
    });
  });
  return { calls };
}

function brandRow(overrides: Partial<BrandRow> = {}): BrandRow {
  return {
    id: "brand-acme",
    name: "Acme",
    ownerId: "owner-1",
    palette: ["#111111"],
    background: null,
    nodeFill: null,
    nodeStroke: null,
    nodeText: null,
    edgeColor: null,
    fontFamily: null,
    logoAssetId: null,
    fontAssetId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

describe("brand persistence service", () => {
  it("creates a brand and links owner-scoped assets", async (t) => {
    const tx = {
      asset: {
        findMany: async (rawArgs: unknown) => {
          const args = rawArgs as { where: { id?: { in?: string[] } } };
          if (args.where.id?.in) {
            return [
              { id: "logo-asset", storageKey: "owner-1/logo.svg" },
              { id: "font-asset", storageKey: "owner-1/font.woff2" },
            ];
          }
          return [{ id: "logo-asset" }, { id: "font-asset" }];
        },
        updateMany: async () => ({ count: 2 }),
      },
      brand: {
        create: async ({ data }: { data: Record<string, unknown> }) =>
          brandRow({
            id: "brand-created",
            name: String(data.name),
            logoAssetId: data.logoAssetId as string,
            fontAssetId: data.fontAssetId as string,
          }),
        findUnique: async () => ({
          logoAssetId: "logo-asset",
          fontAssetId: "font-asset",
        }),
      },
    };
    const transaction = stubObjectMethod(
      t,
      prisma,
      "$transaction",
      async (fn: unknown) => (fn as (txArg: typeof tx) => unknown)(tx),
    );

    const created = await createBrandForOwner("owner-1", {
      name: "Acme",
      palette: ["#111111"],
      logoAssetId: "logo-asset",
      fontAssetId: "font-asset",
    });

    assert.equal(created.id, "brand-created");
    assert.equal(transaction.calls.length, 1);
  });

  it("rejects brand assets outside the owner partition", async (t) => {
    const tx = {
      asset: {
        findMany: async () => [
          { id: "foreign-logo", storageKey: "other-owner/logo.svg" },
        ],
      },
      brand: {
        create: async () => brandRow(),
      },
    };
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (txArg: typeof tx) => unknown)(tx),
    );

    await assert.rejects(
      () =>
        createBrandForOwner("owner-1", {
          name: "Acme",
          palette: [],
          logoAssetId: "foreign-logo",
        }),
      BrandAssetValidationError,
    );
  });

  it("updates only brands owned by the caller", async (t) => {
    const tx = {
      asset: {
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
      brand: {
        findUnique: async ({ select }: { select?: Record<string, boolean> }) =>
          select?.ownerId
            ? { ownerId: "owner-1" }
            : { logoAssetId: null, fontAssetId: null },
        update: async ({ data }: { data: Record<string, unknown> }) =>
          brandRow({
            name: String(data.name),
            background: data.background as string,
          }),
      },
    };
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (txArg: typeof tx) => unknown)(tx),
    );

    const updated = await updateBrandForOwner("brand-acme", "owner-1", {
      name: "Acme refreshed",
      palette: ["#222222"],
      background: "#ffffff",
    });

    assert.equal(updated?.name, "Acme refreshed");
    assert.equal(updated?.background, "#ffffff");
  });

  it("returns missing or unauthorized without deleting brands", async (t) => {
    let existing: null | { ownerId: string } = null;
    const tx = {
      brand: {
        findUnique: async () => existing,
        delete: async () => {
          throw new Error("delete should not run");
        },
      },
      asset: {
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
    };
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (txArg: typeof tx) => unknown)(tx),
    );

    assert.equal(
      await deleteBrandForOwner("brand-missing", "owner-1"),
      "missing",
    );
    existing = { ownerId: "owner-2" };
    assert.equal(
      await deleteBrandForOwner("brand-foreign", "owner-1"),
      "unauthorized",
    );
  });

  it("deletes an owned brand and soft-deletes linked assets", async (t) => {
    const tx = {
      brand: {
        findUnique: async () => ({ ownerId: "owner-1" }),
        delete: async () => ({}),
      },
      asset: {
        findMany: async () => [{ id: "logo-asset" }, { id: "font-asset" }],
        updateMany: async (rawArgs: unknown) => {
          const args = rawArgs as { where: { id: { in: string[] } } };
          return {
            count: args.where.id.in.length,
          };
        },
      },
    };
    stubObjectMethod(t, prisma, "$transaction", async (fn: unknown) =>
      (fn as (txArg: typeof tx) => unknown)(tx),
    );

    assert.equal(await deleteBrandForOwner("brand-acme", "owner-1"), "deleted");
  });
});
