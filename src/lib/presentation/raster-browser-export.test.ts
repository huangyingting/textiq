import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Window } from "happy-dom";

import {
  arrayBufferToDataUrl,
  buildSvgFromSlideSpec,
  dataUrlToBlob,
  inlineImageSources,
  selectedNodeBounds,
} from "./raster-browser-export";
import type { ExportSlideSpec } from "./export-spec-types";
import type { RasterSlideDimensions } from "./raster-export";
import type { ResolvedRenderNode } from "./render-tree";
// style-schema types used in make-spec helpers
import type { FillStyle } from "./style-schema";
import type { CanvasSpec } from "./types";

function renderNode(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  children: ResolvedRenderNode[] = [],
): ResolvedRenderNode {
  return { id, layout: { frame }, children } as unknown as ResolvedRenderNode;
}

async function withHappyDom(
  run: (window: Window) => Promise<void>,
): Promise<void> {
  const window = new Window({ url: "https://textiq.test/slides" });
  const savedFetch = globalThis.fetch;
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: window.document,
  });
  try {
    await run(window);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedDocument) {
      Object.defineProperty(globalThis, "document", savedDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    window.close();
  }
}

describe("raster browser export pure helpers", () => {
  test("computes clamped bounds for selected nested render nodes", () => {
    const bounds = selectedNodeBounds(
      [
        renderNode("outside", { x: 10, y: 10, w: 5, h: 5 }),
        renderNode("group", { x: 0, y: 0, w: 100, h: 100 }, [
          renderNode("a", { x: -5, y: 20, w: 15, h: 10 }),
          renderNode("b", { x: 90, y: 95, w: 20, h: 20 }),
        ]),
      ],
      new Set(["a", "b"]),
    );

    assert.deepEqual(bounds, { x: 0, y: 20, w: 100, h: 80 });
    assert.equal(selectedNodeBounds([], new Set(["missing"])), null);
  });

  test("converts data URLs to typed blobs", async () => {
    const blob = dataUrlToBlob("data:text/plain;base64,SGVsbG8=");

    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), "Hello");

    const fallback = dataUrlToBlob("data:;base64,");
    assert.equal(fallback.type, "image/png");
    assert.equal(await fallback.text(), "");
  });

  test("arrayBufferToDataUrl encodes buffer as a base64 data URI", () => {
    const buffer = new TextEncoder().encode("Hello").buffer as ArrayBuffer;
    const dataUrl = arrayBufferToDataUrl(buffer, "text/plain");
    assert.equal(dataUrl, "data:text/plain;base64,SGVsbG8=");
  });

  test("arrayBufferToDataUrl round-trips through dataUrlToBlob", async () => {
    const original = "TextIQ export";
    const buffer = new TextEncoder().encode(original).buffer as ArrayBuffer;
    const dataUrl = arrayBufferToDataUrl(buffer, "text/plain");
    const blob = dataUrlToBlob(dataUrl);
    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), original);
  });
});

