/**
 * Theme parity regression coverage.
 *
 * 1. Renderer↔export parity: the editor and presentation viewers render via
 *    `SlideCanvas` (which resolves colours through `resolveSlideThemeColors`),
 *    while export emits native slide specs via `buildDeckSpecs`. Both must
 *    derive inherited text colour and font from the SAME deck token cascade so
 *    a deck looks the same in the editor, present mode, the public viewer, and
 *    an exported PPTX.
 *
 * 2. Catalog parity: every STYLE_THEMES entry must be present in
 *    PRESENTATION_THEME_IDS so AI generation and validation accept rose/amber/slate and
 *    any future additions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Deck, Slide, TextElement } from "../document/deck-kernel/deck";
import { PRESENTATION_THEME_IDS } from "../document/deck-kernel/deck";
import { resolveSlideThemeColors } from "../document/deck-kernel/style-cascade";
import {
  resolveRoleToken,
  resolveThemeTokens,
  type PresentationTheme,
} from "../document/deck-kernel/presentation-theme";
import {
  buildDeckSpecs,
  type DeckBulletsOp,
  type DeckTextOp,
} from "../document/deck-kernel/export/deck-export";
import { buildDeck } from "@/test/builders/deck";
import { STYLE_THEMES } from "@/lib/visual/themes";

function titleEl(overrides: Partial<TextElement> = {}): TextElement {
  const text = overrides.content?.text ?? "Heading";
  return {
    id: "title",
    kind: "text",
    role: "title",
    zIndex: 0,
    box: { x: 6, y: 6, w: 88, h: 16 },
    content: { kind: "text", text, paragraphs: [{ text }] },
    designOverrides: {
      textStyle: { fontSize: 6, bold: true, italic: false, align: "left" },
    },
    ...overrides,
  };
}

function bodyBulletsEl(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: "b",
    kind: "text",
    role: "bullet",
    zIndex: 1,
    box: { x: 6, y: 26, w: 88, h: 60 },
    content: {
      kind: "text",
      text: "point",
      paragraphs: [{ text: "point", listType: "bullet" }],
    },
    designOverrides: {
      textStyle: { fontSize: 4.5, bold: false, italic: false, align: "left" },
    },
    ...overrides,
  };
}

function slide(elements: TextElement[]): Slide {
  return {
    id: "s1",
    index: 0,
    title: "",
    notes: "",
    elements,
  };
}

const BRAND: PresentationTheme = {
  id: "brand:x",
  name: "X",
  colors: {
    slideBg: "#101010",
    surface: "#202020",
    accent: "#ff8800",
    onBg: "#fafafa",
    onSurface: "#eeeeee",
    onAccent: "#000000",
    muted: "#999999",
  },
  typography: {
    fontFamily: "Roboto, sans-serif",
    headingFontFamily: "Oswald, sans-serif",
    scale: { h1: 36, h2: 28, h3: 22, body: 16, list: 14, footer: 10 },
  },
  spacing: { slidePaddingPt: 36, gridUnitPt: 6 },
  shape: { cornerRadiusPt: 4, shadowCss: "none" },
  defaultBackground: { type: "solid", color: "#101010" },
};

/** Renderer-side resolved title color (what SlideCanvas paints). */
function rendererTitleColor(deck: Deck): string {
  return resolveSlideThemeColors(deck, deck.slides[0]!).titleColor;
}

/** Export-side emitted title color. */
function exportTitleColor(deck: Deck): string {
  const [spec] = buildDeckSpecs(deck, new Map());
  return (
    spec.ops.find((o): o is DeckTextOp => o.kind === "text") as DeckTextOp
  ).color;
}

function exportTitleFont(deck: Deck): string | undefined {
  const [spec] = buildDeckSpecs(deck, new Map());
  return (
    spec.ops.find((o): o is DeckTextOp => o.kind === "text") as DeckTextOp
  ).fontFace;
}

