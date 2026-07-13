/**
 * Direct behavior coverage for `document-export-targets.ts` (#1947):
 * `exportDocumentAsPDF`, `exportDocumentAsPPTX`, `exportDocumentAsInfographic`.
 *
 * The real `jspdf` and `pptxgenjs` packages run fine under plain Node — no
 * DOM is required to *write* a PDF or a PPTX archive — so this file mirrors
 * `src/lib/visual/export.test.ts`'s `installBrowserStubs()` pattern (fakes
 * only `document.createElement("canvas")`, `Image`, `FileReader`,
 * `XMLSerializer`, and `URL.createObjectURL`/`revokeObjectURL`) and asserts
 * on the *produced artifact's* observable structure:
 *   - PDF: jsPDF's default output is an uncompressed, plain-text PDF stream,
 *     so page count (`/Type\s*\/Page\b/g`), per-page `/MediaBox/` (portrait
 *     vs landscape), and rendered text content are all readable directly off
 *     the blob's bytes via regex/substring checks (mirrors the technique
 *     already used for `exportPDF` assertions elsewhere in this codebase).
 *   - PPTX: `src/lib/document/deck-kernel/export/deck-export-pptx.test.ts`'s
 *     pattern — load the produced archive with `jszip` and inspect
 *     `ppt/slides/slideN.xml` for slide count and content (native `<p:sp>`
 *     shapes vs `<p:pic>` image-fallback elements).
 *   - Infographic: assertions run against the recording fake 2D canvas
 *     context (fillText/fillRect/drawImage/arc call log) installed in place
 *     of the real Canvas API, cross-checked against the pure
 *     `computeInfographicLayout` oracle for visual-block draw geometry.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import JSZip from "jszip";

import {
  exportDocumentAsInfographic,
  exportDocumentAsPDF,
  exportDocumentAsPPTX,
} from "@/lib/visual/document-export-targets";
import { computeInfographicLayout } from "@/lib/visual/infographic-layout";
import { FIXTURES } from "@/lib/visual/fixtures";
import { buildVisual } from "@/test/builders/visual";
import type {
  DocumentBlock,
  DocumentTableBlock,
  DocumentTextBlock,
  DocumentVisualBlock,
} from "@/lib/content";

// ---------------------------------------------------------------------------
// Shared browser-API stubs
// ---------------------------------------------------------------------------

const ORIGINALS = {
  document: globalThis.document,
  Image: globalThis.Image,
  FileReader: globalThis.FileReader,
  XMLSerializer: globalThis.XMLSerializer,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

afterEach(() => {
  globalThis.document = ORIGINALS.document;
  globalThis.Image = ORIGINALS.Image;
  globalThis.FileReader = ORIGINALS.FileReader;
  globalThis.XMLSerializer = ORIGINALS.XMLSerializer;
  URL.createObjectURL = ORIGINALS.createObjectURL;
  URL.revokeObjectURL = ORIGINALS.revokeObjectURL;
});

function svgElement(width: number, height: number): SVGSVGElement {
  return {
    viewBox: { baseVal: { width, height } },
  } as unknown as SVGSVGElement;
}

type CanvasCalls = {
  fillRect: Array<[number, number, number, number]>;
  fillText: Array<[string, number, number]>;
  drawImage: Array<[number, number, number, number]>;
  scale: Array<[number, number]>;
  arc: Array<[number, number, number, number, number]>;
  strokeCount: number;
  props: Record<string, unknown>;
};

function fakeCanvasContext(): {
  ctx: CanvasRenderingContext2D;
  calls: CanvasCalls;
} {
  const calls: CanvasCalls = {
    fillRect: [],
    fillText: [],
    drawImage: [],
    scale: [],
    arc: [],
    strokeCount: 0,
    props: {},
  };
  const ctx = {
    scale: (x: number, y: number) => calls.scale.push([x, y]),
    drawImage: (_image: unknown, x: number, y: number, w: number, h: number) =>
      calls.drawImage.push([x, y, w, h]),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.fillRect.push([x, y, w, h]),
    fillText: (text: string, x: number, y: number) =>
      calls.fillText.push([text, x, y]),
    measureText: (text: string) => ({ width: text.length * 7 }),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {
      calls.strokeCount++;
    },
    arc: (x: number, y: number, r: number, start: number, end: number) =>
      calls.arc.push([x, y, r, start, end]),
    fill: () => {},
    set fillStyle(value: unknown) {
      calls.props.fillStyle = value;
    },
    get fillStyle() {
      return calls.props.fillStyle as string;
    },
    set font(value: unknown) {
      calls.props.font = value;
    },
    get font() {
      return calls.props.font as string;
    },
    set strokeStyle(value: unknown) {
      calls.props.strokeStyle = value;
    },
    get strokeStyle() {
      return calls.props.strokeStyle as string;
    },
    set globalAlpha(value: unknown) {
      calls.props.globalAlpha = value;
    },
    get globalAlpha() {
      return calls.props.globalAlpha as number;
    },
    set lineWidth(value: unknown) {
      calls.props.lineWidth = value;
    },
    get lineWidth() {
      return calls.props.lineWidth as number;
    },
    set textAlign(value: unknown) {
      calls.props.textAlign = value;
    },
    get textAlign() {
      return calls.props.textAlign as string;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

type FakeCanvas = {
  width: number;
  height: number;
  ctxEntry: { ctx: CanvasRenderingContext2D; calls: CanvasCalls } | null;
  toBlobResult: "default" | null;
};

type InstallOptions = {
  svg?: string;
  imageError?: boolean;
  /** Per-canvas-creation-index context override. `null` simulates
   * `getContext("2d")` returning null (unsupported canvas). Indices beyond
   * the array length use a normal working context. */
  contextForIndex?: Array<"default" | null>;
  /** Per-canvas-creation-index `toBlob` override. `null` simulates a failed
   * PNG encode (`canvas.toBlob` invoking its callback with `null`). */
  toBlobForIndex?: Array<"default" | null>;
};

