/**
 * Unit tests for the v7 PPTX applier.
 *
 * Pure helpers (`textContentToPptxRuns`, `vnextShapeToName`) are tested
 * directly. Op appliers are tested via a minimal mock slide that records calls
 * so PptxGenJS is not needed at test time.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  textContentToPptxRuns,
  vnextShapeToName,
  applyVnextTextOp,
  applyVnextShapeOp,
  applyVnextTableOp,
  applyVnextConnectorOp,
  applyVnextImageOp,
  applyVnextVisualOp,
  applyVnextPptxSpec,
  exportDeckV7AsPPTX,
  resolveExportSpecAssetSources,
} from "@/lib/presentation-vnext/pptx-vnext-apply";
import type { PptxTextRun } from "@/lib/presentation-vnext/pptx-vnext-apply";
import type {
  VnextPptxTextOp,
  VnextPptxShapeOp,
  VnextPptxTableOp,
  VnextPptxConnectorOp,
  VnextPptxImageOp,
  VnextPptxVisualOp,
  VnextPptxDeckSpec,
} from "@/lib/presentation-vnext/pptx-export-adapter";
import type {
  TextContent,
  TableContent,
} from "@/lib/presentation-vnext/schema";
import {
  buildContentSlide,
  buildDeckV7,
  buildImageAsset,
  buildMinimalThemePackage,
} from "@/test/builders/deck-v7";

// ---------------------------------------------------------------------------
// Mock slide target
// ---------------------------------------------------------------------------

type SlideCall =
  | { kind: "addText"; args: unknown[] }
  | { kind: "addShape"; args: unknown[] }
  | { kind: "addImage"; args: unknown[] }
  | { kind: "addTable"; args: unknown[] }
  | { kind: "addNotes"; args: unknown[] };

function makeMockSlide() {
  const calls: SlideCall[] = [];
  const slide = {
    addText: (...args: unknown[]) => {
      calls.push({ kind: "addText", args });
    },
    addShape: (...args: unknown[]) => {
      calls.push({ kind: "addShape", args });
    },
    addImage: (...args: unknown[]) => {
      calls.push({ kind: "addImage", args });
    },
    addTable: (...args: unknown[]) => {
      calls.push({ kind: "addTable", args });
    },
    addNotes: (...args: unknown[]) => {
      calls.push({ kind: "addNotes", args });
    },
    background: null as unknown,
  };
  return { slide, calls };
}

// ---------------------------------------------------------------------------
// resolveExportSpecAssetSources
// ---------------------------------------------------------------------------

describe("resolveExportSpecAssetSources", () => {
  test("replaces image operation asset ids with DeckV7 image src values", () => {
    const deck = buildDeckV7([], {
      assets: {
        images: {
          "img-1": buildImageAsset("img-1", {
            src: "https://example.com/image.png",
          }),
        },
      },
    });
    const resolved = resolveExportSpecAssetSources(deck, {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      diagnostics: [],
      slides: [
        {
          id: "slide-1",
          background: { type: "background" },
          operations: [
            {
              type: "image",
              id: "image-1",
              assetId: "img-1",
              frame: { x: 0, y: 0, w: 100, h: 100 },
              style: {},
              zIndex: 1,
            },
          ],
        },
      ],
    });

    const op = resolved.slides[0].operations[0];
    assert.equal(op.type, "image");
    if (op.type === "image") {
      assert.equal(op.assetId, "https://example.com/image.png");
    }
  });

  test("turns visual registry asset ids into deterministic visual placeholders when no image source exists", () => {
    const deck = buildDeckV7([], {
      assets: {
        images: {},
        visuals: {
          "visual-asset-1": {
            id: "visual-asset-1",
            visualId: "doc-visual-1",
            alt: "Registry visual",
          },
        },
      },
    });
    const resolved = resolveExportSpecAssetSources(deck, {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      diagnostics: [],
      slides: [
        {
          id: "slide-1",
          background: { type: "background" },
          operations: [
            {
              type: "visual",
              id: "visual-1",
              assetId: "visual-asset-1",
              frame: { x: 0, y: 0, w: 100, h: 100 },
              style: {},
              zIndex: 1,
            },
          ],
        },
      ],
    });

    const op = resolved.slides[0].operations[0];
    assert.equal(op.type, "visual");
    if (op.type === "visual") {
      assert.equal(op.assetId, undefined);
      assert.equal(op.visualId, "doc-visual-1");
      assert.equal(op.alt, "Registry visual");
    }
  });

  test("resolves visual registry asset ids through their backing image asset", () => {
    const deck = buildDeckV7([], {
      assets: {
        images: {
          "backing-image": buildImageAsset("backing-image", {
            src: "https://example.com/rendered-visual.png",
          }),
        },
        visuals: {
          "visual-asset-1": {
            id: "backing-image",
            visualId: "doc-visual-1",
            alt: "Rendered chart",
          },
        },
      },
    });
    const resolved = resolveExportSpecAssetSources(deck, {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      diagnostics: [],
      slides: [
        {
          id: "slide-1",
          background: { type: "background" },
          operations: [
            {
              type: "visual",
              id: "visual-1",
              assetId: "visual-asset-1",
              frame: { x: 0, y: 0, w: 100, h: 100 },
              style: {},
              zIndex: 1,
            },
          ],
        },
      ],
    });

    const op = resolved.slides[0].operations[0];
    assert.equal(op.type, "visual");
    if (op.type === "visual") {
      assert.equal(op.assetId, "https://example.com/rendered-visual.png");
      assert.equal(op.visualId, "doc-visual-1");
      assert.equal(op.alt, "Rendered chart");
    }
  });

  test("resolves visual asset ids through file assets and preserves unresolved operations", () => {
    const deck = buildDeckV7([], {
      assets: {
        images: {},
        files: {
          "visual-file": {
            id: "visual-file",
            src: "data:image/svg+xml;base64,PHN2Zy8+",
          },
        },
      },
    });
    const resolved = resolveExportSpecAssetSources(deck, {
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
      diagnostics: [],
      slides: [
        {
          id: "slide-1",
          background: { type: "background" },
          operations: [
            {
              type: "visual",
              id: "visual-1",
              assetId: "visual-file",
              visualId: "chart-1",
              frame: { x: 0, y: 0, w: 50, h: 50 },
              style: {},
              zIndex: 1,
            },
            {
              type: "image",
              id: "image-missing",
              assetId: "missing-image",
              frame: { x: 50, y: 0, w: 50, h: 50 },
              style: {},
              zIndex: 2,
            },
            {
              type: "text",
              id: "text-1",
              frame: { x: 0, y: 50, w: 100, h: 10 },
              style: {},
              content: { paragraphs: [{ id: "p1", text: "Copy" }] },
              zIndex: 3,
            },
          ],
        },
      ],
    });

    const [visualOp, missingImageOp, textOp] = resolved.slides[0].operations;
    assert.equal(visualOp.type, "visual");
    if (visualOp.type === "visual") {
      assert.equal(visualOp.assetId, "data:image/svg+xml;base64,PHN2Zy8+");
    }
    assert.equal(missingImageOp.type, "image");
    if (missingImageOp.type === "image") {
      assert.equal(missingImageOp.assetId, "missing-image");
    }
    assert.equal(textOp.type, "text");
  });
});

// ---------------------------------------------------------------------------
// textContentToPptxRuns
// ---------------------------------------------------------------------------

describe("textContentToPptxRuns", () => {
  test("single paragraph without runs produces one run with the paragraph text", () => {
    const content: TextContent = {
      paragraphs: [{ id: "p1", text: "Hello world" }],
    };
    const runs = textContentToPptxRuns(content);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].text, "Hello world");
    assert.equal(runs[0].options?.breakLine, undefined);
  });

  test("two paragraphs produce a breakLine after the first", () => {
    const content: TextContent = {
      paragraphs: [
        { id: "p1", text: "Line one" },
        { id: "p2", text: "Line two" },
      ],
    };
    const runs = textContentToPptxRuns(content);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].text, "Line one");
    assert.equal(runs[0].options?.breakLine, true);
    assert.equal(runs[1].text, "Line two");
    assert.equal(runs[1].options?.breakLine, undefined);
  });

  test("paragraph with runs expands each run separately", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "plain bold",
          runs: [{ text: "plain " }, { text: "bold", bold: true }],
        },
      ],
    };
    const runs = textContentToPptxRuns(content);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].text, "plain ");
    assert.equal(runs[0].options?.bold, undefined);
    assert.equal(runs[1].text, "bold");
    assert.equal(runs[1].options?.bold, true);
  });

  test("non-list text runs keep existing paragraph break behavior unchanged", () => {
    const content: TextContent = {
      paragraphs: [
        { id: "p1", text: "First" },
        { id: "p2", text: "Second" },
      ],
    };

    assert.deepEqual(textContentToPptxRuns(content), [
      { text: "First", options: { breakLine: true } },
      { text: "Second", options: {} },
    ]);
  });

  test("bulleted list paragraph maps marker and indent to the first run", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "Bullet item",
          list: { kind: "bullet", indent: 2 },
          runs: [{ text: "Bullet " }, { text: "item", bold: true }],
        },
      ],
    };
    const runs = textContentToPptxRuns(content);

    assert.equal(runs[0].options?.bullet, true);
    assert.equal(runs[0].options?.indentLevel, 2);
    assert.equal(runs[1].options?.bullet, undefined);
    assert.equal(runs[1].options?.indentLevel, undefined);
  });

  test("numbered list paragraph maps number style and clamps indent", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "Numbered item",
          list: { kind: "number", numberStyle: "lower-alpha", indent: 12 },
        },
      ],
    };
    const [run] = textContentToPptxRuns(content);

    assert.deepEqual(run.options?.bullet, {
      type: "number",
      style: "alphaLcPeriod",
    });
    assert.equal(run.options?.indentLevel, 8);
  });

  test("bold, italic, underline, strikethrough flags are forwarded to run options", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "styled",
          runs: [
            {
              text: "styled",
              bold: true,
              italic: true,
              underline: true,
              strikethrough: true,
            },
          ],
        },
      ],
    };
    const [run] = textContentToPptxRuns(content);
    assert.equal(run.options?.bold, true);
    assert.equal(run.options?.italic, true);
    assert.deepEqual(run.options?.underline, { style: "sng" });
    assert.equal(run.options?.strike, true);
  });

  test("localStyle color is stripped of # and uppercased", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "colored",
          runs: [{ text: "colored", localStyle: { color: "#cc0011" } }],
        },
      ],
    };
    const [run] = textContentToPptxRuns(content);
    assert.equal(run.options?.color, "CC0011");
  });

  test("localStyle fontSizePt is forwarded as fontSize", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "big",
          runs: [{ text: "big", localStyle: { fontSizePt: 32 } }],
        },
      ],
    };
    const [run] = textContentToPptxRuns(content);
    assert.equal(run.options?.fontSize, 32);
  });

  test("hyperlink run sets hyperlink option", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "link",
          runs: [{ text: "link", link: "https://example.com" }],
        },
      ],
    };
    const [run] = textContentToPptxRuns(content);
    assert.deepEqual(run.options?.hyperlink, { url: "https://example.com" });
  });

  test("newline run text is replaced with empty string", () => {
    const content: TextContent = {
      paragraphs: [
        {
          id: "p1",
          text: "\n",
          runs: [{ text: "\n" }],
        },
        { id: "p2", text: "after" },
      ],
    };
    const runs = textContentToPptxRuns(content);
    assert.equal(runs[0].text, "");
  });

  test("empty paragraphs array returns empty runs", () => {
    const content: TextContent = { paragraphs: [] };
    const runs = textContentToPptxRuns(content);
    assert.deepEqual(runs, []);
  });
});

// ---------------------------------------------------------------------------
// vnextShapeToName
// ---------------------------------------------------------------------------

describe("vnextShapeToName", () => {
  test("known shapes map to pptxgenjs names", () => {
    assert.equal(vnextShapeToName("rect"), "rect");
    assert.equal(vnextShapeToName("ellipse"), "ellipse");
    assert.equal(vnextShapeToName("circle"), "ellipse");
    assert.equal(vnextShapeToName("line"), "line");
    assert.equal(vnextShapeToName("triangle"), "triangle");
    assert.equal(vnextShapeToName("diamond"), "diamond");
    assert.equal(vnextShapeToName("roundRect"), "roundRect");
  });

  test("unknown shape falls back to rect", () => {
    assert.equal(vnextShapeToName("hexagon"), "rect");
    assert.equal(vnextShapeToName(""), "rect");
  });
});

// ---------------------------------------------------------------------------
// applyVnextTextOp
// ---------------------------------------------------------------------------

describe("applyVnextTextOp", () => {
  function makeTextOp(
    overrides: Partial<VnextPptxTextOp> = {},
  ): VnextPptxTextOp {
    return {
      type: "text",
      id: "t1",
      x: 1,
      y: 0.5,
      w: 8,
      h: 1,
      content: { paragraphs: [{ id: "p1", text: "Hello" }] },
      textStyle: { color: "111111", fontSize: 18 },
      zIndex: 1,
      ...overrides,
    };
  }

  test("calls addText on the mock slide", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(slide as never, makeTextOp());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "addText");
  });

  test("passes x, y, w, h dimensions", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(slide as never, makeTextOp({ x: 2, y: 1, w: 5, h: 2 }));
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.x, 2);
    assert.equal(opts.y, 1);
    assert.equal(opts.w, 5);
    assert.equal(opts.h, 2);
  });

  test("color from textStyle is forwarded", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(
      slide as never,
      makeTextOp({ textStyle: { color: "FF0000" } }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.color, "FF0000");
  });

  test("rotation is mapped to rotate", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(slide as never, makeTextOp({ rotation: 45 }));
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.rotate, 45);
  });

  test("text-level strikethrough style maps to strike", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(
      slide as never,
      makeTextOp({ textStyle: { strikethrough: true } }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.strike, true);
  });

  test("line height and paragraph spacing map to PptxGenJS text options", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTextOp(
      slide as never,
      makeTextOp({
        textStyle: {
          lineHeightMultiple: 1.3,
          paragraphSpacePt: 9,
        },
      }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;

    assert.equal(opts.lineSpacingMultiple, 1.3);
    assert.equal(opts.paraSpaceAfter, 9);
  });

  test("multi-paragraph content uses run array form", () => {
    const { slide, calls } = makeMockSlide();
    const op = makeTextOp({
      content: {
        paragraphs: [
          { id: "p1", text: "First" },
          { id: "p2", text: "Second" },
        ],
      },
    });
    applyVnextTextOp(slide as never, op);
    const firstArg = calls[0].args[0];
    assert.ok(
      Array.isArray(firstArg),
      "Expected run array for multi-paragraph content",
    );
    assert.equal((firstArg as PptxTextRun[]).length, 2);
  });
});

// ---------------------------------------------------------------------------
// applyVnextShapeOp
// ---------------------------------------------------------------------------

describe("applyVnextShapeOp", () => {
  function makeShapeOp(
    overrides: Partial<VnextPptxShapeOp> = {},
  ): VnextPptxShapeOp {
    return {
      type: "shape",
      id: "s1",
      shape: "rect",
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      fill: "003399",
      zIndex: 1,
      ...overrides,
    };
  }

  test("calls addShape on the mock slide", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(slide as never, makeShapeOp());
    assert.ok(calls.some((c) => c.kind === "addShape"));
  });

  test("circle shape maps to ellipse", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(slide as never, makeShapeOp({ shape: "circle" }));
    const shapeCall = calls.find((c) => c.kind === "addShape");
    assert.equal(shapeCall?.args[0], "ellipse");
  });

  test("fill color is forwarded as fill.color", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(slide as never, makeShapeOp({ fill: "AABBCC" }));
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.deepEqual(opts.fill, { color: "AABBCC" });
  });

  test("stroke is forwarded as line", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(
      slide as never,
      makeShapeOp({ stroke: { color: "000000", widthPt: 1 } }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.deepEqual(opts.line, { color: "000000", width: 1 });
  });

  test("image-retry fill is embedded as an image with stroke overlay", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(
      slide as never,
      makeShapeOp({
        fill: {
          kind: "image",
          assetId: "data:image/svg+xml;base64,PHN2Zy8+",
          fit: "cover",
        },
        stroke: { color: "000000", widthPt: 1 },
      }),
    );
    assert.equal(calls[0].kind, "addImage");
    const imageOpts = calls[0].args[0] as Record<string, unknown>;
    assert.ok("data" in imageOpts);
    assert.deepEqual(imageOpts.sizing, { type: "cover", w: 4, h: 2 });
    assert.equal(calls[1].kind, "addShape");
    const strokeOpts = calls[1].args[1] as Record<string, unknown>;
    assert.deepEqual(strokeOpts.fill, { transparency: 100 });
  });

  test("shape op only calls addShape", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(slide as never, makeShapeOp());
    const textCalls = calls.filter((c) => c.kind === "addText");
    assert.equal(textCalls.length, 0);
  });

  test("shape without text only calls addShape", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextShapeOp(slide as never, makeShapeOp());
    assert.ok(calls.every((c) => c.kind === "addShape"));
  });
});

// ---------------------------------------------------------------------------
// applyVnextTableOp
// ---------------------------------------------------------------------------

describe("applyVnextTableOp", () => {
  function makeTable(): TableContent {
    return {
      columns: [
        { id: "c1", label: "Name" },
        { id: "c2", label: "Value" },
      ],
      rows: [
        { id: "r1", cells: [{ text: "Alpha" }, { text: "1" }] },
        { id: "r2", cells: [{ text: "Beta" }, { text: "2" }] },
      ],
      header: true,
    };
  }

  function makeTableOp(
    overrides: Partial<VnextPptxTableOp> = {},
  ): VnextPptxTableOp {
    return {
      type: "tableShape",
      id: "tbl1",
      x: 1,
      y: 1,
      w: 10,
      h: 4,
      table: makeTable(),
      zIndex: 1,
      ...overrides,
    };
  }

  test("calls addTable on the mock slide", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "addTable");
  });

  test("header row uses column labels with bold", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp());
    const rows = calls[0].args[0] as Array<
      Array<{ text: string; options?: Record<string, unknown> }>
    >;
    assert.equal(rows[0][0].text, "Name");
    assert.equal(rows[0][1].text, "Value");
    assert.equal(rows[0][0].options?.bold, true);
  });

  test("data rows are appended after header", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp());
    const rows = calls[0].args[0] as Array<Array<{ text: string }>>;
    assert.equal(rows.length, 3); // 1 header + 2 data
    assert.equal(rows[1][0].text, "Alpha");
    assert.equal(rows[2][0].text, "Beta");
  });

  test("headerFill is applied to header cells", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp({ headerFill: "003399" }));
    const rows = calls[0].args[0] as Array<
      Array<{ options?: Record<string, unknown> }>
    >;
    assert.deepEqual(rows[0][0].options?.fill, { color: "003399" });
  });

  test("rowFill is applied to data cells", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp({ rowFill: "EEEEEE" }));
    const rows = calls[0].args[0] as Array<
      Array<{ options?: Record<string, unknown> }>
    >;
    assert.deepEqual(rows[1][0].options?.fill, { color: "EEEEEE" });
  });

  test("alternateRowFill is applied to alternating data rows", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(
      slide as never,
      makeTableOp({ rowFill: "FFFFFF", alternateRowFill: "F1F5F9" }),
    );
    const rows = calls[0].args[0] as Array<
      Array<{ options?: Record<string, unknown> }>
    >;
    assert.deepEqual(rows[1][0].options?.fill, { color: "FFFFFF" });
    assert.deepEqual(rows[2][0].options?.fill, { color: "F1F5F9" });
  });

  test("cell rich runs are passed through with run options", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(
      slide as never,
      makeTableOp({
        table: {
          ...makeTable(),
          rows: [
            {
              id: "r1",
              cells: [
                {
                  text: "Rich",
                  runs: [
                    {
                      text: "Ri",
                      bold: true,
                      localStyle: { color: "#ff0000", fontSizePt: 14 },
                    },
                    { text: "ch", italic: true },
                  ],
                },
                { text: "1" },
              ],
            },
          ],
        },
      }),
    );
    const rows = calls[0].args[0] as Array<Array<{ text: unknown }>>;
    assert.deepEqual(rows[1][0].text, [
      { text: "Ri", options: { bold: true, color: "FF0000", fontSize: 14 } },
      { text: "ch", options: { italic: true } },
    ]);
  });

  test("border and cell margin are passed to addTable options", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(
      slide as never,
      makeTableOp({
        border: { color: "334455", widthPt: 1.5, dash: "dashed" },
        cellMargin: [0.1, 0.2, 0.3, 0.4],
      }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.deepEqual(opts.border, {
      color: "334455",
      pt: 1.5,
      type: "dash",
    });
    assert.deepEqual(opts.margin, [0.1, 0.2, 0.3, 0.4]);
  });

  test("caption is emitted as a text box above the table", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(
      slide as never,
      makeTableOp({
        table: { ...makeTable(), caption: "Revenue by quarter" },
        textStyle: { fontSize: 10, fontFace: "Inter", color: "111827" },
      }),
    );
    assert.equal(calls[0].kind, "addText");
    assert.equal(calls[0].args[0], "Revenue by quarter");
    const captionOptions = calls[0].args[1] as Record<string, unknown>;
    assert.equal(captionOptions.x, 1);
    assert.ok(Math.abs((captionOptions.y as number) - 0.65) < 0.001);
    assert.equal(captionOptions.w, 10);
    assert.equal(captionOptions.h, 0.3);
    assert.equal(captionOptions.fontSize, 10);
    assert.equal(captionOptions.fontFace, "Inter");
    assert.equal(captionOptions.color, "111827");
    assert.equal(calls[1].kind, "addTable");
  });

  test("passes x, y, w, h to addTable options", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextTableOp(slide as never, makeTableOp({ x: 2, y: 3, w: 9, h: 5 }));
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.x, 2);
    assert.equal(opts.y, 3);
    assert.equal(opts.w, 9);
    assert.equal(opts.h, 5);
  });
});

// ---------------------------------------------------------------------------
// applyVnextConnectorOp
// ---------------------------------------------------------------------------

describe("applyVnextConnectorOp", () => {
  function makeConnectorOp(
    overrides: Partial<VnextPptxConnectorOp> = {},
  ): VnextPptxConnectorOp {
    return {
      type: "connector",
      id: "con1",
      from: { kind: "point", point: { x: 0, y: 0 } },
      to: { kind: "point", point: { x: 100, y: 0 } },
      x: 0,
      y: 0,
      w: 5,
      h: 0,
      zIndex: 1,
      ...overrides,
    };
  }

  test("calls addShape with line", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextConnectorOp(slide as never, makeConnectorOp());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "addShape");
    assert.equal(calls[0].args[0], "line");
  });

  test("stroke is forwarded as line options", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextConnectorOp(
      slide as never,
      makeConnectorOp({ stroke: { color: "FF0000", widthPt: 2 } }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.deepEqual(opts.line, {
      color: "FF0000",
      width: 2,
      dashType: "solid",
    });
  });

  test("connector without stroke emits no line property", () => {
    const { slide, calls } = makeMockSlide();
    applyVnextConnectorOp(
      slide as never,
      makeConnectorOp({ stroke: undefined }),
    );
    const opts = calls[0].args[1] as Record<string, unknown>;
    assert.equal(opts.line, undefined);
  });
});

// ---------------------------------------------------------------------------
// applyVnextImageOp
// ---------------------------------------------------------------------------

describe("applyVnextImageOp", () => {
  function makeImageOp(
    overrides: Partial<VnextPptxImageOp> = {},
  ): VnextPptxImageOp {
    return {
      type: "image",
      id: "img1",
      assetId: "https://example.com/photo.png",
      x: 1,
      y: 1,
      w: 4,
      h: 3,
      zIndex: 1,
      ...overrides,
    };
  }

  test("calls addImage with path source for non-data URI", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(slide as never, makeImageOp());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "addImage");
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.ok("path" in opts, "Expected path key for non-data URI");
  });

  test("calls addImage with data source for data URI", async () => {
    const { slide, calls } = makeMockSlide();
    const dataUri = "data:image/png;base64,abc123";
    await applyVnextImageOp(slide as never, makeImageOp({ assetId: dataUri }));
    assert.equal(calls.length, 1);
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.ok("data" in opts, "Expected data key for data URI");
  });

  test("skips addImage when assetId is empty", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(slide as never, makeImageOp({ assetId: "" }));
    assert.equal(calls.length, 0, "No addImage call when assetId empty");
  });

  test("forwards alt text and rotation", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(
      slide as never,
      makeImageOp({ alt: "A picture", rotation: 30 }),
    );
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.equal(opts.altText, "A picture");
    assert.equal(opts.rotate, 30);
  });

  test("forwards crop as PPTX image sizing", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(
      slide as never,
      makeImageOp({
        crop: { top: 10, right: 20, bottom: 30, left: 5 },
      }),
    );
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.deepEqual(opts.sizing, {
      type: "crop",
      x: "5%",
      y: "10%",
      w: "75%",
      h: "60%",
    });
  });

  test("forwards contain fit as PPTX image sizing when no crop is present", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(slide as never, makeImageOp({ fit: "contain" }));
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.deepEqual(opts.sizing, {
      type: "contain",
      w: 4,
      h: 3,
    });
  });

  test("ignores zero crop values and falls back to cover fit sizing", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextImageOp(
      slide as never,
      makeImageOp({
        fit: "cover",
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    );
    const opts = calls[0].args[0] as Record<string, unknown>;
    assert.deepEqual(opts.sizing, {
      type: "cover",
      w: 4,
      h: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// applyVnextVisualOp
// ---------------------------------------------------------------------------

describe("applyVnextVisualOp", () => {
  function makeVisualOp(
    overrides: Partial<VnextPptxVisualOp> = {},
  ): VnextPptxVisualOp {
    return {
      type: "visual",
      id: "visual1",
      visualId: "doc-visual-1",
      x: 1,
      y: 1,
      w: 4,
      h: 3,
      channelColors: {
        primary: "#111111",
        secondary: "#222222",
        accent: "#ffcc00",
        muted: "#aaaaaa",
      },
      zIndex: 1,
      ...overrides,
    };
  }

  test("renders a deterministic placeholder with channel colors", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextVisualOp(slide as never, makeVisualOp());
    const shapeCalls = calls.filter((call) => call.kind === "addShape");
    assert.ok(shapeCalls.length >= 4);
    const firstBar = shapeCalls[1].args[1] as Record<string, unknown>;
    assert.deepEqual(firstBar.fill, { color: "111111" });
    assert.ok(calls.some((call) => call.kind === "addText"));
  });

  test("uses image export when a visual asset source is available", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextVisualOp(
      slide as never,
      makeVisualOp({ assetId: "https://example.com/visual.png" }),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "addImage");
  });

  test("omits placeholder fill for transparent visual backgrounds", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextVisualOp(
      slide as never,
      makeVisualOp({ transparentBackground: true, rotation: 15 }),
    );
    const background = calls[0].args[1] as Record<string, unknown>;
    assert.equal("fill" in background, false);
    assert.equal(background.rotate, 15);
  });

  test("uses default visual colors when channel colors are omitted", async () => {
    const { slide, calls } = makeMockSlide();
    await applyVnextVisualOp(
      slide as never,
      makeVisualOp({ channelColors: undefined, transparentBackground: false }),
    );
    const firstBar = calls.filter((call) => call.kind === "addShape")[1]
      .args[1] as Record<string, unknown>;
    assert.deepEqual(firstBar.fill, { color: "2563EB" });
  });
});

// ---------------------------------------------------------------------------
// applyVnextPptxSpec / exportDeckV7AsPPTX
// ---------------------------------------------------------------------------

describe("PPTX assembly boundaries", () => {
  test("applyVnextPptxSpec assembles slides, dispatches ops, and includes notes", async () => {
    const spec: VnextPptxDeckSpec = {
      layout: "LAYOUT_WIDE",
      slideW: 13.333,
      slideH: 7.5,
      diagnostics: [],
      slides: [
        {
          id: "slide-1",
          background: { type: "background", fill: "FFFFFF" },
          notes: "Speaker note",
          ops: [
            {
              type: "text",
              id: "text-1",
              x: 0.5,
              y: 0.5,
              w: 3,
              h: 0.5,
              content: { paragraphs: [{ id: "p1", text: "Hello" }] },
              textStyle: { fontSize: 18, color: "111111" },
              zIndex: 1,
            },
            {
              type: "shape",
              id: "shape-1",
              shape: "rect",
              x: 0.5,
              y: 1.25,
              w: 2,
              h: 1,
              fill: "EEEEEE",
              stroke: { color: "111111", widthPt: 1 },
              zIndex: 2,
            },
            {
              type: "connector",
              id: "line-1",
              from: { kind: "point", point: { x: 0, y: 0 } },
              to: { kind: "point", point: { x: 100, y: 0 } },
              x: 0.5,
              y: 2.5,
              w: 2,
              h: 0,
              stroke: { color: "111111", widthPt: 1 },
              zIndex: 3,
            },
            {
              type: "visual",
              id: "visual-1",
              visualId: "chart-1",
              x: 3,
              y: 1,
              w: 2.5,
              h: 1.5,
              zIndex: 4,
            },
            {
              type: "tableShape",
              id: "table-1",
              x: 0.5,
              y: 3,
              w: 5,
              h: 1.25,
              table: {
                columns: [{ id: "metric", label: "Metric" }],
                rows: [{ id: "row-1", cells: [{ text: "NPS" }] }],
              },
              headerFill: "003399",
              rowFill: "F8FAFC",
              textStyle: { fontSize: 10, fontFace: "Inter" },
              zIndex: 5,
            },
          ],
        },
      ],
    };

    const blob = await applyVnextPptxSpec(spec);

    assert.ok(blob);
    assert.equal(
      blob.type,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    assert.ok(blob.size > 0);
  });

  test("exportDeckV7AsPPTX runs the v7 export pipeline with an explicit theme package", async () => {
    const deck = buildDeckV7([buildContentSlide("Pipeline")], {
      theme: { packageId: "test-package" },
    });

    const blob = await exportDeckV7AsPPTX(deck, buildMinimalThemePackage(), {
      canvasWidthPx: 960,
      canvasHeightPx: 540,
    });

    assert.ok(blob);
    assert.equal(
      blob.type,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});
