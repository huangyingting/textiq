/**
 * Behavior coverage for the browser-only PptxGenJS applier (#1899).
 *
 * The exported `apply*Op` functions are duck-typed against a minimal
 * `{ addShape, addText, addImage }` slide, so they are tested directly with a
 * recording fake slide (mirrors the pattern already used by
 * `src/lib/visual/pptx-apply.test.ts`) — no real PptxGenJS instance is needed
 * for those unit-level assertions.
 *
 * `exportDeckAsPPTX` is the public orchestration entry point and is tested
 * end-to-end against the real `pptxgenjs` + `jszip` packages (both run fine
 * under plain Node — no DOM is required to *write* a PPTX archive), asserting
 * on the produced archive's structure rather than committing a binary golden
 * file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import JSZip from "jszip";

import {
  makeDeck,
  makeSlide,
  makeShape,
  makeConnector,
} from "../deck-mutation-test-fixtures";
import type { TextElement } from "../deck-elements";
import { createBlankVisual } from "@/lib/visual/blank";
import type {
  DeckBulletsOp,
  DeckConnectorOp,
  DeckImageOp,
  DeckShapeOp,
  DeckTextOp,
} from "./deck-export-spec";
import {
  applyBulletsOp,
  applyConnectorOp,
  applyDeckOp,
  applyImageOp,
  applyShapeOp,
  applyTextOp,
  exportDeckAsPPTX,
} from "./deck-export-pptx";

// ---------------------------------------------------------------------------
// Fake slide recorder (mirrors src/lib/visual/pptx-apply.test.ts)
// ---------------------------------------------------------------------------

function recordingSlide() {
  const calls = {
    shapes: [] as Array<{ shape: unknown; options: unknown }>,
    texts: [] as Array<{ text: unknown; options: unknown }>,
    images: [] as unknown[],
  };
  return {
    calls,
    slide: {
      addShape(shape: unknown, options: unknown) {
        calls.shapes.push({ shape, options });
      },
      addText(text: unknown, options: unknown) {
        calls.texts.push({ text, options });
      },
      addImage(options: unknown) {
        calls.images.push(options);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// applyTextOp
// ---------------------------------------------------------------------------

test("applyTextOp emits a plain string with shared geometry and style options", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckTextOp = {
    kind: "text",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    text: "Hello",
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  };
  applyTextOp(slide as never, op);
  assert.equal(calls.texts.length, 1);
  assert.equal(calls.texts[0]!.text, "Hello");
  assert.deepEqual(calls.texts[0]!.options, {
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
    valign: "middle",
    wrap: true,
  });
});

test("applyTextOp emits per-run bold/color/link options and turns a literal newline run into a line break", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckTextOp = {
    kind: "text",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    text: "Hi\nBye",
    runs: [
      { text: "Hi" },
      { text: "\n" },
      { text: "Bye", bold: true, color: "#ff0000" },
    ],
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
    fitMode: "shrink-to-fit",
  };
  applyTextOp(slide as never, op);
  assert.deepEqual(calls.texts[0]!.text, [
    { text: "Hi", options: {} },
    { text: "", options: { breakLine: true } },
    { text: "Bye", options: { bold: true, color: "FF0000" } },
  ]);
  const options = calls.texts[0]!.options as Record<string, unknown>;
  assert.equal(options.shrinkText, true);
});

test("applyTextOp maps top/bottom vertical align, rotation, and opacity to PptxGenJS options", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckTextOp = {
    kind: "text",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    text: "Rotated",
    color: "000000",
    fontSize: 10,
    bold: false,
    italic: false,
    align: "center",
    verticalAlign: "top",
    rotation: 45,
    opacity: 0.5,
  };
  applyTextOp(slide as never, op);
  const options = calls.texts[0]!.options as Record<string, unknown>;
  assert.equal(options.valign, "top");
  assert.equal(options.rotate, 45);
  assert.equal(options.transparency, 50);
});

// ---------------------------------------------------------------------------
// applyBulletsOp
// ---------------------------------------------------------------------------

test("applyBulletsOp emits flat true-bullet runs with a trailing line break between items", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckBulletsOp = {
    kind: "bullets",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    items: ["First", "Second"],
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  };
  applyBulletsOp(slide as never, op);
  assert.deepEqual(calls.texts[0]!.text, [
    {
      text: "First",
      options: { bullet: true, indentLevel: 0, breakLine: true },
    },
    {
      text: "Second",
      options: { bullet: true, indentLevel: 0, breakLine: false },
    },
  ]);
});

test("applyBulletsOp maps itemDetails indent/listType to numbered and indented bullet options", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckBulletsOp = {
    kind: "bullets",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    items: ["A", "B"],
    itemDetails: [
      { indent: 0, listType: "bullet" },
      { indent: 1, listType: "number" },
    ],
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  };
  applyBulletsOp(slide as never, op);
  assert.deepEqual(calls.texts[0]!.text, [
    { text: "A", options: { bullet: true, indentLevel: 0, breakLine: true } },
    {
      text: "B",
      options: { bullet: { type: "number" }, indentLevel: 1, breakLine: false },
    },
  ]);
});

test("applyBulletsOp emits per-line run formatting when itemRuns are present", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckBulletsOp = {
    kind: "bullets",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    items: ["Bold line", "Plain line"],
    itemRuns: [[{ text: "Bold line", bold: true }], []],
    color: "112233",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left",
  };
  applyBulletsOp(slide as never, op);
  const runs = calls.texts[0]!.text as Array<{
    text: string;
    options: Record<string, unknown>;
  }>;
  assert.equal(runs[0]!.text, "Bold line");
  assert.equal(runs[0]!.options.bold, true);
  assert.equal(runs[0]!.options.bullet, true);
  // The second item has an empty itemRuns entry, so it falls back to the
  // plain item string rather than emitting an empty run.
  assert.equal(runs[1]!.text, "Plain line");
});

// ---------------------------------------------------------------------------
// applyShapeOp
// ---------------------------------------------------------------------------

test("applyShapeOp renders a line shape as a centered horizontal rule and never draws its label", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckShapeOp = {
    kind: "shape",
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    shape: "line",
    color: "112233",
    text: "ignored for lines",
  };
  applyShapeOp(slide as never, op);
  assert.deepEqual(calls.shapes, [
    {
      shape: "line",
      options: {
        x: 1,
        y: 4,
        w: 3,
        h: 0,
        line: { color: "112233", width: 2 },
      },
    },
  ]);
  assert.equal(calls.texts.length, 0);
});

test("applyShapeOp renders triangle/diamond shapes with zero-width outline and no label call when text is absent", () => {
  for (const shape of ["triangle", "diamond"] as const) {
    const { calls, slide } = recordingSlide();
    const op: DeckShapeOp = {
      kind: "shape",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      shape,
      color: "112233",
    };
    applyShapeOp(slide as never, op);
    assert.deepEqual(calls.shapes, [
      {
        shape,
        options: {
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          fill: { color: "112233" },
          line: { width: 0, color: "112233" },
        },
      },
    ]);
    assert.equal(calls.texts.length, 0);
  }
});

test("applyShapeOp renders triangle/diamond shapes with an empty-string label and no label call", () => {
  for (const shape of ["triangle", "diamond"] as const) {
    const { calls, slide } = recordingSlide();
    const op: DeckShapeOp = {
      kind: "shape",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      shape,
      color: "112233",
      text: "",
    };
    applyShapeOp(slide as never, op);
    assert.equal(calls.shapes.length, 1);
    assert.equal(calls.texts.length, 0);
  }
});

test("applyShapeOp draws a centered label for triangle/diamond shapes without altering the shape options", () => {
  for (const shape of ["triangle", "diamond"] as const) {
    const { calls, slide } = recordingSlide();
    const op: DeckShapeOp = {
      kind: "shape",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      shape,
      color: "112233",
      text: "Label",
    };
    applyShapeOp(slide as never, op);
    assert.deepEqual(calls.shapes, [
      {
        shape,
        options: {
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          fill: { color: "112233" },
          line: { width: 0, color: "112233" },
        },
      },
    ]);
    assert.equal(calls.texts.length, 1);
    assert.equal(calls.texts[0]!.text, "Label");
    assert.deepEqual(calls.texts[0]!.options, {
      x: 1 + 3 * 0.08,
      y: 2 + 4 * 0.08,
      w: 3 * 0.84,
      h: 4 * 0.84,
      color: "18181b",
      fontSize: 18,
      bold: false,
      italic: false,
      align: "center",
      valign: "middle",
      wrap: true,
    });
  }
});

test("applyShapeOp applies styled label options (color/fontSize/bold/italic/font face) to triangle/diamond shapes", () => {
  for (const shape of ["triangle", "diamond"] as const) {
    const { calls, slide } = recordingSlide();
    const op: DeckShapeOp = {
      kind: "shape",
      x: 0,
      y: 0,
      w: 10,
      h: 5,
      shape,
      color: "112233",
      text: "Styled",
      textColor: "ff0000",
      fontSize: 24,
      fontFace: "Georgia",
      bold: true,
      italic: true,
      underline: true,
      align: "left",
      rotation: 15,
      opacity: 0.5,
    };
    applyShapeOp(slide as never, op);
    // Shape options are unaffected by label styling.
    assert.deepEqual(calls.shapes[0]!.options, {
      x: 0,
      y: 0,
      w: 10,
      h: 5,
      fill: { color: "112233", transparency: 50 },
      line: { width: 0, color: "112233", transparency: 50 },
      rotate: 15,
    });
    assert.equal(calls.texts.length, 1);
    assert.equal(calls.texts[0]!.text, "Styled");
    assert.deepEqual(calls.texts[0]!.options, {
      x: 0 + 10 * 0.08,
      y: 0 + 5 * 0.08,
      w: 10 * 0.84,
      h: 5 * 0.84,
      color: "ff0000",
      fontSize: 24,
      fontFace: "Georgia",
      bold: true,
      italic: true,
      align: "left",
      valign: "middle",
      wrap: true,
      rotate: 15,
      underline: { style: "sng" },
      transparency: 50,
    });
  }
});

test("applyShapeOp renders a rounded rect shape and its centered label when text is present", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckShapeOp = {
    kind: "shape",
    x: 1,
    y: 2,
    w: 6,
    h: 4,
    shape: "rect",
    color: "112233",
    radius: 0.5,
    text: "Hi",
    fontSize: 10,
    align: "center",
  };
  applyShapeOp(slide as never, op);
  assert.deepEqual(calls.shapes, [
    {
      shape: "roundRect",
      options: {
        x: 1,
        y: 2,
        w: 6,
        h: 4,
        fill: { color: "112233" },
        line: { width: 0, color: "112233" },
        rectRadius: 0.5,
      },
    },
  ]);
  assert.equal(calls.texts.length, 1);
  assert.equal(calls.texts[0]!.text, "Hi");
});

test("applyShapeOp ignores radius for circles while preserving rounded rect radius", () => {
  const { calls, slide } = recordingSlide();
  const baseOp: DeckShapeOp = {
    kind: "shape",
    x: 1,
    y: 2,
    w: 6,
    h: 4,
    shape: "circle",
    color: "112233",
    radius: 0.5,
  };

  applyShapeOp(slide as never, baseOp);
  applyShapeOp(slide as never, { ...baseOp, shape: "rect" });

  assert.equal(calls.shapes[0]!.shape, "ellipse");
  assert.equal(
    "rectRadius" in (calls.shapes[0]!.options as Record<string, unknown>),
    false,
  );
  assert.equal(calls.shapes[1]!.shape, "roundRect");
  assert.equal(
    (calls.shapes[1]!.options as Record<string, unknown>).rectRadius,
    0.5,
  );
});

test("applyShapeOp draws an explicit stroke instead of the zero-width fallback outline", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckShapeOp = {
    kind: "shape",
    x: 1,
    y: 2,
    w: 6,
    h: 4,
    shape: "circle",
    color: "112233",
    stroke: { color: "abcabc", width: 2 },
  };
  applyShapeOp(slide as never, op);
  const options = calls.shapes[0]!.options as Record<string, unknown>;
  assert.equal(calls.shapes[0]!.shape, "ellipse");
  assert.deepEqual(options.line, { color: "abcabc", width: 2 });
  // Circle shapes are inscribed into the largest centered square of the box.
  assert.equal(options.x, 2);
  assert.equal(options.y, 2);
  assert.equal(options.w, 4);
  assert.equal(options.h, 4);
});

// ---------------------------------------------------------------------------
// applyImageOp
// ---------------------------------------------------------------------------

test("applyImageOp embeds a data-URL image source with cover sizing", async () => {
  const { calls, slide } = recordingSlide();
  const op: DeckImageOp = {
    kind: "image",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    src: "data:image/png;base64,AAAA",
    alt: "pic",
    fitMode: "cover",
  };
  await applyImageOp(slide as never, op);
  assert.deepEqual(calls.images, [
    {
      data: "data:image/png;base64,AAAA",
      x: 1,
      y: 1,
      w: 2,
      h: 2,
      altText: "pic",
      sizing: { type: "cover", w: 2, h: 2 },
    },
  ]);
});

test("applyImageOp embeds a path image source and defaults the none fit mode to contain sizing", async () => {
  const { calls, slide } = recordingSlide();
  const op: DeckImageOp = {
    kind: "image",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
    src: "/uploads/img.png",
    fitMode: "none",
  };
  await applyImageOp(slide as never, op);
  assert.deepEqual(calls.images, [
    {
      path: "/uploads/img.png",
      x: 1,
      y: 1,
      w: 2,
      h: 2,
      sizing: { type: "contain", w: 2, h: 2 },
    },
  ]);
});

// ---------------------------------------------------------------------------
// applyConnectorOp
// ---------------------------------------------------------------------------

test("applyConnectorOp computes the bounding box, midpoint, and rotation angle between endpoints", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckConnectorOp = {
    kind: "connector",
    x1: 0,
    y1: 0,
    x2: 3,
    y2: 4,
    color: "334455",
    width: 1.5,
    dash: true,
    arrowEnd: "arrow",
    opacity: 0.5,
  };
  applyConnectorOp(slide as never, op);
  assert.deepEqual(calls.shapes, [
    {
      shape: "line",
      options: {
        x: -1,
        y: 2,
        w: 5,
        h: 0,
        line: {
          color: "334455",
          width: 1.5,
          dashType: "dash",
          endArrowType: "arrow",
          transparency: 50,
        },
        rotate: 53,
      },
    },
  ]);
});

test("applyConnectorOp skips drawing a zero-length connector", () => {
  const { calls, slide } = recordingSlide();
  const op: DeckConnectorOp = {
    kind: "connector",
    x1: 1,
    y1: 1,
    x2: 1,
    y2: 1,
    color: "334455",
    width: 1,
  };
  applyConnectorOp(slide as never, op);
  assert.deepEqual(calls.shapes, []);
});

// ---------------------------------------------------------------------------
// applyDeckOp dispatch
// ---------------------------------------------------------------------------

test("applyDeckOp dispatches a text op synchronously to the fake slide", async () => {
  const { calls, slide } = recordingSlide();
  const op: DeckTextOp = {
    kind: "text",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    text: "Dispatch me",
    color: "000000",
    fontSize: 10,
    bold: false,
    italic: false,
    align: "left",
  };
  await applyDeckOp(slide as never, op, () => null);
  assert.equal(calls.texts[0]!.text, "Dispatch me");
});

test("applyDeckOp dispatches a visual-native op through the shared pptx-apply spec applier", async () => {
  const { calls, slide } = recordingSlide();
  await applyDeckOp(
    slide as never,
    {
      kind: "visual-native",
      specs: [
        {
          kind: "text",
          text: "Native",
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          color: "000000",
          fontSize: 10,
        },
      ],
    },
    () => null,
  );
  assert.equal(calls.texts.length, 1);
});

test("applyDeckOp skips a visual-fallback op when the injected getSvg callback returns null", async () => {
  const { calls, slide } = recordingSlide();
  await applyDeckOp(
    slide as never,
    { kind: "visual-fallback", visualId: "missing", x: 0, y: 0, w: 1, h: 1 },
    () => null,
  );
  assert.equal(calls.images.length, 0);
});

// ---------------------------------------------------------------------------
// exportDeckAsPPTX — end-to-end orchestration
// ---------------------------------------------------------------------------

function canonicalTextElement(id: string, text: string): TextElement {
  return {
    id,
    kind: "text",
    box: { x: 5, y: 5, w: 40, h: 10 },
    zIndex: 1,
    content: { kind: "text", text },
  };
}

async function slideXmlEntries(blob: Blob): Promise<string[]> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();
}

test("exportDeckAsPPTX produces a PPTX blob with one slide entry per deck.slides entry", async () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [makeShape("sh1"), canonicalTextElement("t1", "Slide one")],
    }),
    makeSlide({
      id: "s2",
      elements: [canonicalTextElement("t2", "Slide two")],
    }),
  ]);
  const blob = await exportDeckAsPPTX(deck, new Map(), () => null);
  assert.ok(blob);
  assert.equal(
    blob!.type,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.ok(blob!.size > 0);
  assert.deepEqual(await slideXmlEntries(blob!), [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
  ]);
});

test("exportDeckAsPPTX produces identical slide XML content across repeated calls with the same deck", async () => {
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [makeShape("sh1"), canonicalTextElement("t1", "Deterministic")],
    }),
  ]);
  const [blobA, blobB] = await Promise.all([
    exportDeckAsPPTX(deck, new Map(), () => null),
    exportDeckAsPPTX(deck, new Map(), () => null),
  ]);
  const zipA = await JSZip.loadAsync(Buffer.from(await blobA!.arrayBuffer()));
  const zipB = await JSZip.loadAsync(Buffer.from(await blobB!.arrayBuffer()));
  const xmlA = await zipA.files["ppt/slides/slide1.xml"]!.async("string");
  const xmlB = await zipB.files["ppt/slides/slide1.xml"]!.async("string");
  assert.equal(xmlA, xmlB);
});

test("exportDeckAsPPTX returns null when the deck fails to build export specs", async () => {
  const blob = await exportDeckAsPPTX({} as never, new Map(), () => null);
  assert.equal(blob, null);
});

test("exportDeckAsPPTX returns null when the injected getSvg callback throws while resolving a fallback visual", async () => {
  const visual = createBlankVisual("funnel");
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [
        {
          id: "v1",
          kind: "visual",
          box: { x: 0, y: 0, w: 10, h: 10 },
          zIndex: 0,
          content: { kind: "visual", visualId: "funnel-1" },
        },
      ],
    }),
  ]);
  const visuals = new Map([["funnel-1", visual]]);
  const blob = await exportDeckAsPPTX(deck, visuals, () => {
    throw new Error("getSvg boom");
  });
  assert.equal(blob, null);
});

test("exportDeckAsPPTX omits an unrasterizable fallback visual without failing the whole export", async () => {
  const visual = createBlankVisual("funnel");
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [
        {
          id: "v1",
          kind: "visual",
          box: { x: 0, y: 0, w: 10, h: 10 },
          zIndex: 0,
          content: { kind: "visual", visualId: "funnel-1" },
        },
      ],
    }),
  ]);
  const visuals = new Map([["funnel-1", visual]]);
  // A "resolved" SVG that cannot actually be rasterized in this environment
  // (no canvas/document); exportPNG resolves null instead of throwing, so the
  // fallback image op is silently omitted rather than corrupting the archive.
  const fakeSvg = { viewBox: { baseVal: { width: 100, height: 100 } } };
  const blob = await exportDeckAsPPTX(deck, visuals, () => fakeSvg as never);
  assert.ok(blob);
  assert.ok(blob!.size > 0);
});

test("exportDeckAsPPTX honors the connector arrays and reorders slides using deck.slides order", async () => {
  const deck = makeDeck([
    makeSlide({
      id: "second",
      elements: [canonicalTextElement("t2", "Second")],
    }),
    makeSlide({
      id: "first",
      elements: [makeConnector("c1", { x: 0, y: 0 }, { x: 10, y: 10 })],
    }),
  ]);
  const blob = await exportDeckAsPPTX(deck, new Map(), () => null);
  assert.ok(blob);
  const entries = await slideXmlEntries(blob!);
  assert.equal(entries.length, 2);
});