const BASE_SVG =
  '<svg viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" fill="#fff"/></svg>';

function installStubs(options: InstallOptions = {}) {
  const canvases: FakeCanvas[] = [];

  function pickChoice<T>(
    arr: Array<T> | undefined,
    index: number,
  ): T | "default" {
    if (!arr || index >= arr.length) return "default";
    return arr[index] as T;
  }

  globalThis.XMLSerializer = class {
    serializeToString() {
      return options.svg ?? BASE_SVG;
    }
  } as typeof XMLSerializer;

  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => {
        if (options.imageError) {
          this.onerror?.();
        } else {
          this.onload?.();
        }
      });
    }
  } as unknown as typeof Image;

  globalThis.FileReader = class {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsDataURL(_blob: Blob) {
      this.result =
        "data:image/png;base64," +
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      queueMicrotask(() => this.onloadend?.());
    }
  } as unknown as typeof FileReader;

  globalThis.document = {
    createElement(tag: string) {
      if (tag !== "canvas") {
        return { style: {} };
      }
      const index = canvases.length;
      const contextChoice = pickChoice(options.contextForIndex, index);
      const ctxEntry = contextChoice === null ? null : fakeCanvasContext();
      const toBlobChoice = pickChoice(options.toBlobForIndex, index);
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        ctxEntry,
        toBlobResult: toBlobChoice,
      };
      canvases.push(canvas);
      return {
        get width() {
          return canvas.width;
        },
        set width(value: number) {
          canvas.width = value;
        },
        get height() {
          return canvas.height;
        },
        set height(value: number) {
          canvas.height = value;
        },
        getContext: () => (ctxEntry ? ctxEntry.ctx : null),
        toBlob(callback: BlobCallback, type?: string) {
          if (canvas.toBlobResult === null) {
            callback(null);
            return;
          }
          callback(new Blob(["png"], { type: type ?? "image/png" }));
        },
      };
    },
  } as unknown as Document;

  URL.createObjectURL = () => "blob:document-export";
  URL.revokeObjectURL = () => {};

  return {
    canvases,
    /** Convenience accessor for the calls log of the Nth created canvas. */
    callsFor(index: number): CanvasCalls | null {
      return canvases[index]?.ctxEntry?.calls ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// PDF byte-level introspection helpers
// ---------------------------------------------------------------------------

async function pdfText(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.toString("latin1");
}

function pageCount(pdfSource: string): number {
  return (pdfSource.match(/\/Type\s*\/Page\b/g) ?? []).length;
}

function mediaBoxes(pdfSource: string): Array<{ w: number; h: number }> {
  const matches = [...pdfSource.matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)];
  return matches.map((m) => {
    const nums = m[1]!.trim().split(/\s+/).map(Number);
    return { w: nums[2]! - nums[0]!, h: nums[3]! - nums[1]! };
  });
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function textBlock(
  blockType: DocumentTextBlock["blockType"],
  text: string,
  level?: 1 | 2 | 3,
): DocumentTextBlock {
  return { kind: "text", blockType, text, ...(level ? { level } : {}) };
}

function visualBlock(
  visualId: string,
  visual = buildVisual(),
): DocumentVisualBlock {
  return { kind: "visual", visualId, visual };
}

function tableBlock(): DocumentTableBlock {
  return {
    kind: "table",
    columns: [
      { id: "c1", label: "Name" },
      { id: "c2", label: "Score" },
    ],
    rows: [{ id: "r1", cells: [{ text: "Alice" }, { text: "9" }] }],
  };
}

// ---------------------------------------------------------------------------
// exportDocumentAsPDF
// ---------------------------------------------------------------------------

describe("exportDocumentAsPDF", () => {
  test("an empty document yields a single portrait title page containing the title", async () => {
    installStubs();
    const blob = await exportDocumentAsPDF([], "My Document", () => null);
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
    assert.deepEqual(mediaBoxes(text), [{ w: 210, h: 297 }].map(mmApprox));
    assert.ok(text.includes("My Document"));
  });

  test("renders headings, paragraphs, quotes, list items, and tables as text on a single page", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Section One", 1),
      textBlock("paragraph", "Some body copy."),
      textBlock("quote", "A memorable quote"),
      textBlock("listitem", "First item"),
      tableBlock(),
    ];
    const blob = await exportDocumentAsPDF(blocks, "Doc Title", () => null);
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
    assert.ok(text.includes("Doc Title"));
    assert.ok(text.includes("Section One"));
    assert.ok(text.includes("Some body copy."));
    assert.ok(text.includes('"A memorable quote"'));
    // jsPDF encodes the bullet glyph via WinAnsiEncoding (byte 0x95), not the
    // literal UTF-8 "•" (U+2022), when it serializes the content stream.
    assert.ok(text.includes("\x95 First item"));
    assert.ok(text.includes("Name"));
    assert.ok(text.includes("Alice"));
  });

  test("skips blank text blocks without consuming vertical space or erroring", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("paragraph", "   "),
      textBlock("paragraph", "Visible line"),
    ];
    const blob = await exportDocumentAsPDF(blocks, "", () => null);
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.ok(text.includes("Visible line"));
  });

  test("gives a wide visual its own landscape page, and a tall visual its own portrait page", async () => {
    const stubs = installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Intro", 1),
      visualBlock("wide", buildVisual()),
      visualBlock("tall", buildVisual()),
    ];
    const svgs: Record<string, SVGSVGElement> = {
      wide: svgElement(800, 400), // landscape
      tall: svgElement(300, 600), // portrait
    };
    const blob = await exportDocumentAsPDF(
      blocks,
      "Doc",
      (id) => svgs[id] ?? null,
    );
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 3);
    const boxes = mediaBoxes(text);
    assert.equal(boxes.length, 3);
    assert.ok(boxes[0].w < boxes[0].h, "title/heading page is portrait");
    assert.ok(boxes[1].w > boxes[1].h, "wide visual page is landscape");
    assert.ok(boxes[2].w < boxes[2].h, "tall visual page is portrait");
    void stubs;
  });

  test("forces text following a visual onto a fresh portrait page", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Before", 1),
      visualBlock("v1", buildVisual()),
      textBlock("paragraph", "After the visual"),
    ];
    const blob = await exportDocumentAsPDF(blocks, "Doc", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 3);
    assert.ok(text.includes("After the visual"));
  });

  test("skips a visual block whose SVG cannot be resolved (getSvg returns null)", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [visualBlock("missing")];
    const blob = await exportDocumentAsPDF(blocks, "Doc", () => null);
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
  });

  test("skips a visual block with a zero-area viewBox", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [visualBlock("zero")];
    const blob = await exportDocumentAsPDF(blocks, "Doc", () =>
      svgElement(0, 100),
    );
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
  });

  test("skips a visual block when PNG rasterization fails (canvas unsupported)", async () => {
    installStubs({ contextForIndex: [null] });
    const blocks: DocumentBlock[] = [
      textBlock("paragraph", "Text stays on page one"),
      visualBlock("v1"),
    ];
    const blob = await exportDocumentAsPDF(blocks, "Doc", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
    assert.ok(text.includes("Text stays on page one"));
  });

  test("paginates long-running text across multiple pages", async () => {
    installStubs();
    const longParagraph =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40);
    const blocks: DocumentBlock[] = Array.from({ length: 20 }, () =>
      textBlock("paragraph", longParagraph),
    );
    const blob = await exportDocumentAsPDF(blocks, "Doc", () => null);
    assert.ok(blob);
    const text = await pdfText(blob!);
    assert.ok(pageCount(text) > 1, "expected automatic pagination");
  });
});

