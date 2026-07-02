import type { DeckV7, SlideChildNode } from "@/lib/presentation-vnext/schema";
import type { StyleObject } from "@/lib/presentation-vnext/style-schema";
import { buildDeckV7, buildSlideV7 } from "@/test/builders/deck-v7";

export const PPTX_FIDELITY_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function shape(
  id: string,
  x: number,
  y: number,
  localStyle: StyleObject,
): SlideChildNode {
  return {
    id,
    type: "shape",
    role: "callout",
    layout: { frame: { x, y, w: 12, h: 8 }, zIndex: y * 10 + x },
    style: { ref: "surface.callout" },
    localStyle,
    content: { shape: "rect" },
  };
}

function connector(
  id: string,
  y: number,
  routing: "straight" | "elbow" | "curved",
): SlideChildNode {
  return {
    id,
    type: "connector",
    role: "connector",
    layout: { frame: { x: 8, y, w: 24, h: 8 }, zIndex: 200 + y },
    style: { ref: "connector.primary" },
    localStyle: {
      connector: {
        stroke: { color: "#2563eb", widthPt: 1.5 },
        routing,
      },
    },
    content: {
      from: { kind: "point", point: { x: 0, y: 50 } },
      to: { kind: "point", point: { x: 100, y: 50 } },
      routing,
    },
  };
}

export function buildPptxFidelityParityDeck(): DeckV7 {
  const nodes: SlideChildNode[] = [
    shape("fidelity-linear-gradient", 6, 8, {
      fill: { type: "linearGradient", from: "#2563eb", to: "#38bdf8" },
    }),
    shape("fidelity-radial-gradient", 22, 8, {
      fill: { type: "radialGradient", inner: "#ffffff", outer: "#1d4ed8" },
    }),
    shape("fidelity-conic-gradient", 38, 8, {
      fill: {
        type: "conicGradient",
        stops: [
          { color: "#f97316", offsetPct: 0 },
          { color: "#2563eb", offsetPct: 100 },
        ],
      },
    }),
    shape("fidelity-repeating-gradient", 54, 8, {
      fill: {
        type: "repeatingLinearGradient",
        stops: [
          { color: "#111827", offsetPct: 0 },
          { color: "#f8fafc", offsetPct: 100 },
        ],
      },
    }),
    shape("fidelity-pattern-fill", 70, 8, {
      fill: {
        type: "pattern",
        kind: "stripes",
        color: "#0f172a",
        background: "#e2e8f0",
      },
    }),
    shape("fidelity-image-fill", 6, 22, {
      fill: { type: "image", assetId: "fidelity-fill-image" },
    }),
    shape("fidelity-glass-effect", 22, 22, {
      fill: { type: "solid", color: "#ffffff" },
      effect: { kind: "glass", intensity: "medium" },
    }),
    shape("fidelity-blur-effect", 38, 22, {
      fill: { type: "solid", color: "#bfdbfe" },
      effect: { kind: "blur", radiusPt: 4 },
    }),
    shape("fidelity-glow-effect", 54, 22, {
      fill: { type: "solid", color: "#111827" },
      effect: { kind: "glow", color: "#38bdf8", blurPt: 8 },
    }),
    connector("fidelity-straight-connector", 38, "straight"),
    connector("fidelity-elbow-connector", 48, "elbow"),
    connector("fidelity-curved-connector", 58, "curved"),
    {
      id: "fidelity-resolved-visual",
      type: "visual",
      role: "visual",
      layout: { frame: { x: 70, y: 22, w: 18, h: 12 }, zIndex: 500 },
      style: { ref: "chart.primary" },
      content: {
        visualId: "fidelity-chart",
        alt: "Resolved fidelity visual",
      },
    },
    {
      id: "fidelity-unresolved-visual",
      type: "visual",
      role: "visual",
      layout: { frame: { x: 70, y: 40, w: 18, h: 12 }, zIndex: 501 },
      style: { ref: "chart.primary" },
      content: {
        visualId: "fidelity-missing-chart",
        alt: "Unresolved fidelity visual",
      },
    },
  ];

  return buildDeckV7([buildSlideV7("architecture", nodes)], {
    title: "PPTX fidelity parity fixture",
    assets: {
      images: {
        "fidelity-fill-image": {
          id: "fidelity-fill-image",
          src: PPTX_FIDELITY_DATA_URI,
          mimeType: "image/png",
        },
      },
      visuals: {
        "fidelity-rendered-visual": {
          id: "fidelity-rendered-file",
          visualId: "fidelity-chart",
          alt: "Resolved fidelity visual",
        },
      },
      files: {
        "fidelity-rendered-file": {
          id: "fidelity-rendered-file",
          src: PPTX_FIDELITY_DATA_URI,
          mimeType: "image/png",
        },
      },
    },
  });
}
