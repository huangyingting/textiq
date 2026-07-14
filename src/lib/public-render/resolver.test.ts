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

  assert.equal(metadata.id, undefined);
  assert.equal(metadata.contentJson, true);
  assert.equal(metadata.slug, true);
  assert.equal(metadata.deckJson, undefined);
  assert.equal(metadata.owner, undefined);

  assert.equal(document.id, true);
  assert.equal(document.contentJson, true);
  assert.equal(document.deckJson, undefined);
  assert.notEqual(document.owner, undefined);

  assert.equal(presentation.id, true);
  assert.equal(presentation.contentJson, true);
  assert.equal(presentation.deckJson, true);
  assert.notEqual(presentation.owner, undefined);
});

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

function baseShareFields(overrides: Record<string, unknown> = {}) {
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
  };
}

function metadataRow(overrides: Record<string, unknown> = {}) {
  return {
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    slug: "shared-doc",
    ...baseShareFields(),
    ...overrides,
  };
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    owner: { name: null, plan: "free" },
    ...baseShareFields(),
    ...overrides,
  };
}

function presentationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Shared Doc",
    contentJson: { root: { children: [] } },
    deckJson: null,
    owner: { name: null, plan: "free" },
    ...baseShareFields(),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.__publicRenderTestThemeResult = { packages: [], diagnostics: [] };
  globalThis.__publicRenderTestThemeCalls = [];
});

describe("resolvePublicRender", () => {
  it("queries prisma.document.findFirst scoped by shareId with metadata select", async (t) => {
    const findFirst = trackedCalls(async () => metadataRow());
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

  it("queries prisma.document.findFirst scoped by shareId with document select", async (t) => {
    const findFirst = trackedCalls(async () => documentRow());
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });

    await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "document",
    });

    assert.equal(findFirst.calls.length, 1);
    const [args] = findFirst.calls[0] as [
      { where: { shareId: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { shareId: "share123" });
    assert.deepEqual(args.select, PUBLIC_RENDER_DOCUMENT_SELECT);
  });

  it("queries prisma.document.findFirst scoped by shareId with presentation select", async (t) => {
    const findFirst = trackedCalls(async () => presentationRow());
    replacePrismaProperty(t, "document", { findFirst: findFirst.fn });

    await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "present",
      projection: "presentation",
    });

    assert.equal(findFirst.calls.length, 1);
    const [args] = findFirst.calls[0] as [
      { where: { shareId: string }; select: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { shareId: "share123" });
    assert.deepEqual(args.select, PUBLIC_RENDER_PRESENTATION_SELECT);
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
      findFirst: async () => metadataRow(),
    });

    const result = await resolvePublicRender({
      params: { shareId: "shared-doc-share123" },
      mode: "view",
      projection: "metadata",
    });

    assert.equal(result.ok, true);
    assert.equal(globalThis.__publicRenderTestThemeCalls.length, 0);
  });

  it("loads and merges custom theme packages onto the presentation row", async (t) => {
    const customPackage = buildMinimalThemePackage("custom-theme-xyz");
    const deck = buildDeck(undefined, {
      theme: buildThemeBinding({ packageId: "custom-theme-xyz" }),
    });
    const deckJson = JSON.parse(JSON.stringify(deck));
    replacePrismaProperty(t, "document", {
      findFirst: async () =>
        presentationRow({
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
      assert.equal(result.presentation.themePackage.id, "custom-theme-xyz");
    } else {
      assert.fail("expected a successful presentation projection result");
    }
  });
});
