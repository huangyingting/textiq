/**
 * Behavior coverage for the pure `Deck -> DeckSlideSpec[]` transform (#1899).
 *
 * These tests exercise `buildDeckSpecs` and its small geometry/style helpers
 * directly against canonical, hand-built decks (via the shared
 * `deck-mutation-test-fixtures` builders) — no PptxGenJS, DOM, or network
 * dependency is needed since this module is pure and DOM-free by design.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  makeDeck,
  makeSlide,
  makeShape,
  makeConnector,
  makeBox,
} from "../deck-mutation-test-fixtures";
import type {
  ImageElement,
  ShapeElement,
  TableElement,
  TextElement,
  VisualElement,
} from "../deck-elements";
import { slideHeightPctToPoints } from "../style-units";
import { createBlankVisual } from "@/lib/visual/blank";
import {
  buildDeckSpecs,
  deckGeometry,
  toExportTextStyle,
  type DeckBulletsOp,
  type DeckConnectorOp,
  type DeckImageOp,
  type DeckShapeOp,
  type DeckTextOp,
} from "./deck-export-spec";

// ---------------------------------------------------------------------------
// deckGeometry
// ---------------------------------------------------------------------------

test("deckGeometry maps 16:9 to the wide PptxGenJS layout and inch dimensions", () => {
  const geometry = deckGeometry("16:9");
  assert.equal(geometry.pptxLayout, "LAYOUT_WIDE");
  assert.equal(geometry.slideW, 13.333);
  assert.equal(geometry.slideH, 7.5);
  assert.equal(geometry.slideHPt, 7.5 * 72);
});

test("deckGeometry maps 4:3 to the standard PptxGenJS layout and inch dimensions", () => {
  const geometry = deckGeometry("4:3");
  assert.equal(geometry.pptxLayout, "LAYOUT_4X3");
  assert.equal(geometry.slideW, 10);
  assert.equal(geometry.slideH, 7.5);
});

test("deckGeometry defaults to the 16:9 layout when format is undefined", () => {
  assert.deepEqual(deckGeometry(undefined), deckGeometry("16:9"));
});

test("deckGeometry throws for a slide format outside the supported set", () => {
  assert.throws(() => deckGeometry("21:9" as never));
});

// ---------------------------------------------------------------------------
// toExportTextStyle
// ---------------------------------------------------------------------------

test("toExportTextStyle omits optional fields absent from the source op", () => {
  const style = toExportTextStyle({
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  });
  assert.deepEqual(style, {
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  });
  assert.ok(!("underline" in style));
  assert.ok(!("verticalAlign" in style));
  assert.ok(!("lineHeight" in style));
});

test("toExportTextStyle carries underline, verticalAlign, and lineHeight when set", () => {
  const style = toExportTextStyle({
    color: "112233",
    fontSize: 12,
    fontFace: "Aptos",
    bold: true,
    italic: true,
    underline: true,
    align: "center",
    verticalAlign: "bottom",
    lineHeight: 1.4,
  });
  assert.deepEqual(style, {
    color: "112233",
    fontSize: 12,
    fontFace: "Aptos",
    bold: true,
    italic: true,
    underline: true,
    align: "center",
    verticalAlign: "bottom",
    lineHeight: 1.4,
  });
});

// ---------------------------------------------------------------------------
// buildDeckSpecs — slide ordering
// ---------------------------------------------------------------------------

test("buildDeckSpecs preserves deck.slides order in the returned index sequence", () => {
  const deck = makeDeck([
    makeSlide({ id: "third", index: 2 }),
    makeSlide({ id: "first", index: 0 }),
    makeSlide({ id: "second", index: 1 }),
  ]);
  const specs = buildDeckSpecs(deck, new Map());
  assert.deepEqual(
    specs.map((spec) => spec.index),
    [0, 1, 2],
  );
});

// ---------------------------------------------------------------------------
// buildDeckSpecs — slide background/accent translation
// ---------------------------------------------------------------------------

test("buildDeckSpecs maps a solid slide background override to a hex color with no fill", () => {
  const slide = makeSlide({
    designOverrides: {
      background: { type: "solid", color: { value: "#112233" } },
    },
  });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.background, "112233");
  assert.equal(spec!.backgroundFill, undefined);
  assert.equal(spec!.backgroundImage, undefined);
});

test("buildDeckSpecs maps a linear gradient background override to its start-color hex with no fill", () => {
  const slide = makeSlide({
    designOverrides: {
      background: {
        type: "gradient",
        from: { value: "#ff0000" },
        to: { value: "#0000ff" },
      },
    },
  });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.background, "FF0000");
  assert.equal(spec!.backgroundFill, undefined);
});

test("buildDeckSpecs maps a radial gradient background override to an outer-color hex plus a backgroundFill descriptor", () => {
  const slide = makeSlide({
    designOverrides: {
      background: {
        type: "radialGradient",
        inner: { value: "#ffffff" },
        outer: { value: "#000000" },
      },
    },
  });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.background, "000000");
  assert.deepEqual(spec!.backgroundFill, {
    type: "radialGradient",
    inner: "FFFFFF",
    outer: "000000",
  });
});

test("buildDeckSpecs maps an image background override to backgroundImage independent of the resolved fill color", () => {
  const slide = makeSlide({
    designOverrides: {
      background: { type: "image", url: "https://example.com/bg.png" },
    },
  });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.backgroundImage, "https://example.com/bg.png");
  assert.equal(spec!.backgroundFill, undefined);
});

test("buildDeckSpecs maps a slide accent override to its hex color", () => {
  const slide = makeSlide({
    designOverrides: { accent: { value: "#abcdef" } },
  });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.accent, "ABCDEF");
});

// ---------------------------------------------------------------------------
// buildDeckSpecs — element translation
// ---------------------------------------------------------------------------

test("buildDeckSpecs translates a text element's style overrides and geometry into a DeckTextOp", () => {
  const geometry = deckGeometry("16:9");
  const text: TextElement = {
    id: "t1",
    kind: "text",
    box: makeBox({ x: 0, y: 0, w: 50, h: 20 }),
    zIndex: 0,
    designOverrides: {
      textStyle: {
        fontSize: 8,
        bold: true,
        italic: true,
        underline: true,
        align: "right",
        color: "#ff00ff",
      },
    },
    content: {
      kind: "text",
      text: "Styled",
      runs: [{ text: "Styled", bold: true, color: "#123456" }],
    },
  };
  const slide = makeSlide({ elements: [text] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  const [op] = spec!.ops as [DeckTextOp];

  assert.equal(op.kind, "text");
  assert.equal(op.x, 0);
  assert.equal(op.y, 0);
  assert.equal(op.w, (50 / 100) * geometry.slideW);
  assert.equal(op.h, (20 / 100) * geometry.slideH);
  assert.equal(op.text, "Styled");
  assert.equal(op.color, "FF00FF");
  assert.equal(op.fontSize, slideHeightPctToPoints(8, geometry.slideHPt));
  assert.equal(op.bold, true);
  assert.equal(op.italic, true);
  assert.equal(op.underline, true);
  assert.equal(op.align, "right");
  // Run-level colors are intentionally left untouched at spec-build time; the
  // PPTX applier normalizes them via `toHex` when it consumes the runs.
  assert.deepEqual(op.runs, [{ text: "Styled", bold: true, color: "#123456" }]);
});

test("buildDeckSpecs translates list paragraphs into a DeckBulletsOp with indent and list-type metadata", () => {
  const text: TextElement = {
    id: "t1",
    kind: "text",
    box: makeBox(),
    zIndex: 0,
    content: {
      kind: "text",
      text: "ignored",
      paragraphs: [
        { text: "Top level", listType: "bullet" },
        { text: "Nested numbered", listType: "number", indent: 1 },
      ],
    },
  };
  const slide = makeSlide({ elements: [text] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  const [op] = spec!.ops as [DeckBulletsOp];

  assert.equal(op.kind, "bullets");
  assert.deepEqual(op.items, ["Top level", "Nested numbered"]);
  assert.deepEqual(op.itemDetails, [
    { indent: undefined, listType: "bullet" },
    { indent: 1, listType: "number" },
  ]);
});

test("buildDeckSpecs translates a shape element's fill, stroke, and radius overrides", () => {
  const geometry = deckGeometry("16:9");
  const shape: ShapeElement = {
    id: "s1",
    kind: "shape",
    box: makeBox({ x: 0, y: 20, w: 30, h: 15 }),
    zIndex: 0,
    designOverrides: {
      fill: { value: "#aabbcc" },
      stroke: { color: "#334455", width: 2 },
      radius: 5,
    },
    content: { kind: "shape", shape: "rect", text: "Label" },
  };
  const slide = makeSlide({ elements: [shape] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  const [op] = spec!.ops as [DeckShapeOp];

  assert.equal(op.kind, "shape");
  assert.equal(op.shape, "rect");
  assert.equal(op.fill, "AABBCC");
  assert.equal(op.color, "AABBCC");
  assert.equal(op.text, "Label");
  const minInch = Math.min(
    (30 / 100) * geometry.slideW,
    (15 / 100) * geometry.slideH,
  );
  assert.deepEqual(op.stroke, {
    color: "334455",
    width: (2 / 100) * minInch * 72,
  });
  assert.equal(op.radius, (5 / 100) * minInch);
});

test("buildDeckSpecs omits an image op entirely when the element's src resolves to an empty asset", () => {
  const image: ImageElement = {
    id: "i1",
    kind: "image",
    box: makeBox(),
    zIndex: 0,
    content: { kind: "image", src: "" },
  };
  const slide = makeSlide({ elements: [image] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.deepEqual(spec!.ops, []);
});

test("buildDeckSpecs translates an image element with a resolved data-URL src and alt text", () => {
  const image: ImageElement = {
    id: "i1",
    kind: "image",
    box: makeBox({ x: 5, y: 5, w: 20, h: 20 }),
    zIndex: 0,
    content: {
      kind: "image",
      src: "data:image/png;base64,AAAA",
      alt: "A picture",
    },
  };
  const slide = makeSlide({ elements: [image] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  const [op] = spec!.ops as [DeckImageOp];
  assert.equal(op.kind, "image");
  assert.equal(op.src, "data:image/png;base64,AAAA");
  assert.equal(op.alt, "A picture");
});

test("buildDeckSpecs resolves a connector element's free endpoints into absolute inch coordinates", () => {
  const geometry = deckGeometry("16:9");
  const connector = makeConnector("c1", { x: 0, y: 0 }, { x: 50, y: 50 });
  const slide = makeSlide({ elements: [connector] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  const [op] = spec!.ops as [DeckConnectorOp];

  assert.equal(op.kind, "connector");
  assert.equal(op.x1, 0);
  assert.equal(op.y1, 0);
  assert.equal(op.x2, (50 / 100) * geometry.slideW);
  assert.equal(op.y2, (50 / 100) * geometry.slideH);
});

test("buildDeckSpecs translates a table element into header, row, and caption ops in document order", () => {
  const table: TableElement = {
    id: "tb1",
    kind: "table",
    box: makeBox({ x: 5, y: 60, w: 60, h: 20 }),
    zIndex: 0,
    content: {
      kind: "table",
      columns: [
        { id: "c1", label: "Col A" },
        { id: "c2", label: "Col B" },
      ],
      rows: [{ id: "r1", cells: [{ text: "a" }, { text: "b" }] }],
      header: true,
      caption: "A caption",
    },
  };
  const slide = makeSlide({ elements: [table] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());

  // 2 header cells (shape + text) + 2 body cells (shape + text) + 1 caption text.
  assert.equal(spec!.ops.length, 9);
  const texts = spec!.ops
    .filter((op) => op.kind === "text")
    .map((op) => (op as DeckTextOp).text);
  assert.deepEqual(texts, ["Col A", "Col B", "a", "b", "A caption"]);
});

test("buildDeckSpecs skips a visual element whose id is absent from the visuals lookup", () => {
  const visual: VisualElement = {
    id: "v1",
    kind: "visual",
    box: makeBox(),
    zIndex: 0,
    content: { kind: "visual", visualId: "does-not-exist" },
  };
  const slide = makeSlide({ elements: [visual] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.deepEqual(spec!.ops, []);
});

test("buildDeckSpecs emits a visual-native op for a resolvable flowchart visual element", () => {
  const visual: VisualElement = {
    id: "v1",
    kind: "visual",
    box: makeBox({ x: 40, y: 20, w: 40, h: 40 }),
    zIndex: 0,
    content: { kind: "visual", visualId: "vis-1" },
  };
  const slide = makeSlide({ elements: [visual] });
  const visuals = new Map([["vis-1", createBlankVisual("flowchart")]]);
  const [spec] = buildDeckSpecs(makeDeck([slide]), visuals);
  assert.equal(spec!.ops.length, 1);
  assert.equal(spec!.ops[0]!.kind, "visual-native");
  const op = spec!.ops[0] as { kind: "visual-native"; specs: unknown[] };
  assert.ok(op.specs.length > 0);
});

test("buildDeckSpecs falls back to a visual-fallback op for an image-only visual kind", () => {
  const visual: VisualElement = {
    id: "v1",
    kind: "visual",
    box: makeBox(),
    zIndex: 0,
    content: { kind: "visual", visualId: "funnel-1" },
  };
  const slide = makeSlide({ elements: [visual] });
  const visuals = new Map([["funnel-1", createBlankVisual("funnel")]]);
  const [spec] = buildDeckSpecs(makeDeck([slide]), visuals);
  assert.equal(spec!.ops.length, 1);
  assert.equal(spec!.ops[0]!.kind, "visual-fallback");
});

test("buildDeckSpecs filters hidden elements out of the emitted ops entirely", () => {
  const hidden: TextElement = {
    id: "h1",
    kind: "text",
    box: makeBox(),
    zIndex: 0,
    hidden: true,
    content: { kind: "text", text: "hidden" },
  };
  const visible: TextElement = {
    id: "h2",
    kind: "text",
    box: makeBox(),
    zIndex: 1,
    content: { kind: "text", text: "visible" },
  };
  const slide = makeSlide({ elements: [hidden, visible] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.deepEqual(
    spec!.ops.map((op) => (op as DeckTextOp).text),
    ["visible"],
  );
});

// ---------------------------------------------------------------------------
// buildDeckSpecs — unsupported content / invalid input
// ---------------------------------------------------------------------------

test("buildDeckSpecs throws for a slide element with an unrecognized kind", () => {
  const badElement = {
    id: "bad1",
    kind: "unknown-kind",
    box: makeBox(),
    zIndex: 0,
    content: {},
  };
  const slide = makeSlide({ elements: [badElement as never] });
  assert.throws(
    () => buildDeckSpecs(makeDeck([slide]), new Map()),
    /assertNever/,
  );
});

test("buildDeckSpecs throws when the deck is missing its slides array", () => {
  assert.throws(() => buildDeckSpecs({} as never, new Map()));
});

test("buildDeckSpecs preserves z-order by emitting ops in element array order", () => {
  const back = makeShape("back", { zIndex: 0 });
  const front = makeShape("front", { zIndex: 1 });
  const slide = makeSlide({ elements: [back, front] });
  const [spec] = buildDeckSpecs(makeDeck([slide]), new Map());
  assert.equal(spec!.ops.length, 2);
  assert.equal(spec!.ops[0]!.kind, "shape");
  assert.equal(spec!.ops[1]!.kind, "shape");
});