describe("inlineImageSources", () => {
  test("replaces non-data img src with fetched data URI", async () => {
    await withHappyDom(async (window) => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      globalThis.fetch = async () =>
        ({
          blob: async () => new Blob([pngBytes], { type: "image/png" }),
        }) as unknown as Response;

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", "/api/slide-assets/x");
      container.appendChild(img);

      await inlineImageSources(container as unknown as Element);

      const expected = arrayBufferToDataUrl(
        pngBytes.buffer as ArrayBuffer,
        "image/png",
      );
      assert.equal(img.getAttribute("src"), expected);
    });
  });

  test("leaves already-data: img src unchanged", async () => {
    await withHappyDom(async (window) => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return {} as Response;
      };

      const dataUri = "data:image/png;base64,iVBORw0KGgo=";
      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", dataUri);
      container.appendChild(img);

      await inlineImageSources(container as unknown as Element);

      assert.equal(img.getAttribute("src"), dataUri);
      assert.equal(fetchCalled, false);
    });
  });

  test("leaves img src unchanged on fetch failure", async () => {
    await withHappyDom(async (window) => {
      globalThis.fetch = async () => {
        throw new Error("network error");
      };

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const img = window.document.createElement("img");
      img.setAttribute("src", "/api/slide-assets/fail");
      container.appendChild(img);

      await assert.doesNotReject(() =>
        inlineImageSources(container as unknown as Element),
      );

      assert.equal(img.getAttribute("src"), "/api/slide-assets/fail");
    });
  });

  test("inlines background-image CSS url reference to data URI", async () => {
    await withHappyDom(async (window) => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      globalThis.fetch = async () =>
        ({
          blob: async () => new Blob([pngBytes], { type: "image/png" }),
        }) as unknown as Response;

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const el = window.document.createElement("div");
      (el as unknown as HTMLElement).style.backgroundImage =
        "url('/api/bg.png')";
      container.appendChild(el);

      await inlineImageSources(container as unknown as Element);

      const expected = arrayBufferToDataUrl(
        pngBytes.buffer as ArrayBuffer,
        "image/png",
      );
      const bgImage = (el as unknown as HTMLElement).style.backgroundImage;
      assert.ok(
        bgImage.includes(expected),
        "background-image should be a data URI",
      );
    });
  });

  test("skips already-data: background-image url without fetching", async () => {
    await withHappyDom(async (window) => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return {} as Response;
      };

      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const el = window.document.createElement("div");
      const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
      (el as unknown as HTMLElement).style.backgroundImage =
        `url("${dataUrl}")`;
      container.appendChild(el);

      await inlineImageSources(container as unknown as Element);

      assert.equal(fetchCalled, false, "should not fetch for data: url");
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the buildSvgFromSlideSpec describe blocks
// ---------------------------------------------------------------------------

const testDims: RasterSlideDimensions = {
  widthPx: 960,
  heightPx: 540,
  widthIn: 10,
  heightIn: 5.625,
};
const testCanvas: CanvasSpec = {
  format: "16:9",
  width: 100,
  height: 56.25,
  unit: "percent",
};

function makeSpec(
  operations: ExportSlideSpec["operations"],
  backgroundFill?: FillStyle,
): ExportSlideSpec {
  return {
    id: "test-slide",
    background: {
      type: "background",
      ...(backgroundFill ? { fill: backgroundFill } : {}),
    },
    operations,
  };
}

// ---------------------------------------------------------------------------
// Pure SVG-builder renderer branches (coverage for raster-browser-export.tsx)
// ---------------------------------------------------------------------------

describe("buildSvgFromSlideSpec — fill variants", () => {
  test("solid fill renders rect with color attr", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "s",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: { fill: { type: "solid", color: "#aabbcc" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("#aabbcc"));
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("linearGradient fill produces <linearGradient> defs block with from/to stops", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "lg",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: {
            fill: {
              type: "linearGradient",
              from: "#ffffff",
              to: "#000000",
              angle: 90,
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<defs>"), "should emit defs");
    assert.ok(svg.includes("<linearGradient"), "should emit linearGradient");
    assert.ok(svg.includes("stop-color="), "should emit gradient stops");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("linearGradient fill with explicit stops array emits per-stop offsets", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "lg-stops",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: {
            fill: {
              type: "linearGradient",
              from: "#ff0000",
              to: "#0000ff",
              stops: [
                { offsetPct: 0, color: "#ff0000" },
                { offsetPct: 50, color: "#00ff00" },
                { offsetPct: 100, color: "#0000ff" },
              ],
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<linearGradient"));
    assert.ok(svg.includes('offset="0%"'));
    assert.ok(svg.includes('offset="50%"'));
    assert.ok(svg.includes('offset="100%"'));
  });

  test("radialGradient fill produces <radialGradient> defs block with inner/outer stops", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "rg",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: {
            fill: {
              type: "radialGradient",
              inner: "#ffffff",
              outer: "#000000",
              cx: 50,
              cy: 50,
              r: 70,
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<defs>"), "should emit defs");
    assert.ok(svg.includes("<radialGradient"), "should emit radialGradient");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("radialGradient fill with explicit stops array emits stops", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "rg-stops",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: {
            fill: {
              type: "radialGradient",
              inner: "#ff0000",
              outer: "#0000ff",
              stops: [
                { offsetPct: 0, color: "#ff0000" },
                { offsetPct: 100, color: "#0000ff" },
              ],
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<radialGradient"));
    assert.ok(svg.includes('offset="0%"'));
  });

  test("unknown fill type falls back to flat color", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "unk",
          shape: "rectangle",
          frame: { x: 0, y: 0, w: 240, h: 135 },
          style: { fill: { type: "pattern" } as unknown as FillStyle },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<rect"), "should still render a rect");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("background image fill type renders <image> element", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([], { type: "image", assetId: "data:image/png;base64,AAA" }),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes('<image href="data:image/png;base64,AAA"'));
    assert.ok(!svg.includes("<foreignObject"));
  });
});

describe("buildSvgFromSlideSpec — shape variants", () => {
  const shapeVariants: Array<{ shape: string; expectTag: string }> = [
    { shape: "ellipse", expectTag: "<ellipse" },
    { shape: "circle", expectTag: "<ellipse" },
    { shape: "triangle", expectTag: "<polygon" },
    { shape: "diamond", expectTag: "<polygon" },
    { shape: "line", expectTag: "<line" },
    { shape: "rectangle", expectTag: "<rect" },
  ];

  for (const { shape, expectTag } of shapeVariants) {
    test(`${shape} renders as ${expectTag}`, () => {
      const svg = buildSvgFromSlideSpec(
        makeSpec([
          {
            type: "shape",
            id: "s",
            shape,
            frame: { x: 96, y: 54, w: 192, h: 108 },
            style: { fill: { type: "solid", color: "#ff0000" } },
            zIndex: 1,
          },
        ]),
        testCanvas,
        testDims,
      );
      assert.ok(
        svg.includes(expectTag),
        `${shape} should render as ${expectTag}`,
      );
      assert.ok(!svg.includes("<foreignObject"));
    });
  }

  test("shape with stroke attributes emits stroke fields", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "stroked",
          shape: "rectangle",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          style: {
            fill: { type: "solid", color: "#ffffff" },
            stroke: { color: "#cc0000", widthPt: 3 },
            opacity: 0.75,
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("stroke="), "should have stroke attribute");
    assert.ok(svg.includes("opacity="), "should have opacity attribute");
  });

  test("shape with rotation emits transform attribute", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "shape",
          id: "rotated",
          shape: "rectangle",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          style: { fill: { type: "solid", color: "#ff0000" } },
          rotation: 45,
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("rotate(45"), "should have rotate transform");
  });

  test("image op with rotation emits transform attribute", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "image",
          id: "img-rot",
          assetId: "data:image/png;base64,AAA",
          frame: { x: 0, y: 0, w: 240, h: 135 },
          style: {},
          rotation: 30,
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("rotate(30"), "image should have rotate transform");
  });

  test("image op preserves contain fit in SVG preserveAspectRatio", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "image",
          id: "img-contain",
          assetId: "data:image/png;base64,AAA",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          style: {},
          fit: "contain",
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(
      svg.includes('preserveAspectRatio="xMidYMid meet"'),
      "contain fit should use SVG meet behavior",
    );
    assert.ok(
      !svg.includes("<clipPath"),
      "uncropped contain image is unclipped",
    );
  });

  test("image op applies live-renderer crop geometry and cover fit", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "image",
          id: "img-crop",
          assetId: "data:image/png;base64,AAA",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          style: {},
          fit: "cover",
          crop: { top: 20, right: 30, bottom: 40, left: 10 },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(svg.includes("<clipPath"), "cropped image should clip to frame");
    assert.ok(
      svg.includes('preserveAspectRatio="xMidYMid slice"'),
      "cover fit should use SVG slice behavior",
    );
    assert.ok(svg.includes('x="76.8"'), "crop left offsets image x");
    assert.ok(svg.includes('y="32.4"'), "crop top offsets image y");
    assert.ok(svg.includes('width="268.8"'), "crop expands image width");
    assert.ok(svg.includes('height="172.8"'), "crop expands image height");
  });

  test("image op preserves container paint, opacity, and image filters", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "image",
          id: "img-style",
          assetId: "data:image/png;base64,AAA",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          style: {
            fill: { type: "solid", color: "#f8fafc" },
            stroke: { color: "#0f172a", widthPt: 2 },
            radius: { allPt: 6 },
            opacity: 0.75,
            image: { brightness: 1.1, contrast: 0.9, saturation: 1.2 },
          },
          fit: "contain",
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.match(
      svg,
      /<rect x="96\.0" y="54\.0" width="192\.0" height="108\.0" rx="8\.0" ry="8\.0" fill="#f8fafc" stroke="#0f172a"/,
    );
    assert.ok(svg.includes('opacity="0.75"'), "node opacity should survive");
    assert.ok(
      svg.includes('filter="brightness(1.1) contrast(0.9) saturate(1.2)"'),
      "image filters should survive",
    );
  });
});

describe("buildSvgFromSlideSpec — text renderer branches", () => {
  test("left alignment uses text-anchor start and left x-origin", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Left" }] },
          style: { text: { align: "left" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('text-anchor="start"'),
      "left align → text-anchor start",
    );
  });

  test("center alignment uses text-anchor middle and center x-origin", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Center" }] },
          style: { text: { align: "center" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('text-anchor="middle"'),
      "center align → text-anchor middle",
    );
  });

  test("right alignment uses text-anchor end and right x-origin", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Right" }] },
          style: { text: { align: "right" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('text-anchor="end"'),
      "right align → text-anchor end",
    );
  });

  test("bold weight renders font-weight bold", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Bold" }] },
          style: { text: { weight: 700 } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('font-weight="bold"'),
      "weight ≥ 600 → font-weight bold",
    );
  });

  test("italic style renders font-style italic", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Italic" }] },
          style: { text: { italic: true } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('font-style="italic"'),
      "italic → font-style italic",
    );
  });

  test("explicit fontSizePt uses pt-to-px conversion", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Sized" }] },
          style: { text: { fontSizePt: 36 } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    // 36pt at 96 ppi/72pt = 48px
    assert.ok(svg.includes("font-size="), "should have font-size attribute");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("verticalAlign middle adjusts y start position upward from center", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 270 },
          content: { paragraphs: [{ id: "p", text: "Middle" }] },
          style: { text: { verticalAlign: "middle" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<text"), "should render <text>");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("verticalAlign bottom adjusts y start to bottom of box", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 270 },
          content: { paragraphs: [{ id: "p", text: "Bottom" }] },
          style: { text: { verticalAlign: "bottom" } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<text"), "should render <text>");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("text with rotation emits transform attribute", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Rotated" }] },
          style: {},
          rotation: 30,
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("rotate(30"), "rotated text should have transform");
  });

  test("empty paragraph produces empty line in output", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 192, h: 270 },
          content: {
            paragraphs: [
              { id: "p1", text: "" }, // empty paragraph
              { id: "p2", text: "After empty" },
            ],
          },
          style: {},
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes("After empty"),
      "non-empty paragraph text should appear",
    );
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("runs-based paragraph emits per-run tspans with list prefix formatting", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: {
            paragraphs: [
              {
                id: "p",
                text: "Full text",
                list: { kind: "bullet", indent: 2 },
                runs: [
                  {
                    text: "Full ",
                    bold: true,
                    localStyle: { color: "#ef4444" },
                  },
                  {
                    text: "text",
                    italic: true,
                    localStyle: { fontSizePt: 18, fontFamily: "Serif" },
                  },
                ],
              },
            ],
          },
          style: {},
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("• "), "list bullet should appear in output");
    assert.ok(svg.includes("<tspan"), "rich runs should render as tspans");
    assert.ok(svg.includes('font-weight="bold"'), "bold run should survive");
    assert.ok(svg.includes('font-style="italic"'), "italic run should survive");
    assert.ok(svg.includes("#ef4444"), "run color should survive");
    assert.ok(svg.includes("Serif"), "run font family should survive");
    assert.ok(svg.includes("Full "), "run text should appear in output");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("ordered list prefixes preserve alphabetic and roman number styles", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "styled-list",
          frame: { x: 96, y: 54, w: 384, h: 216 },
          content: {
            paragraphs: [
              {
                id: "lower-alpha",
                text: "Alpha",
                list: { kind: "number", numberStyle: "lower-alpha" },
              },
              {
                id: "upper-alpha",
                text: "Upper",
                list: { kind: "number", numberStyle: "upper-alpha" },
              },
              { id: "reset", text: "Reset counters" },
              {
                id: "roman-one",
                text: "Roman one",
                list: { kind: "number", numberStyle: "lower-roman" },
              },
              {
                id: "roman-two",
                text: "Roman two",
                list: { kind: "number", numberStyle: "lower-roman" },
              },
            ],
          },
          style: {},
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(svg.includes("a. "), "lower-alpha marker should render");
    assert.ok(svg.includes("B. "), "upper-alpha marker should render");
    assert.ok(
      svg.includes("i. "),
      "roman counter should reset after body text",
    );
    assert.ok(svg.includes("ii. "), "lower-roman marker should render");
    assert.ok(
      !svg.includes("2. Upper"),
      "upper-alpha must not fall back to decimal",
    );
  });

  test("text op preserves container paint and opacity", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "painted-text",
          frame: { x: 96, y: 54, w: 192, h: 108 },
          content: { paragraphs: [{ id: "p", text: "Painted text" }] },
          style: {
            fill: { type: "solid", color: "#fff7ed" },
            stroke: { color: "#ea580c", widthPt: 1.5, dash: "dashed" },
            radius: { allPt: 4 },
            opacity: 0.6,
            text: { color: "#111827" },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.match(
      svg,
      /<rect x="96\.0" y="54\.0" width="192\.0" height="108\.0" rx="5\.3" ry="5\.3" fill="#fff7ed" stroke="#ea580c"/,
    );
    assert.ok(svg.includes('stroke-dasharray="6 4"'));
    assert.ok(svg.includes('opacity="0.6"'));
    assert.ok(svg.includes("Painted text"));
  });

  test("long text wraps into multiple <text> lines", () => {
    // Very narrow box forces wrapSvgLine to split
    const longText = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa";
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "text",
          id: "t",
          frame: { x: 0, y: 0, w: 48, h: 540 }, // very narrow
          content: { paragraphs: [{ id: "p", text: longText }] },
          style: { text: { fontSizePt: 14 } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    const lineCount = (svg.match(/<text /g) ?? []).length;
    assert.ok(
      lineCount > 1,
      `expected multiple <text> lines, got ${lineCount}`,
    );
    assert.ok(!svg.includes("<foreignObject"));
  });
});

