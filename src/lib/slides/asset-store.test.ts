/**
 * Behavioral tests for `storeSlideAsset` (#1945).
 *
 * `storeSlideAsset` is the slide-specific wrapper around the shared
 * `storeAssetWithUpsert` upsert contract (checksum dedup, P2002 race
 * recovery) — the same contract `storeBrandAsset` wraps, already covered
 * generically by `@/lib/assets/store.test.ts` and specifically by
 * `@/lib/brand/asset-store.test.ts`. These tests instead assert the
 * slide-specific wiring: the `Asset` row shape a slide upload writes
 * (mimeType/byteSize/checksum/storageKey/documentId/widthPx/heightPx/
 * originalName), the document-scoped + MIME-derived storage key identity,
 * and that dependency (storage/database) failures are not swallowed.
 *
 * Module-hook strategy: `asset-store.ts` carries `import "server-only"`
 * (throws outside a Next.js Server Component build), so this stubs that
 * specifier to an empty module before dynamically importing the module
 * under test — the same pattern used by
 * `src/lib/document-editor/loader.test.ts`. `prisma.asset` methods are then
 * replaced directly via `Object.defineProperty` (matches
 * `src/lib/brand/asset-store.test.ts`), and the storage adapter is swapped
 * via the existing `setDefaultStorageAdapter` / `resetDefaultStorageAdapter`
 * DI seam.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";

import { calculateAssetChecksum } from "@/lib/assets/store";
import { prisma } from "@/lib/prisma";
import type { SlideImageMime } from "@/lib/limits";

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;
const serverOnlyStubUrl = "server-only:slides-asset-store-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnlyStubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyStubUrl) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

type AssetStoreModule = typeof import("./asset-store");
type AssetStorageModule = typeof import("./asset-storage");

let storeSlideAsset: AssetStoreModule["storeSlideAsset"];
let setDefaultStorageAdapter: AssetStorageModule["setDefaultStorageAdapter"];
let resetDefaultStorageAdapter: AssetStorageModule["resetDefaultStorageAdapter"];

before(async () => {
  const storeMod = await import("./asset-store");
  storeSlideAsset = storeMod.storeSlideAsset;
  const storageMod = await import("./asset-storage");
  setDefaultStorageAdapter = storageMod.setDefaultStorageAdapter;
  resetDefaultStorageAdapter = storageMod.resetDefaultStorageAdapter;
});

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
      return `/api/slide-assets/${key}`;
    },
    urlFor(key: string) {
      return `/api/slide-assets/${key}`;
    },
    async read() {
      return Buffer.from("");
    },
    async delete() {},
  };
}

after(() => {
  resetDefaultStorageAdapter();
});

describe("storeSlideAsset — create path", () => {
  it("stores bytes and creates a new Asset row with the full field set", async (t) => {
    const state: MemoryAdapterState = { writes: [] };
    setDefaultStorageAdapter(memoryAdapter(state));
    t.after(resetDefaultStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findFirst", async () => null);
    const created = stubPrismaMethod(
      t,
      prisma.asset,
      "create",
      async (args) => {
        const { data } = args as {
          data: {
            documentId: string;
            mimeType: string;
            byteSize: number;
            checksum: string;
            storageKey: string;
            widthPx?: number;
            heightPx?: number;
            originalName?: string;
          };
        };
        assert.equal(data.documentId, "doc-1");
        assert.equal(data.mimeType, "image/png");
        assert.equal(
          data.byteSize,
          Buffer.from("slide-image-bytes").byteLength,
        );
        assert.equal(
          data.checksum,
          calculateAssetChecksum(Buffer.from("slide-image-bytes")),
        );
        assert.equal(data.storageKey, `doc-1/${data.checksum}.png`);
        assert.equal(data.widthPx, 800);
        assert.equal(data.heightPx, 600);
        assert.equal(data.originalName, "slide.png");
        return { id: "asset-created-1" };
      },
    );

    const result = await storeSlideAsset({
      documentId: "doc-1",
      buffer: Buffer.from("slide-image-bytes"),
      meta: {
        mimeType: "image/png",
        byteSize: Buffer.from("slide-image-bytes").byteLength,
        checksum: calculateAssetChecksum(Buffer.from("slide-image-bytes")),
        widthPx: 800,
        heightPx: 600,
        originalName: "slide.png",
      },
    });

    assert.equal(result.assetId, "asset-created-1");
    assert.equal(created.calls.length, 1);
    assert.equal(state.writes.length, 1);
    assert.equal(result.url, `/api/slide-assets/${result.storageKey}`);
  });

  it("omits widthPx/heightPx/originalName from the create payload when absent", async (t) => {
    setDefaultStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetDefaultStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findFirst", async () => null);
    const created = stubPrismaMethod(
      t,
      prisma.asset,
      "create",
      async (args) => {
        const { data } = args as { data: Record<string, unknown> };
        assert.equal("widthPx" in data, false);
        assert.equal("heightPx" in data, false);
        assert.equal("originalName" in data, false);
        return { id: "asset-created-2" };
      },
    );

    const result = await storeSlideAsset({
      documentId: "doc-2",
      buffer: Buffer.from("gif-bytes"),
      meta: {
        mimeType: "image/gif",
        byteSize: Buffer.from("gif-bytes").byteLength,
        checksum: calculateAssetChecksum(Buffer.from("gif-bytes")),
      },
    });

    assert.equal(result.assetId, "asset-created-2");
    assert.equal(created.calls.length, 1);
  });
});

describe("storeSlideAsset — checksum deduplication", () => {
  it("returns the existing asset scoped to this document without creating a duplicate row", async (t) => {
    const state: MemoryAdapterState = { writes: [] };
    setDefaultStorageAdapter(memoryAdapter(state));
    t.after(resetDefaultStorageAdapter);

    const buffer = Buffer.from("identical-slide-bytes");
    const checksum = calculateAssetChecksum(buffer);
    const storageKey = `doc-3/${checksum}.png`;

    const findFirst = stubPrismaMethod(
      t,
      prisma.asset,
      "findFirst",
      async (args) => {
        const { where } = args as {
          where: { documentId: string; checksum: string };
        };
        assert.equal(where.documentId, "doc-3");
        assert.equal(where.checksum, checksum);
        return { id: "asset-existing-1", storageKey };
      },
    );
    const created = stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("deduplicated upload must not create a new row");
    });

    const result = await storeSlideAsset({
      documentId: "doc-3",
      buffer,
      meta: {
        mimeType: "image/png",
        byteSize: buffer.byteLength,
        checksum,
      },
    });

    assert.equal(result.assetId, "asset-existing-1");
    assert.equal(result.storageKey, storageKey);
    assert.equal(created.calls.length, 0);
    assert.equal(findFirst.calls.length, 1);
  });

  it("scopes checksum lookups per document so identical bytes in another document are not returned", async (t) => {
    setDefaultStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetDefaultStorageAdapter);

    const buffer = Buffer.from("shared-bytes-across-documents");
    const checksum = calculateAssetChecksum(buffer);

    stubPrismaMethod(t, prisma.asset, "findFirst", async (args) => {
      const { where } = args as { where: { documentId: string } };
      // Simulate: the checksum exists for a different document only.
      return where.documentId === "doc-4" ? null : { id: "wrong-doc-asset" };
    });
    const created = stubPrismaMethod(t, prisma.asset, "create", async () => ({
      id: "asset-created-doc-4",
    }));

    const result = await storeSlideAsset({
      documentId: "doc-4",
      buffer,
      meta: { mimeType: "image/png", byteSize: buffer.byteLength, checksum },
    });

    assert.equal(result.assetId, "asset-created-doc-4");
    assert.equal(created.calls.length, 1);
  });
});

describe("storeSlideAsset — P2002 race recovery", () => {
  it("recovers the winning row when two uploads race to create the same asset", async (t) => {
    setDefaultStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetDefaultStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "create", async () => {
      const error = new Error("Unique constraint failed") as Error & {
        code: string;
      };
      error.code = "P2002";
      throw error;
    });

    let findFirstCalls = 0;
    stubPrismaMethod(t, prisma.asset, "findFirst", async () => {
      findFirstCalls += 1;
      if (findFirstCalls === 1) return null;
      return { id: "asset-race-winner" };
    });

    const buffer = Buffer.from("racing-slide-bytes");
    const result = await storeSlideAsset({
      documentId: "doc-5",
      buffer,
      meta: {
        mimeType: "image/png",
        byteSize: buffer.byteLength,
        checksum: calculateAssetChecksum(buffer),
      },
    });

    assert.equal(result.assetId, "asset-race-winner");
  });
});

describe("storeSlideAsset — dependency failure propagation", () => {
  it("propagates a non-P2002 create failure instead of swallowing it", async (t) => {
    setDefaultStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetDefaultStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("Database connection lost");
    });

    const buffer = Buffer.from("failing-slide-bytes");
    await assert.rejects(
      storeSlideAsset({
        documentId: "doc-6",
        buffer,
        meta: {
          mimeType: "image/png",
          byteSize: buffer.byteLength,
          checksum: calculateAssetChecksum(buffer),
        },
      }),
      (err: Error) => {
        assert.match(err.message, /Database connection lost/);
        return true;
      },
    );
  });

  it("propagates storage adapter write failures without creating an Asset row", async (t) => {
    setDefaultStorageAdapter({
      async store() {
        throw new Error("Disk full");
      },
      urlFor: (key: string) => `/api/slide-assets/${key}`,
      async read() {
        return Buffer.from("");
      },
      async delete() {},
    });
    t.after(resetDefaultStorageAdapter);

    // Unlike the brand asset store, slides assets look up an existing row
    // *before* writing bytes (no `storeBeforeFind`), so `findFirst` still
    // runs; only `create` must never be reached once the storage write fails.
    stubPrismaMethod(t, prisma.asset, "findFirst", async () => null);
    const created = stubPrismaMethod(t, prisma.asset, "create", async () => {
      throw new Error("create should not run after the storage write fails");
    });

    const buffer = Buffer.from("bytes");
    await assert.rejects(
      storeSlideAsset({
        documentId: "doc-7",
        buffer,
        meta: {
          mimeType: "image/png",
          byteSize: buffer.byteLength,
          checksum: calculateAssetChecksum(buffer),
        },
      }),
      /Disk full/,
    );
    assert.equal(created.calls.length, 0);
  });
});

describe("storeSlideAsset — document-scoped storage key identity", () => {
  it("derives a document-partitioned, MIME-extension storage key and matching URL", async (t) => {
    setDefaultStorageAdapter(memoryAdapter({ writes: [] }));
    t.after(resetDefaultStorageAdapter);

    stubPrismaMethod(t, prisma.asset, "findFirst", async () => null);
    let idCounter = 0;
    stubPrismaMethod(t, prisma.asset, "create", async () => {
      idCounter += 1;
      return { id: `asset-ext-${idCounter}` };
    });

    const cases: Array<{ mimeType: SlideImageMime; ext: string }> = [
      { mimeType: "image/png", ext: "png" },
      { mimeType: "image/jpeg", ext: "jpg" },
      { mimeType: "image/gif", ext: "gif" },
      { mimeType: "image/webp", ext: "webp" },
    ];

    for (const { mimeType, ext } of cases) {
      const buffer = Buffer.from(`bytes-for-${mimeType}`);
      const checksum = calculateAssetChecksum(buffer);
      const result = await storeSlideAsset({
        documentId: "doc-8",
        buffer,
        meta: { mimeType, byteSize: buffer.byteLength, checksum },
      });
      assert.equal(result.storageKey, `doc-8/${checksum}.${ext}`);
      assert.equal(result.url, `/api/slide-assets/doc-8/${checksum}.${ext}`);
    }
  });
});
