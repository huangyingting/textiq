/**
 * Direct contracts for `loadBrandStudioViewModel` (#1945).
 *
 * Covers the loader's wiring: that it scopes the brand lookup to the acting
 * owner ordered by creation time, resolves entitlements from the SAME user's
 * plan (not a hardcoded default), hands rows through the real
 * `serializeBrands` (asset-id → display-url resolution, including the
 * batched `prisma.asset.findMany` call and de-duplication across shared
 * logo/font asset ids), and reflects the real per-plan `brandStyles`/
 * `fontUpload` entitlement gates in the assembled view model.
 *
 * `loader.ts` imports `server-only`, which throws outside a Server Component
 * build. Following the module-hooks pattern already used by
 * `src/lib/document-editor/loader.test.ts`, this stubs that specifier to an
 * empty module before dynamically importing `./loader`. All prisma calls
 * (`brand.findMany`, `asset.findMany`, `user.findUnique`) are monkey-patched
 * directly, mirroring `src/lib/brand/asset-store.test.ts` and
 * `src/lib/slides/asset-store.test.ts`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, it, type TestContext } from "node:test";

import { prisma } from "@/lib/prisma";

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
const serverOnlyStubUrl = "server-only:brand-studio-loader-test";

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

type LoaderModule = typeof import("./loader");
let loadBrandStudioViewModel: LoaderModule["loadBrandStudioViewModel"];

before(async () => {
  const mod = await import("./loader");
  loadBrandStudioViewModel = mod.loadBrandStudioViewModel;
});

function mutablePrisma(): Record<string, unknown> {
  return prisma as unknown as Record<string, unknown>;
}

function replacePrismaProperty(t: TestContext, key: string, value: unknown) {
  const target = mutablePrisma();
  const original = target[key];
  target[key] = value;
  t.after(() => {
    target[key] = original;
  });
}

function trackedCalls<T>(implementation: (...args: unknown[]) => T): {
  fn: (...args: unknown[]) => T;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args);
      return implementation(...args);
    },
  };
}

function baseBrandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "brand-1",
    name: "Acme",
    ownerId: "user-1",
    palette: ["#000000", "#ffffff"],
    background: "#ffffff",
    nodeFill: "#111111",
    nodeStroke: "#222222",
    nodeText: "#333333",
    edgeColor: "#444444",
    fontFamily: "Inter",
    logoAssetId: null,
    fontAssetId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

describe("loadBrandStudioViewModel", () => {
  it("scopes the brand lookup to the acting owner, ordered by creation time", async (t) => {
    const findMany = trackedCalls(async () => []);
    replacePrismaProperty(t, "brand", { findMany: findMany.fn });
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ plan: "free" }),
    });

    await loadBrandStudioViewModel("user-7");

    assert.equal(findMany.calls.length, 1);
    const [args] = findMany.calls[0] as [
      {
        where: { ownerId: string };
        orderBy: { createdAt: string };
        select: Record<string, unknown>;
      },
    ];
    assert.deepEqual(args.where, { ownerId: "user-7" });
    assert.deepEqual(args.orderBy, { createdAt: "asc" });
    for (const key of [
      "id",
      "name",
      "ownerId",
      "palette",
      "logoAssetId",
      "fontAssetId",
      "createdAt",
      "updatedAt",
    ]) {
      assert.equal(
        key in args.select,
        true,
        `expected select to request "${key}"`,
      );
    }
  });

  it("resolves entitlements from the SAME acting user, not a hardcoded default", async (t) => {
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    const findUniqueUser = trackedCalls(async () => ({ plan: "pro" }));
    replacePrismaProperty(t, "user", { findUnique: findUniqueUser.fn });

    const viewModel = await loadBrandStudioViewModel("user-9");

    assert.equal(findUniqueUser.calls.length, 1);
    const [args] = findUniqueUser.calls[0] as [{ where: { id: string } }];
    assert.deepEqual(args.where, { id: "user-9" });
    // pro plan => both brand entitlement gates open.
    assert.equal(viewModel.canUseBrandStyles, true);
    assert.equal(viewModel.canUploadFont, true);
  });

  it("reflects the free-plan entitlement gates as closed when the user has no elevated plan", async (t) => {
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ plan: "free" }),
    });

    const viewModel = await loadBrandStudioViewModel("user-1");

    assert.equal(viewModel.canUseBrandStyles, false);
    assert.equal(viewModel.canUploadFont, false);
  });

  it("reflects the plus-plan split gate: brand styles allowed, font upload still closed", async (t) => {
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ plan: "plus" }),
    });

    const viewModel = await loadBrandStudioViewModel("user-1");

    assert.equal(viewModel.canUseBrandStyles, true);
    assert.equal(viewModel.canUploadFont, false);
  });

  it("defaults to the free plan's closed gates when the user row is missing", async (t) => {
    replacePrismaProperty(t, "brand", { findMany: async () => [] });
    replacePrismaProperty(t, "user", { findUnique: async () => null });

    const viewModel = await loadBrandStudioViewModel("ghost-user");

    assert.equal(viewModel.canUseBrandStyles, false);
    assert.equal(viewModel.canUploadFont, false);
  });

  it("serializes brand rows through a single de-duplicated batched asset lookup", async (t) => {
    const rows = [
      baseBrandRow({
        id: "brand-1",
        logoAssetId: "asset-logo",
        fontAssetId: "asset-font",
      }),
      baseBrandRow({
        id: "brand-2",
        name: "Shared Logo Brand",
        // Shares the same logo asset id as brand-1 — must be de-duplicated
        // into a single prisma.asset.findMany `in` filter entry.
        logoAssetId: "asset-logo",
        fontAssetId: null,
      }),
    ];
    replacePrismaProperty(t, "brand", { findMany: async () => rows });
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ plan: "pro" }),
    });
    const assetFindMany = trackedCalls(async () => [
      { id: "asset-logo", storageKey: "user-1/logo-checksum.png" },
      { id: "asset-font", storageKey: "user-1/font-checksum.woff2" },
    ]);
    replacePrismaProperty(t, "asset", { findMany: assetFindMany.fn });

    const viewModel = await loadBrandStudioViewModel("user-1");

    assert.equal(assetFindMany.calls.length, 1);
    const [args] = assetFindMany.calls[0] as [
      { where: { id: { in: string[] }; deletedAt: null } },
    ];
    // Exactly two unique asset ids requested, despite two brands referencing
    // "asset-logo" and one 3-reference total across both rows.
    assert.deepEqual(
      new Set(args.where.id.in),
      new Set(["asset-logo", "asset-font"]),
    );
    assert.equal(args.where.id.in.length, 2);

    assert.equal(viewModel.brands.length, 2);
    const [brand1, brand2] = viewModel.brands;
    assert.ok(brand1.logoAssetUrl?.includes("logo-checksum"));
    assert.ok(brand1.fontAssetUrl?.includes("font-checksum"));
    assert.ok(brand2.logoAssetUrl?.includes("logo-checksum"));
    assert.equal(brand2.fontAssetUrl, null);
    // Dates are serialized to ISO strings by the real serializeBrands.
    assert.equal(brand1.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(brand1.updatedAt, "2026-01-02T00:00:00.000Z");
  });

  it("skips the asset lookup entirely when no brand references a logo or font asset", async (t) => {
    replacePrismaProperty(t, "brand", {
      findMany: async () => [
        baseBrandRow({ logoAssetId: null, fontAssetId: null }),
      ],
    });
    replacePrismaProperty(t, "user", {
      findUnique: async () => ({ plan: "free" }),
    });
    const assetFindMany = trackedCalls(async () => {
      throw new Error(
        "asset.findMany should not run when no brand references an asset",
      );
    });
    replacePrismaProperty(t, "asset", { findMany: assetFindMany.fn });

    const viewModel = await loadBrandStudioViewModel("user-1");

    assert.equal(assetFindMany.calls.length, 0);
    assert.equal(viewModel.brands[0]?.logoAssetUrl, null);
    assert.equal(viewModel.brands[0]?.fontAssetUrl, null);
  });
});