function exportBulletColor(deck: Deck): string {
  const [spec] = buildDeckSpecs(deck, new Map());
  return (
    spec.ops.find(
      (o): o is DeckBulletsOp => o.kind === "bullets",
    ) as DeckBulletsOp
  ).color;
}

// ---------------------------------------------------------------------------
// Built-in theme parity
// ---------------------------------------------------------------------------

test("built-in themeId: renderer and export emit the same inherited title color", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "default" },
    slides: [slide([titleEl()])],
  });
  // toHex normalises to a 6-digit lowercase hex; renderer keeps the cascade hex.
  assert.equal(
    exportTitleColor(deck).toLowerCase(),
    rendererTitleColor(deck).replace("#", "").toLowerCase(),
  );
});

test("built-in themeId: inherited title color equals the token onBg", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "indigo" },
    slides: [slide([titleEl()])],
  });
  const onBg = resolveThemeTokens("indigo").colors.onBg;
  assert.equal(rendererTitleColor(deck), onBg);
});

// ---------------------------------------------------------------------------
// Theme override token set parity
// ---------------------------------------------------------------------------

test("theme override token set: renderer title color matches the brand onBg", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "default", themeOverrides: { tokenSet: BRAND } },
    slides: [slide([titleEl()])],
  });
  assert.equal(rendererTitleColor(deck), "#fafafa");
});

test("theme override token set: export inherits the brand heading font for h1", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "default", themeOverrides: { tokenSet: BRAND } },
    slides: [slide([titleEl()])],
  });
  // h1 is a heading role → heading font stack "Oswald".
  assert.equal(exportTitleFont(deck), "Oswald");
  // and matches the cascade role token the renderer would inherit (with the
  // self-hosted CJK fallback inserted by the resolver).
  assert.equal(
    resolveRoleToken(BRAND, "title").fontFamily,
    "Oswald, 'Noto Sans SC', sans-serif",
  );
});

test("theme override token set: export bullet color matches the brand onBg (body role)", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "default", themeOverrides: { tokenSet: BRAND } },
    slides: [slide([titleEl(), bodyBulletsEl()])],
  });
  assert.equal(exportBulletColor(deck).toLowerCase(), "fafafa");
});

// ---------------------------------------------------------------------------
// Local overrides win identically on both surfaces
// ---------------------------------------------------------------------------

test("a local color override wins in export regardless of the theme", () => {
  const deck: Deck = buildDeck({
    design: { themeId: "default", themeOverrides: { tokenSet: BRAND } },
    slides: [
      slide([
        titleEl({
          designOverrides: {
            textStyle: {
              fontSize: 6,
              bold: true,
              italic: false,
              align: "left",
              color: "#00ff00",
            },
          },
        }),
      ]),
    ],
  });
  assert.equal(exportTitleColor(deck).toLowerCase(), "00ff00");
});

// ---------------------------------------------------------------------------
// Catalog parity: PRESENTATION_THEME_IDS derived from STYLE_THEMES
// ---------------------------------------------------------------------------

test("every STYLE_THEMES id is present in PRESENTATION_THEME_IDS", () => {
  const presentationThemeIdsSet = new Set<string>(PRESENTATION_THEME_IDS);
  for (const theme of STYLE_THEMES) {
    assert.ok(
      presentationThemeIdsSet.has(theme.id),
      `PRESENTATION_THEME_IDS is missing "${theme.id}" from STYLE_THEMES — update STYLE_THEME_IDS in presentation-theme-ids.ts`,
    );
  }
});

test("sunset style theme exposes its warm palette and background tokens", () => {
  const sunset = STYLE_THEMES.find((theme) => theme.id === "sunset");
  assert.ok(sunset);
  assert.deepEqual(sunset.colors.palette.slice(0, 4), [
    "#f97316",
    "#ef4444",
    "#f59e0b",
    "#ec4899",
  ]);
  assert.equal(sunset.colors.background, "#fffaf5");
});
