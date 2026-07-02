/**
 * Missing asset and font handling tests (Epic #379, issue #417).
 *
 * Covers:
 *  - Editor/present fallback for unresolvable assetId (MISSING_ASSET_PLACEHOLDER).
 *  - Export behavior for missing image assets.
 *  - Missing optional fonts do not crash render.
 *  - buildDeckSpecs (pure export transform) handles missing image elements gracefully.
 *
 * All tests are pure/headless — no DOM, no browser APIs, no Prisma.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  Deck,
  ImageElement,
  Slide,
  SlideElement,
  TextElement,
  TextElementStyle,
} from "../document/deck-kernel/deck";
import {
  ClientAssetResolver,
  MISSING_ASSET_PLACEHOLDER,
  ServerAssetResolver,
  effectiveImageUrl,
  resolveAssetSync,
  type AssetResolverDb,
  type AssetResolverStorage,
} from "@/lib/slides/asset-resolver";
import { buildDeckSpecs } from "../document/deck-kernel/export/deck-export";
import {
  fatalDiagnostics,
  runExportPreflight,
} from "@/lib/visual/export-preflight";
import { buildSlide, makeMinimalDeck } from "@/test/builders/deck";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const makeSlide = (
  elements: SlideElement[],
  overrides: Partial<Slide> = {},
): Slide =>
  buildSlide({
    id: "s1",
    title: "",
    layout: "blank",
    bullets: [],
    notes: "",
    elements,
    ...overrides,
  });

const makeDeck = (slides: Slide[]): Deck => makeMinimalDeck(slides);

type ImageFixtureOverrides = Partial<ImageElement> & {
  src?: string;
  assetId?: string;
};

function imageEl(overrides: ImageFixtureOverrides = {}): ImageElement {
  const { src, assetId, ...elementOverrides } = overrides;
  return {
    id: "img-1",
    kind: "image",
    role: "image",
    box: { x: 10, y: 10, w: 30, h: 20 },
    zIndex: 1,
    content: {
      kind: "image",
      src: src ?? overrides.content?.src ?? "data:image/png;base64,abc",
      ...(assetId !== undefined ? { assetId } : {}),
    },
    ...elementOverrides,
  } as ImageElement;
}

type TextFixtureOverrides = Partial<TextElement> & {
  text?: string;
  paragraphs?: TextElement["content"]["paragraphs"];
  style?: Partial<TextElementStyle>;
};

function textEl(overrides: TextFixtureOverrides = {}): TextElement {
  const text = overrides.text ?? overrides.content?.text ?? "Slide title";
  return {
    id: "txt-1",
    kind: "text",
    role: "title",
    box: { x: 5, y: 5, w: 90, h: 15 },
    zIndex: 0,
    content: {
      kind: "text",
      text,
      paragraphs: overrides.paragraphs ?? [{ text }],
    },
    designOverrides: {
      textStyle: overrides.style ?? {
        fontSize: 5,
        bold: false,
        italic: false,
        align: "left",
      },
    },
    ...overrides,
  } as TextElement;
}

function bulletsEl(
  overrides: Parameters<
    typeof import("@/test/builders/deck").buildBulletsElement
  >[0] = {},
): TextElement {
  return {
    id: "bul-1",
    kind: "text",
    role: "bullet",
    box: { x: 5, y: 25, w: 90, h: 60 },
    zIndex: 0,
    content: {
      kind: "text",
      text: "Point one\nPoint two",
      paragraphs: [
        { text: "Point one", listType: "bullet" },
        { text: "Point two", listType: "bullet" },
      ],
    },
    designOverrides: {
      textStyle: { fontSize: 4, bold: false, italic: false, align: "left" },
    },
    ...overrides,
  } as TextElement;
}

// ---------------------------------------------------------------------------
// Stub DB and storage for ServerAssetResolver
// ---------------------------------------------------------------------------

function makeDb(
  row: { storageKey: string; mimeType: string; deletedAt: Date | null } | null,
): AssetResolverDb {
  return {
    asset: {
      async findUnique() {
        return row;
      },
    },
  };
}

function makeStorage(
  baseUrl = "https://cdn.example.com",
): AssetResolverStorage {
  return { urlFor: (key: string) => `${baseUrl}/${key}` };
}

// ---------------------------------------------------------------------------
// #417-A: Editor/present fallback for unresolvable assetId
// ---------------------------------------------------------------------------

describe("editor/present fallback for unresolvable assetId", () => {
  test("ClientAssetResolver: assetId with empty fallbackUrl → status missing", async () => {
    const resolver = new ClientAssetResolver();
    const result = await resolver.resolve({ assetId: "asset-uuid-missing" });
    assert.equal(result.status, "missing");
    assert.equal(result.url, undefined);
  });

  test("ClientAssetResolver: assetId with fallbackUrl → status loaded (cached URL)", async () => {
    const resolver = new ClientAssetResolver();
    const result = await resolver.resolve({
      assetId: "asset-uuid-1",
      fallbackUrl: "/slide-assets/doc/file.png",
    });
    assert.equal(result.status, "loaded");
    assert.equal(result.url, "/slide-assets/doc/file.png");
  });

  test("effectiveImageUrl returns MISSING_ASSET_PLACEHOLDER for missing status", () => {
    const url = effectiveImageUrl({ status: "missing", url: undefined });
    assert.equal(url, MISSING_ASSET_PLACEHOLDER);
  });

  test("effectiveImageUrl returns MISSING_ASSET_PLACEHOLDER for denied status", () => {
    const url = effectiveImageUrl({ status: "denied", url: undefined });
    assert.equal(url, MISSING_ASSET_PLACEHOLDER);
  });

  test("effectiveImageUrl returns actual URL for loaded status", () => {
    const url = effectiveImageUrl({
      status: "loaded",
      url: "https://cdn.example.com/img.png",
    });
    assert.equal(url, "https://cdn.example.com/img.png");
  });

  test("MISSING_ASSET_PLACEHOLDER is a valid SVG data URL", () => {
    assert.ok(
      MISSING_ASSET_PLACEHOLDER.startsWith("data:image/svg+xml"),
      "should be an SVG data URL",
    );
    assert.ok(
      MISSING_ASSET_PLACEHOLDER.includes("Missing image"),
      "should contain 'Missing image' label",
    );
  });

  test("resolveAssetSync: missing assetId + empty src → missing with placeholder fallback", () => {
    const resolution = resolveAssetSync({
      assetId: "orphan-asset",
      fallbackUrl: undefined,
    });
    assert.equal(resolution.status, "missing");
    // effectiveImageUrl degrades gracefully — never throws
    const displayUrl = effectiveImageUrl(resolution);
    assert.equal(displayUrl, MISSING_ASSET_PLACEHOLDER);
  });
});

// ---------------------------------------------------------------------------
// #417-B: ServerAssetResolver — export behavior for missing image assets
// ---------------------------------------------------------------------------

describe("ServerAssetResolver: export behavior for missing image assets", () => {
  test("asset row not found → status missing, no fallback URL returned", async () => {
    const resolver = new ServerAssetResolver(makeDb(null), makeStorage());
    const result = await resolver.resolve({ assetId: "nonexistent-asset" });
    assert.equal(result.status, "missing");
    assert.equal(result.url, undefined);
  });

  test("soft-deleted asset (deletedAt set) → status missing", async () => {
    const row = {
      storageKey: "uploads/file.png",
      mimeType: "image/png",
      deletedAt: new Date(),
    };
    const resolver = new ServerAssetResolver(makeDb(row), makeStorage());
    const result = await resolver.resolve({ assetId: "deleted-asset" });
    assert.equal(result.status, "missing");
    assert.equal(result.url, undefined);
  });

  test("valid asset row → status loaded with constructed URL", async () => {
    const row = {
      storageKey: "uploads/slide-img.png",
      mimeType: "image/png",
      deletedAt: null,
    };
    const resolver = new ServerAssetResolver(makeDb(row), makeStorage());
    const result = await resolver.resolve({ assetId: "asset-ok" });
    assert.equal(result.status, "loaded");
    assert.equal(result.url, "https://cdn.example.com/uploads/slide-img.png");
    assert.equal(result.mimeType, "image/png");
  });

  test("DB error falls back to fallbackUrl when available", async () => {
    const errorDb: AssetResolverDb = {
      asset: {
        async findUnique() {
          throw new Error("DB connection failed");
        },
      },
    };
    const resolver = new ServerAssetResolver(errorDb, makeStorage());
    const result = await resolver.resolve({
      assetId: "asset-1",
      fallbackUrl: "/cached/img.png",
    });
    assert.equal(result.status, "loaded");
    assert.equal(result.url, "/cached/img.png");
  });

  test("DB error with no fallbackUrl → status missing", async () => {
    const errorDb: AssetResolverDb = {
      asset: {
        async findUnique() {
          throw new Error("DB connection failed");
        },
      },
    };
    const resolver = new ServerAssetResolver(errorDb, makeStorage());
    const result = await resolver.resolve({ assetId: "asset-1" });
    assert.equal(result.status, "missing");
    assert.equal(result.url, undefined);
  });

  test("missing asset for export: preflight reports it as fatal", () => {
    const deck = makeDeck([
      makeSlide([imageEl({ src: "", assetId: undefined })]),
    ]);
    const result = runExportPreflight(deck, { target: "pptx" });
    assert.ok(result.hasFatal, "export should be blocked for missing asset");
    assert.equal(fatalDiagnostics(result)[0].code, "missing-asset");
  });

  test("missing asset does not crash buildDeckSpecs (pure transform)", () => {
    // buildDeckSpecs itself should not throw — it produces ops without resolving
    // URLs at the pure stage.
    const el = imageEl({ src: "", assetId: undefined });
    const deck = makeDeck([makeSlide([el])]);
    assert.doesNotThrow(() => buildDeckSpecs(deck, new Map()));
  });
});

// ---------------------------------------------------------------------------
// #417-D: Missing optional fonts do not crash render
// ---------------------------------------------------------------------------

describe("missing optional fonts do not crash render", () => {
  test("buildDeckSpecs does not throw for element with unknown fontId", () => {
    const el = textEl({
      style: {
        fontId: "non-existent-font-xyz",
        fontSize: 5,
        bold: false,
        italic: false,
        align: "left",
      },
    });
    const deck = makeDeck([makeSlide([el])]);
    assert.doesNotThrow(() => buildDeckSpecs(deck, new Map()));
  });

  test("buildDeckSpecs does not throw for bullets element with missing font", () => {
    const el = bulletsEl({
      style: {
        fontId: "ghost-font-missing",
        fontSize: 4,
        bold: false,
        italic: false,
        align: "left",
      },
    });
    const deck = makeDeck([makeSlide([el])]);
    assert.doesNotThrow(() => buildDeckSpecs(deck, new Map()));
  });

  test("buildDeckSpecs does not throw for slide with no elements", () => {
    const deck = makeDeck([makeSlide([])]);
    assert.doesNotThrow(() => buildDeckSpecs(deck, new Map()));
  });

  test("buildDeckSpecs does not throw for an empty deck", () => {
    const deck = makeDeck([]);
    assert.doesNotThrow(() => buildDeckSpecs(deck, new Map()));
  });

  test("buildDeckSpecs produces text op for element with missing font (graceful output)", () => {
    const el = textEl({
      id: "txt-ghost-font",
      style: {
        fontId: "unavailable-font",
        fontSize: 5,
        bold: false,
        italic: false,
        align: "left",
      },
    });
    const deck = makeDeck([makeSlide([el])]);
    const [spec] = buildDeckSpecs(deck, new Map());
    assert.ok(spec, "should produce a slide spec");
    // The text op must appear — missing font does not suppress the element.
    const textOps = spec.ops.filter((op) => op.kind === "text");
    assert.equal(
      textOps.length,
      1,
      "text op must be present despite missing font",
    );
  });

  test("runExportPreflight never throws for any well-formed deck", () => {
    const complexDeck = makeDeck([
      makeSlide(
        [
          textEl({ id: "t1" }),
          bulletsEl({ id: "b1" }),
          imageEl({ id: "i1" }),
          imageEl({ id: "i2", src: "", assetId: undefined }),
        ],
        { id: "s1", index: 0 },
      ),
      makeSlide([], { id: "s2", index: 1 }),
    ]);
    assert.doesNotThrow(() =>
      runExportPreflight(complexDeck, {
        target: "pptx",
        customFontFamilies: new Set(["SomeFont"]),
      }),
    );
  });
});
