import type { Deck } from "@/lib/document/deck-model";
import {
  buildBulletsElement,
  buildConnectorElement,
  buildDeck,
  buildImageElement,
  buildShapeElement,
  buildSlide,
  buildTextElement,
} from "@/test/builders/deck";
import { FIXTURE_PNG_BASE64 } from "@/test/builders/assets";

export const SLIDE_VIEWPORT = { width: 1280, height: 720 } as const;

export const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.02,
  threshold: 0.2,
} as const;

export const REGRESSION_DECK_FIXTURE: Deck = buildDeck({
  design: { themeId: "default" },
  slides: [
    buildSlide({
      id: "slide-text-bullets",
      index: 0,
      title: "Text and Bullets",
      bullets: [],
      notes: "",
      background: "#ffffff",
      elements: [
        buildTextElement({
          id: "title-el",
          role: "title",
          text: "Regression Title",
          box: { x: 5, y: 5, w: 90, h: 15 },
          zIndex: 0,
          style: { fontSize: 6, bold: true, italic: false, align: "center" },
        }),
        buildBulletsElement({
          id: "body-bullets",
          bullets: ["First point", "Second point", "Third point"],
          items: [
            { text: "First point" },
            { text: "Second point" },
            { text: "Third point" },
          ],
          box: { x: 10, y: 25, w: 80, h: 50 },
          zIndex: 1,
          style: { fontSize: 4, bold: false, italic: false, align: "left" },
        }),
      ],
    }),
    buildSlide({
      id: "slide-shapes",
      index: 1,
      title: "Shapes",
      bullets: [],
      notes: "",
      background: "#f8f9fa",
      elements: [
        buildShapeElement({
          id: "rect-el",
          content: { kind: "shape", shape: "rect" },
          designOverrides: { fill: { value: "#6366f1" } },
          text: "Rectangle",
          box: { x: 10, y: 20, w: 30, h: 20 },
          zIndex: 0,
          radius: 5,
        }),
        buildShapeElement({
          id: "ellipse-el",
          content: { kind: "shape", shape: "ellipse" },
          designOverrides: { fill: { value: "#10b981" } },
          text: "Ellipse",
          box: { x: 60, y: 20, w: 25, h: 20 },
          zIndex: 1,
        }),
        buildShapeElement({
          id: "triangle-el",
          content: { kind: "shape", shape: "triangle" },
          designOverrides: { fill: { value: "#f59e0b" } },
          box: { x: 35, y: 55, w: 25, h: 20 },
          zIndex: 2,
        }),
      ],
    }),
    buildSlide({
      id: "slide-image-connector",
      index: 2,
      title: "Image and Connector",
      bullets: [],
      notes: "",
      background: "#1e293b",
      elements: [
        buildImageElement({
          id: "image-el",
          src: `data:image/png;base64,${FIXTURE_PNG_BASE64}`,
          alt: "Test image",
          fitMode: "contain",
          box: { x: 10, y: 15, w: 35, h: 35 },
          zIndex: 0,
        }),
        buildConnectorElement({
          id: "connector-el",
          start: { x: 60, y: 25 },
          end: { x: 85, y: 65 },
          routing: "straight",
          arrowEnd: "arrow",
          stroke: { color: "#94a3b8", width: 2 },
          box: { x: 60, y: 25, w: 25, h: 40 },
          zIndex: 1,
        }),
      ],
    }),
  ],
});
