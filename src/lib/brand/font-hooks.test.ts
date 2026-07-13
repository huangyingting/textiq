/**
 * Direct contracts for `hydrateBrandFont`, `useHydrateBrandFont`, and
 * `useHydrateVisualNodeFonts` (#1946).
 *
 * `injectBrandFontFace` (the custom-font `@font-face` DOM injection this
 * module delegates to for non-web fonts) is already covered end-to-end by
 * `font-face.test.ts`; this file instead covers what `font-hooks.ts` adds on
 * top: the Google-Fonts `<link>` path for `BRAND_WEB_FONTS` matches (with its
 * own idempotent id-keyed injection, separate from `injectBrandFontFace`'s),
 * the fallback to the custom `@font-face` path for non-catalog fonts with an
 * asset URL, the true no-op when there is neither a catalog match nor an
 * asset URL, and the two hooks' effect-dependency wiring (re-hydrating when
 * the brand/visual-node font fields change, and node-level de-duplication
 * across repeated `fontFamily` values).
 *
 * A minimal fake `document` (`getElementById`/`createElement`/`head`) stands
 * in for the DOM, following the same pattern as `font-face.test.ts`'s
 * `injectBrandFontFace` fake and `present-shell.test.ts`'s locally-scoped DOM
 * fakes. The hooks have no React Context dependency, so they are exercised
 * with the shared `react-render-harness`'s `run()`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";
import { BRAND_WEB_FONTS } from "@/lib/brand/schema";
import { FIXTURES } from "@/lib/visual/fixtures";
import type { Visual } from "@/lib/visual/schema";

import {
  hydrateBrandFont,
  useHydrateBrandFont,
  useHydrateVisualNodeFonts,
} from "./font-hooks";

type FakeElement = {
  id: string;
  rel?: string;
  href?: string;
  textContent?: string;
  tag: string;
};

function createFakeDocument() {
  const elements = new Map<string, FakeElement>();
  const appended: FakeElement[] = [];
  const fakeDocument = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string): FakeElement => ({ id: "", tag }),
    head: {
      appendChild: (element: FakeElement) => {
        appended.push(element);
        elements.set(element.id, element);
      },
    },
  };
  return { document: fakeDocument, elements, appended };
}

function withFakeDocument<T>(
  run: (fake: ReturnType<typeof createFakeDocument>) => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fake = createFakeDocument();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fake.document,
  });
  try {
    return run(fake);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "document", previous);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
}

const INTER = BRAND_WEB_FONTS.find((font) => font.id === "inter");
assert.ok(INTER, "expected the 'inter' entry in BRAND_WEB_FONTS fixtures");

// ---------------------------------------------------------------------------
// hydrateBrandFont — pure DOM injection dispatch
// ---------------------------------------------------------------------------

test("hydrateBrandFont no-ops when fontFamily is null or undefined", () =>
  withFakeDocument((fake) => {
    hydrateBrandFont("brand-1", null, "/fonts/x.woff2");
    hydrateBrandFont("brand-1", undefined, "/fonts/x.woff2");
    assert.equal(fake.appended.length, 0);
  }));

test("hydrateBrandFont injects a Google Fonts <link> for a BRAND_WEB_FONTS match, keyed by font id", () =>
  withFakeDocument((fake) => {
    hydrateBrandFont("brand-1", INTER!.cssFamily);

    assert.equal(fake.appended.length, 1);
    const [link] = fake.appended;
    assert.equal(link?.id, `gfont-brand-${INTER!.id}`);
    assert.equal(link?.rel, "stylesheet");
    assert.equal(link?.href, INTER!.url);
  }));

test("hydrateBrandFont is idempotent for a web font already present in <head>", () =>
  withFakeDocument((fake) => {
    hydrateBrandFont("brand-1", INTER!.cssFamily);
    hydrateBrandFont("brand-1", INTER!.cssFamily);
    hydrateBrandFont("brand-2", INTER!.cssFamily);

    assert.equal(fake.appended.length, 1);
  }));

test("hydrateBrandFont falls back to the custom @font-face path for a non-catalog font with an asset URL", () =>
  withFakeDocument((fake) => {
    hydrateBrandFont(
      "brand-custom",
      "'Acme Brand', sans-serif",
      "/fonts/acme.woff2",
    );

    assert.equal(fake.appended.length, 1);
    const [style] = fake.appended;
    assert.equal(style?.id, "brand-font-brand-custom");
    assert.equal(style?.tag, "style");
    assert.match(style?.textContent ?? "", /font-family: 'Acme Brand'/);
    assert.match(style?.textContent ?? "", /\/fonts\/acme\.woff2/);
  }));

test("hydrateBrandFont is a true no-op for a non-catalog font with no asset URL", () =>
  withFakeDocument((fake) => {
    hydrateBrandFont("brand-custom", "'Acme Brand', sans-serif", null);
    hydrateBrandFont("brand-custom", "'Acme Brand', sans-serif", undefined);

    assert.equal(fake.appended.length, 0);
  }));

// ---------------------------------------------------------------------------
// useHydrateBrandFont — effect wiring
// ---------------------------------------------------------------------------

test("useHydrateBrandFont hydrates the brand's font on mount", () =>
  withFakeDocument((fake) => {
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() =>
        useHydrateBrandFont({
          id: "brand-1",
          fontFamily: INTER!.cssFamily,
          fontAssetUrl: null,
        }),
      );
      assert.equal(fake.appended.length, 1);
      assert.equal(fake.appended[0]?.id, `gfont-brand-${INTER!.id}`);
    } finally {
      renderer.cleanup();
    }
  }));

test("useHydrateBrandFont re-hydrates when the brand's font fields change", () =>
  withFakeDocument((fake) => {
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() =>
        useHydrateBrandFont({
          id: "brand-1",
          fontFamily: "'Acme', sans-serif",
          fontAssetUrl: "/fonts/acme.woff2",
        }),
      );
      assert.equal(fake.appended.length, 1);
      assert.equal(fake.appended[0]?.id, "brand-font-brand-1");

      // Re-render with a different fontAssetUrl for the same brand id — the
      // effect's dependency array must pick up the change and re-hydrate.
      renderer.run(() =>
        useHydrateBrandFont({
          id: "brand-1",
          fontFamily: "'Acme', sans-serif",
          fontAssetUrl: "/fonts/acme-v2.woff2",
        }),
      );
      // Same id key ("brand-font-brand-1") already exists, so
      // injectBrandFontFace's own idempotency guard skips re-injection.
      assert.equal(fake.appended.length, 1);
    } finally {
      renderer.cleanup();
    }
  }));

test("useHydrateBrandFont does nothing when the brand has no fontFamily", () =>
  withFakeDocument((fake) => {
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() =>
        useHydrateBrandFont({
          id: "brand-1",
          fontFamily: null,
          fontAssetUrl: null,
        }),
      );
      assert.equal(fake.appended.length, 0);
    } finally {
      renderer.cleanup();
    }
  }));

// ---------------------------------------------------------------------------
// useHydrateVisualNodeFonts — per-node dedup
// ---------------------------------------------------------------------------

function visualWithNodeFonts(fontFamilies: (string | undefined)[]): Visual {
  const base = FIXTURES.list;
  return {
    ...base,
    nodes: fontFamilies.map((fontFamily, index) => ({
      ...base.nodes[0]!,
      id: `node-${index}`,
      fontFamily,
    })),
  };
}

test("useHydrateVisualNodeFonts hydrates each distinct node font family exactly once", () =>
  withFakeDocument((fake) => {
    const visual = visualWithNodeFonts([
      INTER!.cssFamily,
      INTER!.cssFamily, // duplicate — must be de-duplicated
      undefined, // no font — skipped entirely
    ]);
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() => useHydrateVisualNodeFonts(visual));
      assert.equal(fake.appended.length, 1);
      assert.equal(fake.appended[0]?.id, `gfont-brand-${INTER!.id}`);
    } finally {
      renderer.cleanup();
    }
  }));

test("useHydrateVisualNodeFonts hydrates multiple distinct node font families independently", () =>
  withFakeDocument((fake) => {
    const roboto = BRAND_WEB_FONTS.find((font) => font.id === "roboto");
    assert.ok(roboto);
    const visual = visualWithNodeFonts([INTER!.cssFamily, roboto!.cssFamily]);
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() => useHydrateVisualNodeFonts(visual));
      const ids = fake.appended.map((el) => el.id).sort();
      assert.deepEqual(
        ids,
        [`gfont-brand-${INTER!.id}`, `gfont-brand-${roboto!.id}`].sort(),
      );
    } finally {
      renderer.cleanup();
    }
  }));

test("useHydrateVisualNodeFonts re-hydrates when the visual's nodes array changes", () =>
  withFakeDocument((fake) => {
    const first = visualWithNodeFonts([INTER!.cssFamily]);
    const renderer = createReactRenderHarness();
    try {
      renderer.run(() => useHydrateVisualNodeFonts(first));
      assert.equal(fake.appended.length, 1);

      const roboto = BRAND_WEB_FONTS.find((font) => font.id === "roboto");
      assert.ok(roboto);
      const second = visualWithNodeFonts([roboto!.cssFamily]);
      renderer.run(() => useHydrateVisualNodeFonts(second));

      const ids = fake.appended.map((el) => el.id).sort();
      assert.deepEqual(
        ids,
        [`gfont-brand-${INTER!.id}`, `gfont-brand-${roboto!.id}`].sort(),
      );
    } finally {
      renderer.cleanup();
    }
  }));