describe("buildSvgFromSlideSpec — connector and visual ops", () => {
  test("connector op renders a path from endpoint percentages", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "connector",
          id: "c",
          from: { kind: "point", point: { x: 25, y: 75 } },
          to: { kind: "point", point: { x: 75, y: 25 } },
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: { stroke: { color: "#333333", widthPt: 2 } },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(svg.includes("<path"), "connector → routed path");
    assert.ok(
      svg.includes('d="M 120.0 202.5 L 360.0 67.5"'),
      "point endpoints should be converted within the frame",
    );
    assert.ok(svg.includes("marker-end="), "default end arrow should render");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("connector op mirrors live elbow routing, connector stroke, dashes, and arrows", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "connector",
          id: "c-elbow",
          from: { kind: "point", point: { x: 10, y: 20 } },
          to: { kind: "point", point: { x: 90, y: 80 } },
          frame: { x: 0, y: 0, w: 480, h: 270 },
          style: {
            stroke: { color: "#999999", widthPt: 1 },
            connector: {
              stroke: { color: "#123456", widthPt: 3, dash: "dotted" },
              routing: "elbow",
              startArrow: "filled",
              endArrow: "arrow",
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(
      svg.includes('d="M 48.0 54.0 L 240.0 54.0 L 240.0 216.0 L 432.0 216.0"'),
      "elbow routing should use endpoint-derived segments",
    );
    assert.ok(svg.includes("#123456"), "connector stroke should win");
    assert.ok(svg.includes('stroke-dasharray="1 4"'), "dotted dash survives");
    assert.ok(svg.includes("marker-start="), "start arrow should render");
    assert.ok(svg.includes("marker-end="), "end arrow should render");
  });

  test("visual op with assetId renders as <image>", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "visual",
          id: "v",
          assetId: "data:image/svg+xml;base64,PHN2Zz4=",
          frame: { x: 192, y: 108, w: 192, h: 108 },
          style: {},
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );
    assert.ok(
      svg.includes('href="data:image/svg+xml;base64,PHN2Zz4="'),
      "visual with assetId → <image>",
    );
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("visual op without assetId renders deterministic placeholder", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "visual",
          id: "v-placeholder",
          visualId: "visual-1",
          frame: { x: 120, y: 80, w: 240, h: 160 },
          style: {
            visual: {
              channelColors: {
                primary: "#111111",
                secondary: "#222222",
                accent: "#333333",
                muted: "#444444",
              },
              transparentBackground: false,
            },
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(
      svg.includes('fill="#44444422"'),
      "placeholder background should match live fallback",
    );
    assert.ok(svg.includes('stroke="#444444"'), "placeholder border renders");
    assert.ok(svg.includes('fill="#111111"'), "primary channel bar renders");
    assert.ok(svg.includes('fill="#222222"'), "secondary channel bar renders");
    assert.ok(svg.includes('fill="#333333"'), "accent channel bar renders");
    assert.ok(!svg.includes("<foreignObject"));
  });
});

describe("buildSvgFromSlideSpec — tableShape ops", () => {
  test("renders table cells, header, borders, and cell text as native SVG", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "tableShape",
          id: "table-1",
          frame: { x: 96, y: 108, w: 384, h: 162 },
          style: {
            table: {
              headerFill: { type: "solid", color: "#0f172a" },
              rowFill: { type: "solid", color: "#ffffff" },
              alternateRowFill: { type: "solid", color: "#e2e8f0" },
              border: { color: "#334155", widthPt: 1 },
              cellPaddingPt: { top: 3, right: 6, bottom: 3, left: 6 },
              text: { fontFamily: "Arial", fontSizePt: 9, color: "#111827" },
              headerText: { color: "#ffffff", fontSizePt: 9, weight: 700 },
            },
          },
          table: {
            header: true,
            columns: [
              { id: "metric", label: "Metric", width: 2 },
              { id: "value", label: "Value", width: 1 },
            ],
            rows: [
              {
                id: "row-1",
                cells: [{ text: "Revenue" }, { text: "$42M" }],
              },
              {
                id: "row-2",
                cells: [{ text: "Growth" }, { text: "18%" }],
              },
            ],
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(svg.includes("Metric"), "header text should render");
    assert.ok(svg.includes("Revenue"), "body cell text should render");
    assert.ok(svg.includes("#0f172a"), "header fill should render");
    assert.ok(svg.includes("#e2e8f0"), "alternate row fill should render");
    assert.ok(svg.includes('stroke="#334155"'), "grid border should render");
    assert.ok(svg.includes("<clipPath"), "cell text should be clipped");
    assert.ok(!svg.includes("<foreignObject"));
  });

  test("renders headerless table captions, rich-run text, and zero-width columns", () => {
    const svg = buildSvgFromSlideSpec(
      makeSpec([
        {
          type: "tableShape",
          id: "table-edge",
          frame: { x: 96, y: 108, w: 384, h: 162 },
          style: {
            opacity: 0.8,
            table: {
              rowFill: { type: "solid", color: "#f8fafc" },
              border: { color: "#475569", widthPt: 2, dash: "dashed" },
              cellPaddingPt: { top: 4, right: 4, bottom: 4, left: 4 },
              text: { fontFamily: "Arial", fontSizePt: 8, color: "#0f172a" },
            },
          },
          table: {
            header: false,
            caption: "Quarterly KPIs",
            columns: [
              { id: "metric", label: "Metric", width: 0 },
              { id: "value", label: "Value", width: 0 },
            ],
            rows: [
              {
                id: "row-1",
                cells: [
                  { text: "ignored", runs: [{ text: "Revenue" }] },
                  {
                    text: "ignored",
                    runs: [{ text: "$" }, { text: "42M" }],
                  },
                ],
              },
            ],
          },
          zIndex: 1,
        },
      ]),
      testCanvas,
      testDims,
    );

    assert.ok(svg.includes("Quarterly KPIs"), "caption text should render");
    assert.ok(svg.includes("Revenue"), "rich-run cell text should render");
    assert.ok(svg.includes("$42M"), "runs should be concatenated per cell");
    assert.ok(svg.includes("#f8fafc"), "body row fill should render");
    assert.ok(
      svg.includes("stroke-dasharray="),
      "dashed grid border should render",
    );
    assert.ok(svg.includes('opacity="0.8"'), "table opacity should render");
    assert.ok(!svg.includes("Metric"), "header labels should not render");
    assert.ok(!svg.includes("<foreignObject"));
  });
});

describe("buildSvgFromSlideSpec — foreignObject regression", () => {
  const dims: RasterSlideDimensions = {
    widthPx: 960,
    heightPx: 540,
    widthIn: 10,
    heightIn: 5.625,
  };
  const canvas: CanvasSpec = {
    format: "16:9",
    width: 100,
    height: 56.25,
    unit: "percent",
  };

  test("slide with text + image + shape produces no <foreignObject>", () => {
    const spec: ExportSlideSpec = {
      id: "slide-1",
      background: {
        type: "background",
        fill: { type: "solid", color: "#ffffff" },
      },
      operations: [
        {
          type: "text",
          id: "t1",
          frame: { x: 48, y: 27, w: 480, h: 108 },
          content: {
            paragraphs: [
              {
                id: "p1",
                text: "Hello World",
                runs: [{ text: "Hello World", bold: true }],
              },
            ],
          },
          style: {},
          zIndex: 1,
        },
        {
          type: "image",
          id: "i1",
          assetId: "data:image/png;base64,iVBORw0KGgo=",
          frame: { x: 480, y: 135, w: 240, h: 135 },
          style: {},
          zIndex: 2,
        },
        {
          type: "shape",
          id: "s1",
          shape: "rectangle",
          frame: { x: 192, y: 216, w: 192, h: 108 },
          style: { fill: { type: "solid", color: "#3b82f6" } },
          zIndex: 3,
        },
      ],
    };

    const svg = buildSvgFromSlideSpec(spec, canvas, dims);

    assert.ok(
      !svg.includes("<foreignObject"),
      "SVG must not contain <foreignObject>",
    );
    assert.ok(svg.includes("<text"), "SVG must contain native <text> elements");
    assert.ok(
      svg.includes("<image"),
      "SVG must contain native <image> elements",
    );
    assert.ok(svg.includes("<rect"), "SVG must contain native <rect> elements");
  });

  test("selected-nodes crop path produces no <foreignObject>", () => {
    const spec: ExportSlideSpec = {
      id: "slide-2",
      background: { type: "background" },
      operations: [
        {
          type: "text",
          id: "node-a",
          frame: { x: 96, y: 54, w: 384, h: 108 },
          content: {
            paragraphs: [{ id: "p1", text: "Cropped text" }],
          },
          style: {},
          zIndex: 1,
        },
      ],
    };

    // Simulate the crop viewBox used by renderSelectedNodesToPngBlob
    const crop = { viewBoxX: 96, viewBoxY: 54, viewBoxW: 384, viewBoxH: 108 };
    const svg = buildSvgFromSlideSpec(spec, canvas, dims, crop);

    assert.ok(
      !svg.includes("<foreignObject"),
      "cropped SVG must not contain <foreignObject>",
    );
    // Viewbox should be set to the crop region
    assert.ok(
      svg.includes(
        `viewBox="${crop.viewBoxX} ${crop.viewBoxY} ${crop.viewBoxW} ${crop.viewBoxH}`,
      ),
      "cropped SVG must use crop region as viewBox",
    );
  });
});
