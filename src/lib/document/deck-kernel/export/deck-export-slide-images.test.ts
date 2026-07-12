/**
 * Behavior coverage for the browser-only SVG/PNG slide-image renderer
 * (#1899, #1918).
 *
 * `exportDeckAsSlideImages` is tested end-to-end against the real `jszip`
 * package (works fine under plain Node) and asserts on the *structure and
 * content* of the produced SVG strings rather than committing binary golden
 * files. The `"png"` format path additionally exercises `@/lib/visual/export`
 * (`exportPNG`), which requires DOM canvas APIs unavailable under
 * `node --test`; that dependency resolves to `null` rather than throwing, so
 * these tests double as coverage of the renderer's per-slide rasterization
 * failure isolation (#1918) in an environment without a rasterizer.
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
import type { ImageElement, TextElement } from "../deck-elements";
import { createBlankVisual } from "@/lib/visual/blank";
import {
  exportDeckAsSlideImages,
  type DeckSlideImageDiagnostic,
} from "./deck-export-slide-images";

async function zipEntries(blob: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const entries: Record<string, string> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    entries[name] = await file.async("string");
  }
  return entries;
}

async function captureErrorRecords(
  fn: () => void | Promise<void>,
): Promise<Record<string, unknown>[]> {
  const original = console.error;
  const records: Record<string, unknown>[] = [];
  console.error = (line?: unknown) => {
    try {
      records.push(JSON.parse(String(line)));
    } catch {
      // Ignore unrelated non-JSON console output.
    }
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return records;
}

// ---------------------------------------------------------------------------
// Archive shape / ordering
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages produces one zero-padded SVG file per deck.slides entry, in order", async () => {
  const deck = makeDeck([
    makeSlide({ id: "s1" }),
    makeSlide({ id: "s2" }),
    makeSlide({ id: "s3" }),
  ]);
  const blob = await exportDeckAsSlideImages(deck, new Map(), () => null);
  assert.ok(blob);
  assert.equal(blob!.type, "application/zip");
  const entries = await zipEntries(blob!);
  assert.deepEqual(Object.keys(entries).sort(), [
    "slide-01.svg",
    "slide-02.svg",
    "slide-03.svg",
  ]);
});

// ---------------------------------------------------------------------------
// Slide background translation
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages renders a solid slide background as a full-bleed rect fill", async () => {
  const slide = makeSlide({
    id: "solid",
    designOverrides: {
      background: { type: "solid", color: { value: "#112233" } },
    },
  });
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    new Map(),
    () => null,
  );
  const [svg] = Object.values(await zipEntries(blob!));
  assert.match(
    svg!,
    /<rect x="0" y="0" width="1600" height="900" fill="#112233" \/>/,
  );
});

test("exportDeckAsSlideImages renders a radial gradient background via a gradient def referenced from the background rect", async () => {
  const slide = makeSlide({
    id: "radial",
    designOverrides: {
      background: {
        type: "radialGradient",
        inner: { value: "#ffffff" },
        outer: { value: "#000000" },
      },
    },
  });
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    new Map(),
    () => null,
  );
  const [svg] = Object.values(await zipEntries(blob!));
  assert.match(
    svg!,
    /<defs><radialGradient id="slide-0-background-radial-fill"/,
  );
  assert.match(svg!, /stop-color="#FFFFFF"/);
  assert.match(svg!, /stop-color="#000000"/);
  assert.match(svg!, /fill="url\(#slide-0-background-radial-fill\)"/);
});

test("exportDeckAsSlideImages renders a background image element as a full-bleed <image> tag", async () => {
  const slide = makeSlide({
    id: "image-bg",
    designOverrides: {
      background: { type: "image", url: "https://example.com/bg.png" },
    },
  });
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    new Map(),
    () => null,
  );
  const [svg] = Object.values(await zipEntries(blob!));
  assert.match(
    svg!,
    /<image href="https:\/\/example\.com\/bg\.png" x="0" y="0" width="1600" height="900"/,
  );
});

// ---------------------------------------------------------------------------
// Element op translation into the SVG body
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages renders text, shape, image, and connector ops into the slide SVG string", async () => {
  const text: TextElement = {
    id: "t1",
    kind: "text",
    box: { x: 5, y: 5, w: 40, h: 10 },
    zIndex: 3,
    content: { kind: "text", text: "Hello" },
  };
  const image: ImageElement = {
    id: "i1",
    kind: "image",
    box: { x: 5, y: 20, w: 20, h: 20 },
    zIndex: 4,
    content: { kind: "image", src: "data:image/png;base64,AAA" },
  };
  const shape = makeShape("s1", { zIndex: 0 });
  const connector = makeConnector(
    "c1",
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { zIndex: 1 },
  );
  const slide = makeSlide({
    id: "sl1",
    elements: [shape, text, image, connector],
  });
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    new Map(),
    () => null,
  );
  const [svg] = Object.values(await zipEntries(blob!));

  assert.match(svg!, /<rect[^>]*fill="#6366F1"/); // shape rect fill
  assert.match(
    svg!,
    /<foreignObject[^>]*>[\s\S]*Hello[\s\S]*<\/foreignObject>/,
  ); // text content
  assert.match(svg!, /<image href="data:image\/png;base64,AAA"/); // image element
  assert.match(svg!, /<line x1="0" y1="0" x2="799\.98" y2="450"/); // connector line
});

test("exportDeckAsSlideImages renders a resolvable visual element's native specs into the slide SVG", async () => {
  const visual = createBlankVisual("flowchart");
  const slide = makeSlide({
    id: "sl1",
    elements: [
      {
        id: "v1",
        kind: "visual",
        box: { x: 40, y: 20, w: 40, h: 40 },
        zIndex: 0,
        content: { kind: "visual", visualId: "vis-1" },
      },
    ],
  });
  const visuals = new Map([["vis-1", visual]]);
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    visuals,
    () => null,
  );
  const [svg] = Object.values(await zipEntries(blob!));
  // The flowchart's "Start" node label should appear somewhere in the rendered SVG.
  assert.match(svg!, /Start/);
});

// ---------------------------------------------------------------------------
// Invalid input / renderer failure propagation and cleanup
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages returns null when the deck fails to build export specs", async () => {
  const blob = await exportDeckAsSlideImages(
    {} as never,
    new Map(),
    () => null,
  );
  assert.equal(blob, null);
});

test("exportDeckAsSlideImages skips a visual-fallback op entirely when getSvg returns null", async () => {
  const visual = createBlankVisual("funnel");
  const slide = makeSlide({
    id: "sl1",
    elements: [
      {
        id: "v1",
        kind: "visual",
        box: { x: 0, y: 0, w: 10, h: 10 },
        zIndex: 0,
        content: { kind: "visual", visualId: "funnel-1" },
      },
    ],
  });
  const visuals = new Map([["funnel-1", visual]]);
  const blob = await exportDeckAsSlideImages(
    makeDeck([slide]),
    visuals,
    () => null,
  );
  assert.ok(blob);
  const [svg] = Object.values(await zipEntries(blob!));
  assert.ok(!svg!.includes("<svg x="));
});

// ---------------------------------------------------------------------------
// Per-operation / per-slide failure isolation (#1918)
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages isolates a fallback SVG serialization failure to its op, reports a diagnostic, and still exports every slide/op unaffected", async () => {
  const visual = createBlankVisual("funnel");
  const visuals = new Map([["funnel-1", visual]]);
  // A minimal fake "svg" missing DOM methods (getAttribute) — under Node
  // there is also no global XMLSerializer — so resolving this fallback op
  // throws. That failure must stay scoped to this one op: the rest of its
  // slide (the shape) and every other slide still export.
  const fakeSvg = { viewBox: { baseVal: { width: 100, height: 100 } } };
  const middleSlide = makeSlide({
    id: "s2",
    elements: [
      makeShape("shape-2", { zIndex: 0 }),
      {
        id: "v1",
        kind: "visual",
        box: { x: 0, y: 0, w: 10, h: 10 },
        zIndex: 1,
        content: { kind: "visual", visualId: "funnel-1" },
      },
    ],
  });
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [makeShape("shape-1")] }),
    middleSlide,
    makeSlide({ id: "s3", elements: [makeShape("shape-3")] }),
  ]);

  const diagnostics: DeckSlideImageDiagnostic[] = [];
  const blob = await exportDeckAsSlideImages(
    deck,
    visuals,
    (visualId) => (visualId === "funnel-1" ? (fakeSvg as never) : null),
    { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
  );

  assert.ok(blob);
  const entries = await zipEntries(blob!);
  // All three slides are present, in order — the archive is not aborted.
  assert.deepEqual(Object.keys(entries).sort(), [
    "slide-01.svg",
    "slide-02.svg",
    "slide-03.svg",
  ]);
  assert.match(entries["slide-01.svg"]!, /fill="#6366F1"/);
  assert.match(entries["slide-03.svg"]!, /fill="#6366F1"/);
  // The middle slide keeps its unaffected shape op but omits the fallback
  // markup for the op that threw.
  assert.match(entries["slide-02.svg"]!, /fill="#6366F1"/);
  assert.ok(!entries["slide-02.svg"]!.includes("<svg x="));

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0]!.slideIndex, 1);
  assert.equal(diagnostics[0]!.opKind, "visual-fallback");
  assert.equal(diagnostics[0]!.stage, "render");
  assert.equal(typeof diagnostics[0]!.opIndex, "number");
  assert.ok(diagnostics[0]!.message.length > 0);
});

test("exportDeckAsSlideImages isolates PNG rasterization failures per slide instead of aborting the archive", async () => {
  // Under `node --test` there is no DOM canvas, so PNG rasterization fails
  // for every slide (see module docstring) — but the archive must still be
  // produced (with zero image entries) and each failure must be reported,
  // rather than returning `null` for the whole export.
  const deck = makeDeck([
    makeSlide({ id: "s1", elements: [makeShape("shape-1")] }),
    makeSlide({ id: "s2", elements: [makeShape("shape-2")] }),
  ]);
  const diagnostics: DeckSlideImageDiagnostic[] = [];
  const blob = await exportDeckAsSlideImages(deck, new Map(), () => null, {
    format: "png",
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.ok(blob);
  assert.equal(blob!.type, "application/zip");
  const entries = await zipEntries(blob!);
  assert.deepEqual(Object.keys(entries), []);

  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((d) => d.slideIndex),
    [0, 1],
  );
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.stage, "rasterize");
    assert.equal(diagnostic.opIndex, undefined);
    assert.ok(diagnostic.message.length > 0);
  }
});

test("exportDeckAsSlideImages contains repeatedly-throwing diagnostic callbacks and logs each callback failure", async () => {
  const visual = createBlankVisual("funnel");
  const visuals = new Map([["funnel-1", visual]]);
  const visualElement = {
    id: "visual",
    kind: "visual" as const,
    box: { x: 0, y: 0, w: 10, h: 10 },
    zIndex: 1,
    content: { kind: "visual" as const, visualId: "funnel-1" },
  };
  const deck = makeDeck([
    makeSlide({
      id: "s1",
      elements: [makeShape("shape-1"), visualElement],
    }),
    makeSlide({ id: "s2", elements: [makeShape("shape-2")] }),
    makeSlide({
      id: "s3",
      elements: [makeShape("shape-3"), { ...visualElement, id: "visual-3" }],
    }),
  ]);
  const pathologicalThrownValue = {
    [Symbol.toPrimitive]() {
      throw new Error("cannot stringify");
    },
  };
  let callbackCalls = 0;
  let blob: Blob | null = null;

  const errorRecords = await captureErrorRecords(async () => {
    blob = await exportDeckAsSlideImages(
      deck,
      visuals,
      () => {
        throw pathologicalThrownValue;
      },
      {
        onDiagnostic: (diagnostic) => {
          callbackCalls += 1;
          assert.equal(
            diagnostic.message,
            "Unknown slide image export failure.",
          );
          throw new Error("diagnostic sink unavailable");
        },
      },
    );
  });

  assert.ok(blob);
  const entries = await zipEntries(blob!);
  assert.deepEqual(Object.keys(entries).sort(), [
    "slide-01.svg",
    "slide-02.svg",
    "slide-03.svg",
  ]);
  for (const svg of Object.values(entries)) {
    assert.match(svg, /fill="#6366F1"/);
    assert.ok(!svg.includes("<svg x="));
  }

  assert.equal(callbackCalls, 2);
  assert.equal(errorRecords.length, 2);
  assert.deepEqual(
    errorRecords.map((record) => record.scope),
    ["deck.slide-image-export", "deck.slide-image-export"],
  );
  assert.deepEqual(
    errorRecords.map((record) => record.slideIndex),
    [0, 2],
  );
  for (const record of errorRecords) {
    assert.equal(
      record.message,
      "Deck slide image diagnostic callback failed.",
    );
    assert.equal(record.diagnosticStage, "render");
    assert.equal(record.opKind, "visual-fallback");
    assert.equal(typeof record.opIndex, "number");
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("exportDeckAsSlideImages produces identical SVG content across repeated calls with the same deck", async () => {
  const slide = makeSlide({
    id: "sl1",
    elements: [makeShape("s1"), { ...makeShape("s2"), zIndex: 1 }],
  });
  const deck = makeDeck([slide]);
  const [blobA, blobB] = await Promise.all([
    exportDeckAsSlideImages(deck, new Map(), () => null),
    exportDeckAsSlideImages(deck, new Map(), () => null),
  ]);
  const [svgA] = Object.values(await zipEntries(blobA!));
  const [svgB] = Object.values(await zipEntries(blobB!));
  assert.equal(svgA, svgB);
});
