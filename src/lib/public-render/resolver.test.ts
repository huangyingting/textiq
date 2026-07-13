import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  before,
  beforeEach,
  describe,
  it,
  test,
  type TestContext,
} from "node:test";

import {
  PUBLIC_RENDER_ASSET_ACCESS_SELECT,
  PUBLIC_RENDER_DOCUMENT_SELECT,
  PUBLIC_RENDER_METADATA_SELECT,
  PUBLIC_RENDER_PRESENTATION_SELECT,
} from "@/lib/public-render/resolver-selects";
import { prisma } from "@/lib/prisma";
import {
  buildDeck,
  buildMinimalThemePackage,
  buildThemeBinding,
} from "@/test/builders/presentation-deck";

test("public render selects are projection-specific", () => {
  const metadata = PUBLIC_RENDER_METADATA_SELECT as Record<string, unknown>;
  const document = PUBLIC_RENDER_DOCUMENT_SELECT as Record<string, unknown>;
  const presentation = PUBLIC_RENDER_PRESENTATION_SELECT as Record<
    string,
    unknown
  >;
  const assetAccess = PUBLIC_RENDER_ASSET_ACCESS_SELECT as Record<
    string,
    unknown
  >;

  assert.equal(metadata.contentJson, true);
  assert.equal(metadata.content, undefined);
  assert.equal(metadata.deckJson, undefined);
  assert.equal(metadata.owner, undefined);

  assert.equal(document.contentJson, true);
  assert.equal(document.content, undefined);
  assert.equal(document.deckJson, undefined);
  assert.notEqual(document.owner, undefined);

  assert.equal(presentation.contentJson, true);
  assert.equal(presentation.deckJson, true);
  assert.equal(presentation.content, undefined);

  assert.equal(assetAccess.ownerId, true);
  assert.equal(assetAccess.workspaceId, true);
  assert.equal(assetAccess.content, undefined);
  assert.equal(assetAccess.contentJson, undefined);
  assert.equal(assetAccess.deckJson, undefined);
  assert.equal(assetAccess.owner, undefined);
});

/**
 * Direct contracts for `resolvePublicRender` (#1945).
 *
 * The tests above only cover `resolver-selects.ts`'s projection-specific
 * select shapes, and `resolver-core.test.ts` covers
 * `resolvePublicRenderWithSource`'s pure decision logic against a fake
 * `PublicRenderSource`. This block instead covers `resolver.ts` itself: the
 * thin prisma-backed `PublicRenderSource` implementation, specifically that
 * `findByShareId` queries `prisma.document.findFirst` scoped by `shareId`
 * with the projection-specific select, that a missing document short-circuits
 * without ever calling the custom-theme-package loader, that the theme-package
 * loader only runs for the `"presentation"` projection (and its result is
 * merged onto the returned row), and that `findByDocumentId` queries
 * `prisma.document.findUnique` by id with the fixed asset-access select.
 *
 * `resolver.ts` imports `server-only` (throws outside a Server Component
 * build) and `@/lib/presentation/brand-kit/persistence`
 * (`loadCustomThemePackagesForDeckJson`, which issues its own unrelated
 * brand-kit/DB queries). Following the module-hooks pattern already used by
 * `src/lib/document-editor/loader.test.ts`, this stubs those two specifiers;
 * `prisma.document.findFirst`/`findUnique` are monkey-patched directly (the
 * two prisma calls the resolver itself issues).
 */
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

declare global {
  var __publicRenderTestThemeResult: {
    packages: { id: string }[];
    diagnostics: unknown[];
  };
  var __publicRenderTestThemeCalls: unknown[][];
}

