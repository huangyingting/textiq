import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  colorRefValue,
  connectorContent,
  connectorDesign,
  elementContent,
  elementDesignOverrides,
  imageContent,
  imageDesign,
  presentationRoleToPresentationRole,
  shapeContent,
  shapeTextDesign,
  slideDesignOverrides,
  textAlignOrDefault,
  textContent,
  textDesign,
  visualContent,
} from "@/components/presentation/slide-canvas/v6-model";
import { DEFAULT_TOKEN_SET } from "../presentation/presentation-theme";
import type {
  ConnectorElement,
  ImageElement,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  VisualElement,
} from "../presentation/deck";

function element<T extends SlideElement>(
  kind: T["kind"],
  content: unknown,
  designOverrides?: unknown,
): T {
  return {
    id: `${kind}-1`,
    kind,
    box: { x: 0, y: 0, w: 10, h: 10 },
    content,
    designOverrides,
  } as unknown as T;
}

describe("v6 slide canvas model helpers", () => {
  test("normalizes arbitrary element and slide records without mutating callers", () => {
    const text = element<TextElement>(
      "text",
      {
        text: "Hello",
        paragraphs: [{ text: "Hello" }],
        runs: [{ text: "Hello", bold: true }],
        fitMode: "shrink-to-fit",
        bulletGap: 6,
        bulletIndent: 12,
      },
      {
        textStyle: { align: "center", fontSize: 18 },
      },
    );
    const empty = element<TextElement>("text", null, null);
    const slide = {
      id: "slide-1",
      elements: [text],
      designOverrides: { background: "#ffffff" },
    } as unknown as Slide;

    assert.deepEqual(elementContent(empty), {});
    assert.deepEqual(elementDesignOverrides(empty), {});
    assert.deepEqual(slideDesignOverrides(slide), { background: "#ffffff" });
    assert.deepEqual(textContent(text), {
      text: "Hello",
      paragraphs: [{ text: "Hello" }],
      runs: [{ text: "Hello", bold: true }],
      fitMode: "shrink-to-fit",
      bulletGap: 6,
      bulletIndent: 12,
    });
    assert.deepEqual(textContent(empty), {
      text: "",
      paragraphs: [{ text: "" }],
    });
    assert.deepEqual(textDesign(text), { align: "center", fontSize: 18 });
  });

  test("extracts shape, image, visual, and connector content with fallback branches", () => {
    const shape = element<ShapeElement>(
      "shape",
      {
        shape: "diamond",
        text: "Callout",
        textRuns: [{ text: "Callout" }],
      },
      { textStyle: { fontWeight: 700 } },
    );
    const image = element<ImageElement>(
      "image",
      {
        src: "https://example.com/image.png",
        alt: "Image",
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
      },
      { fitMode: "cover", maskShape: "rounded", radius: 8 },
    );
    const visualWithDesign = element<VisualElement>(
      "visual",
      { visualId: "visual-1", alt: "Visual", styleThemeId: "content-theme" },
      { styleThemeId: "design-theme" },
    );
    const visualWithContentTheme = element<VisualElement>(
      "visual",
      { visualId: "visual-2", styleThemeId: "content-theme" },
      {},
    );
    const visualEmpty = element<VisualElement>("visual", {}, {});
    const connector = element<ConnectorElement>(
      "connector",
      {
        start: { kind: "free", point: { x: 0, y: 0 } },
        end: { kind: "free", point: { x: 10, y: 10 } },
        routing: "elbow",
      },
      {
        stroke: { color: "#111111", width: 2 },
        dash: true,
        arrowStart: "none",
        arrowEnd: "arrow",
      },
    );
    const partialConnector = element<ConnectorElement>(
      "connector",
      { start: { kind: "free" }, end: { kind: "free" } },
      { stroke: { color: "#111111" } },
    );

    assert.deepEqual(shapeContent(shape), {
      shape: "diamond",
      text: "Callout",
      textRuns: [{ text: "Callout" }],
    });
    assert.deepEqual(shapeTextDesign(shape), { fontWeight: 700 });
    assert.deepEqual(imageContent(image), {
      src: "https://example.com/image.png",
      alt: "Image",
      crop: { top: 1, right: 2, bottom: 3, left: 4 },
    });
    assert.deepEqual(imageDesign(image), {
      fitMode: "cover",
      maskShape: "rounded",
      radius: 8,
    });
    assert.deepEqual(visualContent(visualWithDesign), {
      visualId: "visual-1",
      alt: "Visual",
      styleThemeId: "design-theme",
    });
    assert.deepEqual(visualContent(visualWithContentTheme), {
      visualId: "visual-2",
      styleThemeId: "content-theme",
    });
    assert.deepEqual(visualContent(visualEmpty), { visualId: "" });
    assert.deepEqual(connectorContent(connector), {
      start: { kind: "free", point: { x: 0, y: 0 } },
      end: { kind: "free", point: { x: 10, y: 10 } },
      routing: "elbow",
    });
    assert.deepEqual(connectorDesign(connector), {
      stroke: { color: "#111111", width: 2 },
      dash: true,
      arrowStart: "none",
      arrowEnd: "arrow",
    });
    assert.deepEqual(connectorDesign(partialConnector), {});
  });

  test("resolves color references, presentation roles, and alignment defaults", () => {
    assert.equal(colorRefValue("#ff0000", DEFAULT_TOKEN_SET), "#ff0000");
    assert.equal(
      colorRefValue({ value: "#00ff00" }, DEFAULT_TOKEN_SET),
      "#00ff00",
    );
    assert.equal(
      colorRefValue({ token: "accent" }, DEFAULT_TOKEN_SET),
      DEFAULT_TOKEN_SET.colors.accent,
    );
    assert.equal(
      colorRefValue({ token: "missing" }, DEFAULT_TOKEN_SET),
      undefined,
    );
    assert.equal(colorRefValue(42, DEFAULT_TOKEN_SET), undefined);

    assert.equal(presentationRoleToPresentationRole("title", "body"), "title");
    assert.equal(
      presentationRoleToPresentationRole("sectionTitle", "body"),
      "sectionTitle",
    );
    for (const role of [
      "subtitle",
      "body",
      "bullet",
      "quote",
      "caption",
      "footer",
      "media",
      "visual",
      "image",
      "logo",
      "pageNumber",
      "background",
      "label",
    ] as const) {
      assert.equal(presentationRoleToPresentationRole(role, "body"), role);
    }
    assert.equal(
      presentationRoleToPresentationRole("unknown", "caption"),
      "caption",
    );
    assert.equal(textAlignOrDefault(undefined, "left"), "left");
    assert.equal(textAlignOrDefault("right", "left"), "right");
  });
});