function mmApprox({ w, h }: { w: number; h: number }) {
  // jsPDF's raw /MediaBox is expressed in PDF points (1/72in) regardless of
  // the "mm" unit passed to the constructor (that unit only scales the
  // coordinates given to drawing calls like `.text()`/`.line()`). jsPDF's
  // built-in "a4" format table stores these as fixed 2-decimal-point
  // constants (595.28 x 841.89), so round mm->pt conversions to 2 decimals
  // rather than to the nearest whole point.
  const toPt = (mm: number) => Math.round(((mm * 72) / 25.4) * 100) / 100;
  return { w: toPt(w), h: toPt(h) };
}

// ---------------------------------------------------------------------------
// exportDocumentAsPPTX
// ---------------------------------------------------------------------------

async function slideXmlEntries(blob: Blob): Promise<string[]> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();
}

async function slideXml(blob: Blob, n: number): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  return zip.files[`ppt/slides/slide${n}.xml`]!.async("string");
}

describe("exportDocumentAsPPTX", () => {
  test("a document with no visuals produces a single title-only slide", async () => {
    installStubs();
    const blob = await exportDocumentAsPPTX([], "My Deck", () => null);
    assert.ok(blob);
    assert.equal(
      blob!.type,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    assert.deepEqual(await slideXmlEntries(blob!), ["ppt/slides/slide1.xml"]);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("My Deck"));
  });

  test("falls back to 'Untitled document' text when no visuals and no title are given", async () => {
    installStubs();
    const blob = await exportDocumentAsPPTX([], "", () => null);
    assert.ok(blob);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("Untitled document"));
  });

  test("emits one slide per visual, titled with the nearest preceding heading", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "First Section", 1),
      visualBlock("v1", FIXTURES.flowchart),
      textBlock("heading", "Second Section", 2),
      visualBlock("v2", FIXTURES.flowchart),
    ];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    assert.deepEqual(await slideXmlEntries(blob!), [
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
    ]);
    const xml1 = await slideXml(blob!, 1);
    const xml2 = await slideXml(blob!, 2);
    assert.ok(xml1.includes("First Section"));
    assert.ok(xml2.includes("Second Section"));
  });

  test("renders native shapes (no <p:pic>) for a visual kind pptx-shapes supports", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [visualBlock("v1", FIXTURES.flowchart)];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("<p:sp>"), "expected native shape elements");
    assert.ok(!xml.includes("<p:pic>"), "must not fall back to an image");
  });

  test("falls back to an embedded image (<p:pic>) for a visual kind with no native shape support", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [visualBlock("v1", FIXTURES.funnel)];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("<p:pic>"), "expected an image-fallback element");
  });

  test("falls back to a title-only slide when a single visual's SVG cannot be resolved", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      visualBlock("missing", FIXTURES.flowchart),
    ];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", () => null);
    assert.ok(blob);
    // No visual slide was actually emitted, so the deck must still contain
    // exactly one (title-only) fallback slide rather than being empty.
    assert.deepEqual(await slideXmlEntries(blob!), ["ppt/slides/slide1.xml"]);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("Deck"));
    assert.ok(!xml.includes("<p:pic>"));
  });

  test("falls back to a title-only slide when every visual is unresolvable (zero-area viewBox and unresolved SVG mixed)", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Section", 1),
      visualBlock("zero", FIXTURES.flowchart),
      visualBlock("missing", FIXTURES.funnel),
    ];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", (id) =>
      id === "zero" ? svgElement(0, 100) : null,
    );
    assert.ok(blob);
    assert.deepEqual(await slideXmlEntries(blob!), ["ppt/slides/slide1.xml"]);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("Deck"));
    assert.ok(!xml.includes("<p:pic>"));
  });

  test("emits only the valid slide (no fallback) when one visual resolves and another does not", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Kept Section", 1),
      visualBlock("missing", FIXTURES.flowchart),
      textBlock("heading", "Valid Section", 1),
      visualBlock("v1", FIXTURES.flowchart),
    ];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", (id) =>
      id === "v1" ? svgElement(400, 300) : null,
    );
    assert.ok(blob);
    // Exactly the one valid slide is present — no title-only fallback is
    // added since a real visual slide was already emitted.
    assert.deepEqual(await slideXmlEntries(blob!), ["ppt/slides/slide1.xml"]);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("Valid Section"));
    assert.ok(!xml.includes("Kept Section"));
    assert.ok(!xml.includes("Deck"));
  });

  test("still adds a (title-only) slide when image-fallback PNG rasterization fails", async () => {
    installStubs({ contextForIndex: [null] });
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Funnel overview", 1),
      visualBlock("v1", FIXTURES.funnel),
    ];
    const blob = await exportDocumentAsPPTX(blocks, "Deck", () =>
      svgElement(400, 300),
    );
    assert.ok(blob);
    // addVisualSlide() calls pptx.addSlide() (and adds the title text)
    // *before* attempting rasterization, so a PNG failure still leaves a
    // slide behind — just without the embedded image.
    assert.deepEqual(await slideXmlEntries(blob!), ["ppt/slides/slide1.xml"]);
    const xml = await slideXml(blob!, 1);
    assert.ok(xml.includes("Funnel overview"));
    assert.ok(!xml.includes("<p:pic>"));
  });
});