globalThis.__publicRenderTestThemeResult = { packages: [], diagnostics: [] };
globalThis.__publicRenderTestThemeCalls = [];

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const SERVER_ONLY_STUB = "server-only:public-render-resolver-test";
const BRAND_KIT_PERSISTENCE_STUB =
  "lib-brand-kit-persistence:public-render-resolver-test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: SERVER_ONLY_STUB, shortCircuit: true };
    }
    if (specifier === "@/lib/presentation/brand-kit/persistence") {
      return { url: BRAND_KIT_PERSISTENCE_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === SERVER_ONLY_STUB) {
      return { format: "commonjs", source: "", shortCircuit: true };
    }
    if (url === BRAND_KIT_PERSISTENCE_STUB) {
      return {
        format: "commonjs" as const,
        source: `module.exports = {
  loadCustomThemePackagesForDeckJson: async (deckJson) => {
    globalThis.__publicRenderTestThemeCalls.push([deckJson]);
    return globalThis.__publicRenderTestThemeResult;
  },
};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type ResolverModule = typeof import("./resolver");
let resolvePublicRender: ResolverModule["resolvePublicRender"];

before(async () => {
  const mod = await import("./resolver");
  resolvePublicRender = mod.resolvePublicRender;
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

function baseShareRow(overrides: Record<string, unknown> = {}) {
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
    sharePasscodeHash: null,
    shareMetadataMode: "generic",
    shareDiscoverable: false,
    owner: { name: null, plan: "free" },
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.__publicRenderTestThemeResult = { packages: [], diagnostics: [] };
  globalThis.__publicRenderTestThemeCalls = [];
});

describe("resolvePublicRender", () => {
  it("queries prisma.document.findFirst scoped by shareId with the projection-specific select", async (t) => {
    const findFirst = trackedCalls(async () => baseShareRow());
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });

    await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "metadata",
    });

    assert.equal(findFirst.calls.length, 1);
    const [args] = findFirst.calls[0] as [
      { where: { shareId: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { shareId: "share123" });
    assert.deepEqual(args.select, PUBLIC_RENDER_METADATA_SELECT);
  });

  it("short-circuits to a not-found result without ever calling the theme-package loader", async (t) => {
    const findFirst = trackedCalls(async () => null);
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });

    const result = await resolvePublicRender({
      params: { shareId: "missing-share" },
      mode: "view",
      projection: "metadata",
    });

    assert.equal(result.ok, false);
    assert.equal(globalThis.__publicRenderTestThemeCalls.length, 0);
  });

  it("skips the theme-package loader entirely for non-presentation projections", async (t) => {
    replacePrismaProperty(t, "document", {
      findFirst: async () => baseShareRow({ deckJson: { some: "deck" } }),
    });

    const result = await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "metadata",
    });

    assert.equal(result.ok, true);
    assert.equal(globalThis.__publicRenderTestThemeCalls.length, 0);
  });

  it("loads and merges custom theme packages onto the row only for the presentation projection", async (t) => {
    // A deck whose theme references a package id that does NOT exist in the
    // built-in registry — resolving it to the real, non-fallback custom
    // package therefore proves the loader's result was genuinely threaded
    // through to `buildPublicPresentationModel`'s theme resolution, not just
    // invoked and discarded.
    const customPackage = buildMinimalThemePackage("custom-theme-xyz");
    const deck = buildDeck(undefined, {
      theme: buildThemeBinding({ packageId: "custom-theme-xyz" }),
    });
    const deckJson = JSON.parse(JSON.stringify(deck));
    replacePrismaProperty(t, "document", {
      findFirst: async () =>
        baseShareRow({
          deckJson,
          sharePresentEnabled: true,
        }),
    });
    globalThis.__publicRenderTestThemeResult = {
      packages: [customPackage],
      diagnostics: [],
    };

    const result = await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "present",
      projection: "presentation",
    });

    assert.equal(globalThis.__publicRenderTestThemeCalls.length, 1);
    assert.deepEqual(globalThis.__publicRenderTestThemeCalls[0], [deckJson]);
    assert.equal(result.ok, true);
    if (result.ok && result.projection === "presentation") {
      // A "neutral"/fallback package here would mean the merge never reached
      // the theme resolver — this proves the custom package was applied.
      assert.equal(result.presentation.themePackage.id, "custom-theme-xyz");
    } else {
      assert.fail("expected a successful presentation projection result");
    }
  });

  it("queries prisma.document.findUnique by id with the fixed asset-access select for asset-mode requests", async (t) => {
    const findUnique = trackedCalls(async () =>
      baseShareRow({
        ownerId: "owner-9",
        workspaceId: "ws-1",
        workspace: { ownerId: "owner-9", members: [] },
      }),
    );
    replacePrismaProperty(t, "document", { findUnique: findUnique.fn });

    await resolvePublicRender({
      params: {
        documentId: "doc-9",
        shareId: "shared-doc-share123",
        shareMode: "present",
      },
      mode: "asset",
      projection: "assetAccess",
    });

    assert.equal(findUnique.calls.length, 1);
    const [args] = findUnique.calls[0] as [
      { where: { id: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { id: "doc-9" });
    assert.deepEqual(args.select, PUBLIC_RENDER_ASSET_ACCESS_SELECT);
  });

  it("skips the document lookup entirely when the asset request supplies no documentId", async (t) => {
    const findUnique = trackedCalls(async () => {
      throw new Error(
        "document.findUnique should not run without a documentId",
      );
    });
    replacePrismaProperty(t, "document", { findUnique: findUnique.fn });

    const result = await resolvePublicRender({
      params: { shareId: "shared-doc-share123", shareMode: "present" },
      mode: "asset",
      projection: "assetAccess",
    });

    assert.equal(findUnique.calls.length, 0);
    assert.equal(result.ok, false);
  });
});
