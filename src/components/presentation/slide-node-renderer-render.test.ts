import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SlideNodeRenderer,
  styleObjectToContainerCss,
} from "./slide-node-renderer";
import { fillStyleToCss } from "./fill-style-css";
import type { ResolvedRenderNode } from "@/lib/presentation/render-tree";
import type { FillStyle } from "@/lib/presentation/style-schema";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";

function node(
  content: ResolvedRenderNode["content"],
  options: Partial<ResolvedRenderNode> = {},
): ResolvedRenderNode {
  return {
    id: "node-1",
    type: content.type,
    role: "body",
    layout: { frame: { x: 10, y: 12, w: 30, h: 24 }, zIndex: 1 },
    style: {},
    content,
    source: "user",
    ...options,
  };
}

function renderNode(
  renderNode: ResolvedRenderNode,
  props: Partial<Parameters<typeof SlideNodeRenderer>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(SlideNodeRenderer, {
      node: renderNode,
      ...props,
    }),
  );
}

describe("styleObjectToContainerCss", () => {
  test("uses shared fill-style conversion for representative fill variants", () => {
    const resolver = (id: string) =>
      id === "missing" ? undefined : `https://assets.example/${id}.png`;
    const fills: FillStyle[] = [
      { type: "solid", color: "#f8fafc" },
      {
        type: "linearGradient",
        from: "#111111",
        to: "#eeeeee",
        stops: [
          { color: "#111111", offsetPct: 0 },
          { color: "#eeeeee", offsetPct: 100 },
        ],
      },
      {
        type: "pattern",
        kind: "dots",
        color: "#334155",
        background: "#ffffff",
      },
    ];

    for (const fill of fills) {
      assert.deepEqual(
        styleObjectToContainerCss({ fill }, resolver),
        fillStyleToCss(fill, resolver),
      );
    }
  });

  test("converts rich fills and visual effects into deterministic inline CSS", () => {
    const css = styleObjectToContainerCss({
      fill: {
        type: "pattern",
        kind: "grid",
        color: "#123456",
        background: "#ffffff",
        spacingPct: 12,
        strokeWidthPct: 0.5,
      },
      stroke: { color: "#abcdef", widthPt: 2, dash: "dotted" },
      radius: {
        topLeftPt: 1,
        topRightPt: 2,
        bottomRightPt: 3,
        bottomLeftPt: 4,
      },
      shadow: { color: "#111111", xPt: 1, yPt: 2, blurPt: 3 },
      effect: { kind: "glass", intensity: "strong" },
      opacity: 0.75,
      clip: { enabled: true },
      blendMode: "multiply",
    });

    assert.equal(css.backgroundColor, "#ffffff");
    assert.match(String(css.backgroundImage), /linear-gradient/);
    assert.equal(css.backgroundSize, "12% 12%");
    assert.equal(css.border, "2pt dotted #abcdef");
    assert.equal(css.borderTopLeftRadius, "1pt");
    assert.equal(css.boxShadow, "1pt 2pt 3pt #111111");
    assert.equal(css.backdropFilter, "blur(22px) saturate(1.25)");
    assert.equal(css.opacity, 0.75);
    assert.equal(css.overflow, "hidden");
    assert.equal(css.mixBlendMode, "multiply");
  });

  test("keeps image fill paint off the container style", () => {
    const css = styleObjectToContainerCss(
      {
        fill: { type: "image", assetId: "img-1", opacity: 0.4 },
      },
      (id) => `https://assets.example/${id}.png`,
    );

    assert.deepEqual(css, {});
  });

  test("converts every fill and effect variant without requiring DOM APIs", () => {
    assert.deepEqual(styleObjectToContainerCss({}), {});

    assert.match(
      String(
        styleObjectToContainerCss({
          fill: {
            type: "linearGradient",
            from: "#111111",
            to: "#222222",
            angle: 45,
            stops: [
              { color: "#111111", offsetPct: 0 },
              { color: "#222222", offsetPct: 100 },
            ],
          },
        }).background,
      ),
      /linear-gradient\(45deg, #111111 0%, #222222 100%\)/,
    );
    assert.match(
      String(
        styleObjectToContainerCss({
          fill: {
            type: "radialGradient",
            inner: "#ffffff",
            outer: "#000000",
            cx: 25,
            cy: 75,
            r: 35,
          },
        }).background,
      ),
      /radial-gradient\(35% 35% at 25% 75%, #ffffff, #000000\)/,
    );
    assert.match(
      String(
        styleObjectToContainerCss({
          fill: {
            type: "conicGradient",
            fromAngle: 30,
            cx: 40,
            cy: 60,
            stops: [{ color: "#abcdef", offsetPct: 50 }],
          },
        }).background,
      ),
      /conic-gradient\(from 30deg at 40% 60%, #abcdef 50%\)/,
    );
    assert.match(
      String(
        styleObjectToContainerCss({
          fill: {
            type: "repeatingLinearGradient",
            angle: 15,
            stops: [{ color: "#333333", offsetPct: 20 }],
          },
        }).background,
      ),
      /repeating-linear-gradient\(15deg, #333333 20%\)/,
    );

    const dots = styleObjectToContainerCss({
      fill: {
        type: "pattern",
        kind: "dots",
        color: "#123456",
        spacingPct: 10,
      },
    });
    assert.match(String(dots.backgroundImage), /radial-gradient/);
    assert.equal(dots.backgroundSize, "10% 10%");

    const scanlines = styleObjectToContainerCss({
      fill: {
        type: "pattern",
        kind: "scanlines",
        color: "#123456",
      },
    });
    assert.match(
      String(scanlines.backgroundImage),
      /repeating-linear-gradient/,
    );

    assert.deepEqual(
      styleObjectToContainerCss({
        fill: { type: "image", assetId: "missing" },
      }),
      {},
    );
    assert.equal(
      styleObjectToContainerCss({
        effect: { kind: "glass", intensity: "light" },
      }).backdropFilter,
      "blur(8px) saturate(1.25)",
    );
    assert.equal(
      styleObjectToContainerCss({ effect: { kind: "blur", radiusPt: 6 } })
        .filter,
      "blur(6pt)",
    );
    assert.equal(
      styleObjectToContainerCss({
        effect: { kind: "glow", color: "#ffcc00", blurPt: 8, opacity: 0.5 },
      }).filter,
      "drop-shadow(0 0 8pt #ffcc00)",
    );
    assert.equal(
      styleObjectToContainerCss({
        radius: { allPt: 5 },
        stroke: { color: "#000000", widthPt: 1, dash: "solid" },
      }).borderRadius,
      "5pt",
    );
  });
});

describe("SlideNodeRenderer media rendering", () => {
  test("renders image fill opacity on a dedicated layer", () => {
    const html = renderNode(
      node(
        {
          type: "text",
          content: { paragraphs: [{ id: "p-1", text: "Foreground text" }] },
        },
        {
          style: {
            fill: { type: "image", assetId: "img-1", opacity: 0.4 },
            opacity: 0.8,
          },
        },
      ),
      {
        assetResolver: (id) => `https://assets.example/${id}.png`,
      },
    );

    assert.match(
      html,
      /data-node-fill-layer="image"[^>]*background-image:url\(&quot;https:\/\/assets\.example\/img-1\.png&quot;\)/,
    );
    assert.match(html, /data-node-fill-layer="image"[^>]*opacity:0.4/);
    assert.match(html, /data-node-id="node-1"[^>]*opacity:0.8/);
    assert.doesNotMatch(html, /data-node-id="node-1"[^>]*background-image:/);
    assert.match(html, /Foreground text/);
  });

  test("renders visual placeholders with channel colors and transparent backgrounds", () => {
    const html = renderNode(
      node(
        {
          type: "visual",
          content: {
            visualId: "visual-1",
            alt: "Revenue visual",
            transparentBackground: true,
          },
        },
        {
          style: {
            visual: {
              channelColors: {
                primary: "#111111",
                secondary: "#222222",
                accent: "#333333",
                muted: "#444444",
              },
            },
          },
        },
      ),
    );

    assert.match(html, /aria-label="Revenue visual"/);
    assert.match(html, /background-color:transparent/);
    assert.match(html, /border-color:#444444/);
    assert.match(html, /fill="#111111"/);
    assert.match(html, /fill="#222222"/);
    assert.match(html, /fill="#333333"/);
  });

  test("renders live document visuals when a visual resolver is available", () => {
    const html = renderNode(
      node({
        type: "visual",
        content: {
          visualId: "visual-1",
          alt: "Journey map",
          transparentBackground: true,
        },
      }),
      {
        visualResolver: (id) =>
          id === "visual-1"
            ? {
                version: VISUAL_SCHEMA_VERSION,
                type: "flowchart",
                title: "Journey map",
                width: 960,
                height: 540,
                nodes: [{ id: "n1", label: "Start" }],
                edges: [],
                style: { ...DEFAULT_STYLE },
              }
            : undefined,
      },
    );

    assert.match(html, /<svg/);
    assert.match(html, /aria-label="Journey map"/);
    assert.match(html, /Start/);
    assert.doesNotMatch(html, /Visual placeholder/);
  });

  test("renders visual assets as accessible images when an asset source is available", () => {
    const html = renderNode(
      node({
        type: "visual",
        content: {
          assetId: "visual-asset-1",
          visualId: "visual-1",
          alt: "Rendered visual",
        },
      }),
      {
        assetResolver: (id) => `https://assets.example/${id}.png`,
      },
    );

    assert.match(html, /<img/);
    assert.match(html, /src="https:\/\/assets.example\/visual-asset-1.png"/);
    assert.match(html, /alt="Rendered visual"/);
  });

  test("renders cropped images with the selected fit mode", () => {
    const html = renderNode(
      node({
        type: "image",
        content: {
          assetId: "img-1",
          alt: "Hero",
          fit: "cover",
          crop: { top: 10, right: 20, bottom: 5, left: 15 },
        },
      }),
      {
        assetResolver: (id) => `https://assets.example/${id}.png`,
      },
    );

    assert.match(html, /alt="Hero"/);
    assert.match(html, /object-fit:cover/);
    assert.match(html, /width:135%/);
    assert.match(html, /height:115%/);
    assert.match(html, /left:-15%/);
    assert.match(html, /top:-10%/);
  });
});

describe("SlideNodeRenderer content variants", () => {
  test("renders paragraph lists, links, code runs, and rich text CSS", () => {
    const html = renderNode(
      node(
        {
          type: "text",
          content: {
            paragraphs: [
              {
                id: "p1",
                text: "One",
                list: { kind: "number", indent: 1 },
                runs: [
                  {
                    text: "Code ",
                    code: true,
                  },
                  {
                    text: "One",
                    code: true,
                    link: "https://example.com",
                    localStyle: {
                      color: "#123456",
                      fontSizePt: 18,
                      fontFamily: "Mono",
                    },
                  },
                ],
              },
              {
                id: "p2",
                text: "Two",
                list: { kind: "bullet" },
              },
            ],
          },
        },
        {
          style: {
            text: {
              fontFamily: "Inter",
              fontSizePt: 24,
              weight: 700,
              italic: true,
              underline: true,
              color: "#111111",
              lineHeight: 1.2,
              align: "center",
              letterSpacingEm: 0.05,
              textTransform: "uppercase",
            },
          },
        },
      ),
      { interactive: true },
    );

    assert.match(html, /Text: One Two/);
    assert.match(html, /1\./);
    assert.match(html, /•/);
    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /font-family:monospace/);
    assert.match(html, /letter-spacing:0.05em/);
    assert.match(html, /text-transform:uppercase/);
  });

  test("renders ordered list markers from contiguous runs, indent, and numberStyle", () => {
    const html = renderNode(
      node({
        type: "text",
        content: {
          paragraphs: [
            { id: "p1", text: "Bullet lead", list: { kind: "bullet" } },
            { id: "p2", text: "Decimal one", list: { kind: "number" } },
            {
              id: "p3",
              text: "Nested one",
              list: { kind: "number", indent: 1 },
            },
            {
              id: "p4",
              text: "Nested two",
              list: { kind: "number", indent: 1 },
            },
            { id: "p5", text: "Decimal two", list: { kind: "number" } },
            { id: "p6", text: "Break" },
            {
              id: "p7",
              text: "Lower alpha restart",
              list: { kind: "number", numberStyle: "lower-alpha" },
            },
            {
              id: "p8",
              text: "Upper alpha continuation",
              list: { kind: "number", numberStyle: "upper-alpha" },
            },
            {
              id: "p9",
              text: "Lower roman continuation",
              list: { kind: "number", numberStyle: "lower-roman" },
            },
          ],
        },
      }),
    );

    assert.match(html, />•<\/span><span>Bullet lead<\/span>/);
    assert.match(html, />1\.<\/span><span>Decimal one<\/span>/);
    assert.match(html, />1\.<\/span><span>Nested one<\/span>/);
    assert.match(html, />2\.<\/span><span>Nested two<\/span>/);
    assert.match(html, />2\.<\/span><span>Decimal two<\/span>/);
    assert.match(html, />a\.<\/span><span>Lower alpha restart<\/span>/);
    assert.match(html, />B\.<\/span><span>Upper alpha continuation<\/span>/);
    assert.match(html, />iii\.<\/span><span>Lower roman continuation<\/span>/);
  });

  test("renders styled SVG shape geometry", () => {
    const html = renderNode(
      node(
        {
          type: "shape",
          content: { shape: "diamond" },
        },
        {
          style: {
            fill: { type: "solid", color: "#ffeeaa" },
            stroke: { color: "#111111", widthPt: 1 },
            text: { color: "#222222", fontSizePt: 14, align: "center" },
          },
        },
      ),
    );

    assert.match(html, /<svg/);
    assert.match(html, /fill="#ffeeaa"/);
    assert.doesNotMatch(html, /background-color:#ffeeaa/);
  });

  test("renders ellipse, circle, line, triangle, diamond, square, and path variants", () => {
    const pathHtml = renderNode(
      node(
        {
          type: "shape",
          content: {
            shape: "path",
            path: "M 0 0 L 100 0 L 50 100 Z",
          },
        },
        {
          style: {
            fill: { type: "solid", color: "#ddeeff" },
            stroke: { color: "#111111", widthPt: 2 },
          },
        },
      ),
    );
    const diamondHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "diamond" },
      }),
    );
    const triangleHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "triangle" },
      }),
    );
    const ellipseHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "ellipse" },
      }),
    );
    const circleHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "circle" },
      }),
    );
    const lineHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "line" },
      }),
    );
    const squareHtml = renderNode(
      node({
        type: "shape",
        content: { shape: "square" },
      }),
    );

    assert.match(pathHtml, /M 0 0 L 100 0 L 50 100 Z/);
    assert.match(pathHtml, /fill="#ddeeff"/);
    assert.doesNotMatch(pathHtml, /background-color:#ddeeff/);
    assert.match(diamondHtml, /M 50 0 L 100 50 L 50 100 L 0 50 Z/);
    assert.match(triangleHtml, /M 50 0 L 100 100 L 0 100 Z/);
    assert.match(ellipseHtml, /<ellipse/);
    assert.match(circleHtml, /<circle/);
    assert.match(lineHtml, /<line/);
    assert.match(squareHtml, /M 0 0 L 100 0 L 100 100 L 0 100 Z/);
  });

  test("renders table headers, cell runs, and alternating row fill", () => {
    const html = renderNode(
      node(
        {
          type: "table",
          content: {
            columns: [
              { id: "col-1", label: "Metric" },
              { id: "col-2", label: "Value" },
            ],
            rows: [
              { id: "row-1", cells: [{ text: "NPS" }, { text: "72" }] },
              {
                id: "row-2",
                cells: [
                  { text: "Growth" },
                  { text: "15%", runs: [{ text: "15%", bold: true }] },
                ],
              },
            ],
            header: true,
            caption: "Quarterly metrics",
          },
        },
        {
          style: {
            table: {
              headerFill: { type: "solid", color: "#0f172a" },
              rowFill: { type: "solid", color: "#ffffff" },
              alternateRowFill: { type: "solid", color: "#f8fafc" },
            },
          },
        },
      ),
    );

    assert.match(html, /Metric/);
    assert.match(html, /Growth/);
    assert.match(html, /font-weight:bold/);
    assert.match(html, /background-color:#f8fafc/);
  });

  test("renders connector routes and accessible chrome for interactive nodes", () => {
    const html = renderNode(
      node(
        {
          type: "connector",
          content: {
            from: { kind: "point", point: { x: 0, y: 10 } },
            to: { kind: "point", point: { x: 100, y: 90 } },
            routing: "elbow",
          },
        },
        {
          style: {
            connector: {
              stroke: { color: "#ef4444", widthPt: 3, dash: "dashed" },
              startArrow: "filled",
              endArrow: "arrow",
            },
          },
        },
      ),
      { interactive: true, tabIndex: 0 },
    );

    assert.match(html, /role="button"/);
    assert.match(html, /aria-label="Connector node"/);
    assert.doesNotMatch(html, /aria-keyshortcuts/);
    assert.match(html, /stroke="#ef4444"/);
    assert.match(html, /stroke-dasharray="6 4"/);
    assert.match(html, /L 50 10 L 50 90 L 100 90/);
    assert.match(html, /id="connector-start-arrow-presentation-node-1"/);
    assert.match(html, /id="connector-end-arrow-presentation-node-1"/);
    assert.match(
      html,
      /marker-start="url\(#connector-start-arrow-presentation-node-1\)"/,
    );
    assert.match(
      html,
      /marker-end="url\(#connector-end-arrow-presentation-node-1\)"/,
    );
  });

  test("renders curved and anchored connectors with filled end arrows", () => {
    const curved = renderNode(
      node(
        {
          type: "connector",
          content: {
            from: { kind: "node", nodeId: "a", anchor: "top" },
            to: { kind: "node", nodeId: "b", anchor: "bottom" },
            routing: "curved",
          },
        },
        {
          style: {
            connector: {
              stroke: { color: "#111111", widthPt: 2, dash: "dotted" },
              startArrow: "arrow",
              endArrow: "filled",
            },
          },
        },
      ),
    );
    const straight = renderNode(
      node(
        {
          type: "connector",
          content: {
            from: { kind: "node", nodeId: "a", anchor: "left" },
            to: { kind: "node", nodeId: "b", anchor: "center" },
          },
        },
        {
          style: {
            stroke: { color: "#222222", widthPt: 1 },
          },
        },
      ),
    );

    assert.match(curved, /C 50 0 50 100 50 100/);
    assert.match(curved, /stroke-dasharray="1 4"/);
    assert.match(curved, /fill="#111111"/);
    assert.match(straight, /M 0 50 L 50 50/);
  });

  test("renders groups as nonvisual positioned selection containers", () => {
    const html = renderNode(
      node(
        { type: "group" },
        {
          id: "group-1",
          type: "group",
          children: [],
          locked: true,
        },
      ),
      { interactive: true },
    );

    assert.match(html, /data-node-id="group-1"/);
    assert.match(html, /aria-disabled="true"/);
    assert.doesNotMatch(html, /<svg/);
  });

  test("prefers authored accessibility labels and alt text for interactive names", () => {
    const shapeWithLabel = renderNode(
      node(
        {
          type: "shape",
          content: { shape: "diamond" },
        },
        {
          accessibility: {
            label: "Revenue decision diamond",
            alt: "Ignored fallback alt",
          },
        },
      ),
      { interactive: true },
    );

    const imageWithAlt = renderNode(
      node(
        {
          type: "image",
          content: { assetId: "missing", fit: "cover" },
        },
        {
          accessibility: {
            alt: "Decorative branch icon",
            decorative: true,
          },
        },
      ),
      { interactive: true },
    );

    assert.match(shapeWithLabel, /aria-label="Revenue decision diamond"/);
    assert.match(imageWithAlt, /aria-label="Decorative branch icon"/);
  });

  test("falls back through node name, shape kind, and table caption for labels", () => {
    const namedGroup = renderNode(
      node(
        { type: "group" },
        {
          id: "group-named",
          type: "group",
          children: [],
          name: "KPI cluster",
        },
      ),
      { interactive: true },
    );
    const unnamedShape = renderNode(
      node({
        type: "shape",
        content: { shape: "rect" },
      }),
      { interactive: true },
    );
    const tableWithCaption = renderNode(
      node({
        type: "table",
        content: {
          columns: [{ id: "metric", label: "Metric" }],
          rows: [{ id: "row-1", cells: [{ text: "72" }] }],
          caption: "Quarterly metrics",
        },
      }),
      { interactive: true },
    );

    assert.match(namedGroup, /aria-label="KPI cluster"/);
    assert.match(unnamedShape, /aria-label="rect shape"/);
    assert.match(tableWithCaption, /aria-label="Table: Quarterly metrics"/);
  });

  test("names decorative visuals when no authored label is provided", () => {
    const html = renderNode(
      node(
        {
          type: "visual",
          content: {
            visualId: "visual-2",
          },
        },
        {
          accessibility: { decorative: true },
        },
      ),
      { interactive: true },
    );

    assert.match(html, /aria-label="Decorative visual"/);
  });
});
