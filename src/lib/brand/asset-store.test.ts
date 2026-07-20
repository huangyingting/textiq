/**
 * Behavioral tests for `storeBrandAsset` (#1881).
 *
 * `storeBrandAsset` is the thin brand-specific wrapper around the shared
 * `storeAssetWithUpsert` upsert contract (checksum dedup, soft-delete
 * revival, P2002 race recovery). `storeAssetWithUpsert` itself already has
 * generic coverage in `@/lib/assets/store.test.ts`; these tests instead
 * assert the brand-specific wiring: the `Asset` row shape brand upload writes
 * (mimeType/byteSize/checksum/storageKey/brandId/originalName), the
 * owner-partitioned + MIME-derived storage key identity, and that Prisma
 * errors are not swallowed on the way out.
 *
 * Module-hook strategy: none needed — `asset-store.ts` has no `server-only`
 * import, so `prisma.asset` methods are replaced directly via
 * `Object.defineProperty` (same pattern as `upload-route-service.test.ts`),
 * and the storage adapter is swapped via the existing
 * `setBrandStorageAdapter` / `resetBrandStorageAdapter` DI seam.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { storeBrandAsset } from "@/lib/brand/asset-store";
import {
  resetBrandStorageAdapter,
  setBrandStorageAdapter,
} from "@/lib/brand/asset-storage";
import { calculateAssetChecksum } from "@/lib/assets/store";
import { prisma } from "@/lib/prisma";

type TestContext = { after: (fn: () => void) => void };

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: TestContext,
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  Object.defineProperty(object, methodName, {
    configurable: true,
    value: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
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

type MemoryAdapterState = {
  writes: string[];
};

function memoryAdapter(state: MemoryAdapterState) {
  return {
    async store(key: string) {
      state.writes.push(key);
      return `/api/brand-assets/${key}`;
    },
    urlFor(key: string) {
      return `/api/brand-assets/${key}`;
    },
    async read() {
      return Buffer.from("");
    },
    async delete() {},
  };
}

after(() => {
  resetBrandStorageAdapter();
});

describe("storeBrandAsset — create path", () => {
  it("stores bytes and creates a new Asset row with the full field set", async (t) => {
    const state: MemoryAdapterState = { writes: [] };
    setBrandStorageAdapter(memoryAdapter(state));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    const created = stubPrismaMethod(
      t,
      prisma.asset,
      "create",
      async (args) => {
        const { data } = args as {
          data: {
            mimeType: string;
            byteSize: number;
            checksum: string;
            storageKey: string;
            brandId?: string;
            originalName?: string;
          };
        };
        assert.equal(data.mimeType, "image/png");
        assert.equal(data.byteSize, Buffer.from("brand-logo-bytes").byteLength);
        assert.equal(
          data.checksum,
          calculateAssetChecksum(Buffer.from("brand-logo-bytes")),
        );
        assert.equal(data.storageKey, `owner-1/${data.checksum}.png`);
        assert.equal(data.brandId, "brand-7");
        assert.equal(data.originalName, "logo.png");
        return { id: "asset-created-1" };
      },
    );

    const result = await storeBrandAsset({
      ownerId: "owner-1",
      buffer: Buffer.from("brand-logo-bytes"),
      mimeType: "image/png",
      originalName: "logo.png",
      brandId: "brand-7",
    });

    assert.equal(result.assetId, "asset-created-1");
    assert.equal(created.calls.length, 1);
    assert.equal(state.writes.length, 1);
    assert.equal(result.url, `/api/brand-assets/${result.storageKey}`);
  });

  it("omits brandId and originalName from the create payload when absent", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    const created = stubPrismaMethod(
      t,
      prisma.asset,
      "create",
      async (args) => {
        const { data } = args as { data: Record<string, unknown> };
        assert.equal("brandId" in data, false);
        assert.equal("originalName" in data, false);
        return { id: "asset-created-2" };
      },
    );

    const result = await storeBrandAsset({
      ownerId: "owner-2",
      buffer: Buffer.from("font-bytes"),
      mimeType: "font/woff2",
    });

    assert.equal(result.assetId, "asset-created-2");
    assert.equal(created.calls.length, 1);
  });
});

describe("storeBrandAsset — checksum deduplication", () => {
  it("returns the existing asset without creating a duplicate row", async (t) => {
    const state: MemoryAdapterState = { writes: [] };
    setBrandStorageAdapter(memoryAdapter(state));
    t.after(resetBrandStorageAdapter);

    const buffer = Buffer.from("identical-bytes");
    const checksum = calculateAssetChecksum(buffer);
    const storageKey = `owner-3/${checksum}.png`;

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => ({
      id: "asset-existing-1",
      storageKey,
      deletedAt: null,
      brandId: null,
    }));
    const updated = stubPrismaMethod(
      t,
      prisma.asset,
      "update",
      async () => ({}),
    );
    const created = stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("deduplicated upload must not create a new row");
    });

    const result = await storeBrandAsset({
      ownerId: "owner-3",
      buffer,
      mimeType: "image/png",
    });

    assert.equal(result.assetId, "asset-existing-1");
    assert.equal(result.storageKey, storageKey);
    assert.equal(created.calls.length, 0);
    // No revival or brandId change is needed, so update is skipped entirely.
    assert.equal(updated.calls.length, 0);
  });
});

describe("storeBrandAsset — soft-deleted asset revival", () => {
  it("clears deletedAt and links the brandId when reviving a soft-deleted asset", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => ({
      id: "asset-revived-1",
      storageKey: "owner-4/deleted.png",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
      brandId: null,
    }));
    const updated = stubPrismaMethod(
      t,
      prisma.asset,
      "update",
      async (args) => {
        const { where, data } = args as {
          where: { id: string };
          data: { deletedAt?: null; brandId?: string };
        };
        assert.equal(where.id, "asset-revived-1");
        assert.equal(data.deletedAt, null);
        assert.equal(data.brandId, "brand-new");
        return {};
      },
    );
    const created = stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("revival must not create a new row");
    });

    const result = await storeBrandAsset({
      ownerId: "owner-4",
      buffer: Buffer.from("revived-bytes"),
      mimeType: "image/png",
      brandId: "brand-new",
    });

    assert.equal(result.assetId, "asset-revived-1");
    assert.equal(updated.calls.length, 1);
    assert.equal(created.calls.length, 0);
  });

  it("skips the update call when the existing asset is already live and unlinked", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => ({
      id: "asset-live-1",
      storageKey: "owner-5/live.png",
      deletedAt: null,
      brandId: null,
    }));
    const updated = stubPrismaMethod(
      t,
      prisma.asset,
      "update",
      async () => ({}),
    );

    const result = await storeBrandAsset({
      ownerId: "owner-5",
      buffer: Buffer.from("live-bytes"),
      mimeType: "image/png",
    });

    assert.equal(result.assetId, "asset-live-1");
    assert.equal(updated.calls.length, 0);
  });
});

describe("storeBrandAsset — P2002 race recovery", () => {
  it("recovers the winning row when two uploads race to create the same asset", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    stubPrismaMethod(t, prisma.asset, "create", async () => {
      const error = new Error("Unique constraint failed") as Error & {
        code: string;
      };
      error.code = "P2002";
      throw error;
    });

    // storeAssetWithUpsert calls findExisting (findUnique) before create and
    // findAfterConflict (also findUnique) after the P2002 race; return the
    // winner only on the second call.
    let findUniqueCalls = 0;
    stubPrismaMethod(t, prisma.asset, "findUnique", async () => {
      findUniqueCalls += 1;
      if (findUniqueCalls === 1) return null;
      return { id: "asset-race-winner" };
    });

    const result = await storeBrandAsset({
      ownerId: "owner-6",
      buffer: Buffer.from("racing-bytes"),
      mimeType: "image/png",
    });

    assert.equal(result.assetId, "asset-race-winner");
  });
});

describe("storeBrandAsset — explicit error propagation", () => {
  it("propagates a non-P2002 create failure instead of swallowing it", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("Database connection lost");
    });

    await assert.rejects(
      storeBrandAsset({
        ownerId: "owner-7",
        buffer: Buffer.from("failing-bytes"),
        mimeType: "image/png",
      }),
      (err: Error) => {
        assert.match(err.message, /Database connection lost/);
        return true;
      },
    );
  });

  it("propagates storage adapter write failures", async (t) => {
    setBrandStorageAdapter({
      async store() {
        throw new Error("Disk full");
      },
      urlFor: (key: string) => `/api/brand-assets/${key}`,
      async read() {
        return Buffer.from("");
      },
      async delete() {},
    });
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => {
      throw new Error("findUnique should not run before the storage write");
    });

    await assert.rejects(
      storeBrandAsset({
        ownerId: "owner-8",
        buffer: Buffer.from("bytes"),
        mimeType: "image/png",
      }),
      /Disk full/,
    );
  });
});

describe("storeBrandAsset — protected URL and extension identity", () => {
  it("derives an owner-partitioned, MIME-extension storage key and matching protected URL", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    let idCounter = 0;
    stubPrismaMethod(t, prisma.asset, "create", async () => {
      idCounter += 1;
      return { id: `asset-ext-${idCounter}` };
    });

    const cases: Array<{ mimeType: string; ext: string }> = [
      { mimeType: "image/png", ext: "png" },
      { mimeType: "font/woff2", ext: "woff2" },
      { mimeType: "font/ttf", ext: "ttf" },
    ];

    for (const { mimeType, ext } of cases) {
      const buffer = Buffer.from(`bytes-for-${mimeType}`);
      const checksum = calculateAssetChecksum(buffer);
      const result = await storeBrandAsset({
        ownerId: "owner-9",
        buffer,
        mimeType,
      });
      assert.equal(result.storageKey, `owner-9/${checksum}.${ext}`);
      assert.equal(result.url, `/api/brand-assets/owner-9/${checksum}.${ext}`);
    }
  });

  it("falls back to the .bin extension for an unmapped MIME type", async (t) => {
    setBrandStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetBrandStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findUnique", async () => null);
    stubPrismaMethod(t, prisma.asset, "create", async () => ({
      id: "asset-bin-1",
    }));

    const buffer = Buffer.from("unmapped-bytes");
    const checksum = calculateAssetChecksum(buffer);
    const result = await storeBrandAsset({
      ownerId: "owner-10",
      buffer,
      mimeType: "application/x-unmapped",
    });

    assert.equal(result.storageKey, `owner-10/${checksum}.bin`);
  });
});