// ---------------------------------------------------------------------------
// exportDocumentAsInfographic
// ---------------------------------------------------------------------------

describe("exportDocumentAsInfographic", () => {
  test("draws each block type with the canvas 2D text/shape API and creates one canvas per visual raster", async () => {
    const stubs = installStubs();
    const visual = buildVisual();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Report Title", 1),
      textBlock("paragraph", "Body copy."),
      textBlock("quote", "Quoted wisdom"),
      textBlock("listitem", "Bullet point"),
      textBlock("hr", ""),
      tableBlock(),
      visualBlock("v1", visual),
    ];
    const blob = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => svgElement(200, 100),
      {},
    );
    assert.ok(blob);
    assert.equal(blob!.type, "image/png");

    // Canvas #0 is the compose canvas; canvas #1 is exportPNG's per-visual
    // raster (background+scale.drawImage → produced blob → drawn onto #0).
    assert.equal(stubs.canvases.length, 2);
    const composeCalls = stubs.callsFor(0)!;

    assert.ok(composeCalls.fillText.some(([text]) => text === "Report Title"));
    assert.ok(composeCalls.fillText.some(([text]) => text === "Body copy."));
    assert.ok(composeCalls.fillText.some(([text]) => text === "Quoted wisdom"));
    assert.ok(
      composeCalls.fillText.some(([text]) => text.includes("Bullet point")),
    );
    assert.ok(
      composeCalls.arc.length >= 1,
      "expected the list-item bullet dot",
    );
    assert.ok(composeCalls.strokeCount >= 1, "expected the <hr> stroke");
    assert.ok(
      composeCalls.fillText.some(([text]) => text.includes("Alice")),
      "expected the table markdown text",
    );
    assert.equal(composeCalls.drawImage.length, 1, "expected one visual draw");
  });

  test("draws the visual image at the geometry computed by the pure layout oracle", async () => {
    const stubs = installStubs();
    const visual = buildVisual();
    const blocks: DocumentBlock[] = [
      textBlock("heading", "Title", 1),
      visualBlock("v1", visual),
    ];
    const getSvg = () => svgElement(200, 100);
    const blob = await exportDocumentAsInfographic(blocks, "Doc", getSvg, {});
    assert.ok(blob);

    const layout = computeInfographicLayout(blocks, {
      width: 1080,
      paddingX: 80,
      paddingY: 64,
      gap: 24,
      fontH1: 52,
      fontH2: 40,
      fontH3: 30,
      fontBody: 24,
      lineHeight: 1.5,
      headingTopMargin: 32,
      background: "#ffffff",
      textColor: "#15171a",
      headingColor: "#1a1a2e",
      mutedColor: "#54666d",
      visualDimensions: { v1: { width: 200, height: 100 } },
    });
    const visualBlockLayout = layout.blocks[1]!;

    const composeCalls = stubs.callsFor(0)!;
    assert.equal(composeCalls.drawImage.length, 1);
    const [x, y, w, h] = composeCalls.drawImage[0]!;
    assert.equal(x, 80); // paddingX
    assert.equal(y, visualBlockLayout.y);
    assert.equal(w, layout.contentWidth);
    assert.equal(h, visualBlockLayout.height);
  });

  test("stamps a TextIQ watermark only when options.watermark is true", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [textBlock("paragraph", "Body")];

    const withWatermark = installStubs();
    const blobOn = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => null,
      {
        watermark: true,
      },
    );
    assert.ok(blobOn);
    assert.ok(
      withWatermark.callsFor(0)!.fillText.some(([text]) => text === "TextIQ"),
    );

    const withoutWatermark = installStubs();
    const blobOff = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => null,
      { watermark: false },
    );
    assert.ok(blobOff);
    assert.ok(
      !withoutWatermark
        .callsFor(0)!
        .fillText.some(([text]) => text === "TextIQ"),
    );
  });

  test("wraps the composed PNG in a single-page PDF sized to the image when outputFormat is 'pdf'", async () => {
    installStubs();
    const blocks: DocumentBlock[] = [textBlock("heading", "Wide Report", 1)];
    const blob = await exportDocumentAsInfographic(blocks, "Doc", () => null, {
      outputFormat: "pdf",
      config: { ...DEFAULT_CONFIG, width: 1080 },
    });
    assert.ok(blob);
    assert.equal(blob!.type, "application/pdf");
    const text = await pdfText(blob!);
    assert.equal(pageCount(text), 1);
  });

  test("skips a visual block whose SVG cannot be resolved without creating a raster canvas for it", async () => {
    const stubs = installStubs();
    const blocks: DocumentBlock[] = [
      textBlock("paragraph", "Text only"),
      visualBlock("missing"),
    ];
    const blob = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => null,
      {},
    );
    assert.ok(blob);
    // Only the compose canvas is created; no raster canvas for the
    // unresolved visual.
    assert.equal(stubs.canvases.length, 1);
  });

  test("returns null immediately when the compose canvas has no 2D context", async () => {
    installStubs({ contextForIndex: [null] });
    const blob = await exportDocumentAsInfographic(
      [textBlock("paragraph", "Text")],
      "Doc",
      () => null,
      {},
    );
    assert.equal(blob, null);
  });

  test("skips a specific visual whose PNG rasterization fails, but keeps drawing the rest of the document", async () => {
    // Canvas #0 = compose (working). Canvas #1 = exportPNG's raster for the
    // visual → force it to null to simulate that one visual's rasterization
    // failing.
    const stubs = installStubs({ contextForIndex: ["default", null] });
    const blocks: DocumentBlock[] = [
      visualBlock("v1"),
      textBlock("paragraph", "Still rendered"),
    ];
    const blob = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => svgElement(200, 100),
      {},
    );
    assert.ok(blob);
    const composeCalls = stubs.callsFor(0)!;
    assert.equal(composeCalls.drawImage.length, 0);
    assert.ok(
      composeCalls.fillText.some(([text]) => text === "Still rendered"),
    );
  });

  test("skips a visual when the rasterized image fails to load, without crashing", async () => {
    const stubs = installStubs({ imageError: true });
    const blocks: DocumentBlock[] = [
      visualBlock("v1"),
      textBlock("paragraph", "Still rendered"),
    ];
    const blob = await exportDocumentAsInfographic(
      blocks,
      "Doc",
      () => svgElement(200, 100),
      {},
    );
    assert.ok(blob);
    const composeCalls = stubs.callsFor(0)!;
    assert.equal(composeCalls.drawImage.length, 0);
    assert.ok(
      composeCalls.fillText.some(([text]) => text === "Still rendered"),
    );
  });

  test("returns null when the final canvas encode (toBlob) fails", async () => {
    installStubs({ toBlobForIndex: [null] });
    const blob = await exportDocumentAsInfographic(
      [textBlock("paragraph", "Text")],
      "Doc",
      () => null,
      {},
    );
    assert.equal(blob, null);
  });
});

const DEFAULT_CONFIG = {
  width: 1080,
  paddingX: 80,
  paddingY: 64,
  gap: 24,
  fontH1: 52,
  fontH2: 40,
  fontH3: 30,
  fontBody: 24,
  lineHeight: 1.5,
  headingTopMargin: 32,
  background: "#ffffff",
  textColor: "#15171a",
  headingColor: "#1a1a2e",
  mutedColor: "#54666d",
};
