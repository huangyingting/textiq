import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { safeParseDeck } from "@/lib/presentation/validation";
import {
  buildDeck,
  buildImageAsset,
  buildLayoutBox,
  buildMinimalDeck,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "@/lib/presentation/schema";

function assertHasError(errors: readonly string[], pattern: RegExp): void {
  assert.ok(
    errors.some((error) => pattern.test(error)),
    `Expected an error matching ${pattern}, got:\n${errors.join("\n")}`,
  );
}

function invalidDeckRecord(deck: unknown): Record<string, unknown> {
  return deck as unknown as Record<string, unknown>;
}

function invalidSlideChildNode(node: unknown): SlideChildNode {
  return node as unknown as SlideChildNode;
}

describe("safeParseDeck coverage branches", () => {
  test("accepts a rich presentation deck using current asset, chrome, source, and content contracts", () => {
    const textNode = buildTextNode({
      id: "text-rich",
      name: "Rich text",
      slot: "body",
      locked: true,
      hidden: false,
      accessibility: {
        label: "Text box",
        decorative: false,
        readingOrder: 1,
      },
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        blockKind: "text",
        contentHash: "hash-1",
        blockRevision: "rev-1",
        linkedAt: "2026-01-01T00:00:00Z",
        display: {
          documentTitle: "Source doc",
          blockLabel: "Executive summary",
          blockKindLabel: "Paragraph",
        },
        refresh: {
          state: "fresh",
          checkedAt: "2026-01-01T00:00:00Z",
          refreshedAt: "2026-01-01T00:00:00Z",
          sourceHash: "hash-1",
          reason: "manual",
        },
        extra: { reviewed: true },
      },
      content: {
        paragraphs: [
          {
            id: "para-rich",
            text: "Hello deck",
            runs: [
              {
                text: "Hello ",
                bold: true,
                link: "mailto:hello@example.com",
                localStyle: { color: "#111111", fontSizePt: 18 },
              },
              { text: "deck", italic: true, code: false },
            ],
            list: { kind: "number", indent: 1, numberStyle: "lower-alpha" },
          },
        ],
        fit: "shrink-to-fit",
        language: "en-US",
      },
      localStyle: {
        text: {
          fontFamily: { token: "fonts.body" },
          fontSizePt: 16,
          weight: 600,
          italic: false,
          underline: true,
          strikethrough: false,
          color: { token: "colors.canvas.text" },
          lineHeight: 1.2,
          paragraphSpacingPt: 4,
          align: "center",
          verticalAlign: "middle",
          letterSpacingEm: 0.02,
          textTransform: "uppercase",
        },
        fill: {
          type: "linearGradient",
          from: "#ffffff",
          to: { token: "colors.accent.fill" },
          angle: 45,
          stops: [
            { color: "#ffffff", offsetPct: 0 },
            { color: "#000000", offsetPct: 100 },
          ],
        },
        stroke: { color: "#111111", widthPt: 1, dash: "dashed" },
        radius: { allPt: 8 },
        shadow: { xPt: 1, yPt: 2, blurPt: 4, color: "#000000", opacity: 0.2 },
        effect: { kind: "glass", intensity: "medium" },
        image: {
          fit: "cover",
          brightness: 1,
          contrast: 1,
          saturation: 1,
          maskShape: "rounded",
          radiusPct: 10,
          shadow: true,
        },
        connector: {
          stroke: { color: "#111111", widthPt: 1 },
          startArrow: "none",
          endArrow: "arrow",
          routing: "elbow",
        },
        table: {
          headerFill: { type: "solid", color: "#eeeeee" },
          rowFill: { type: "solid", color: "#ffffff" },
          alternateRowFill: { type: "solid", color: "#f7f7f7" },
          border: { color: "#cccccc", widthPt: 1 },
          cellPaddingPt: { top: 2, right: 2, bottom: 2, left: 2 },
          text: { color: "#111111" },
          headerText: { weight: 700 },
        },
        slide: {
          background: { type: "solid", color: "#ffffff" },
          accent: "#2563eb",
          paddingPct: { top: 5, right: 5, bottom: 5, left: 5 },
          chrome: "default",
          decoration: "subtle",
        },
        visual: {
          styleThemeId: "executive",
          transparentBackground: true,
          channelColors: { primary: "#2563eb" },
        },
        clip: { enabled: true },
        blendMode: "multiply",
      },
    });

    const imageNode: SlideChildNode = {
      id: "image-rich",
      type: "image",
      role: "image",
      layout: buildLayoutBox({ frame: { x: 40, y: 10, w: 30, h: 25 } }),
      style: { ref: "media.inline" },
      content: {
        assetId: "img-rich",
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
        fit: "contain",
        focalPoint: { x: 50, y: 50 },
        alt: "Rich image",
      },
    };
    const shapeNode: SlideChildNode = {
      id: "shape-rich",
      type: "shape",
      role: "callout",
      layout: buildLayoutBox({ frame: { x: 4, y: 40, w: 20, h: 10 } }),
      style: { ref: "surface.callout" },
      content: {
        shape: "path",
        path: "M 0 0 L 10 10",
      },
    };
    const connectorNode: SlideChildNode = {
      id: "connector-rich",
      type: "connector",
      role: "connector",
      layout: buildLayoutBox({ zIndex: 4 }),
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 10, y: 10 } },
        to: { kind: "node", nodeId: "shape-rich", anchor: "center" },
        routing: "curved",
      },
    };
    const tableNode: SlideChildNode = {
      id: "table-rich",
      type: "table",
      role: "table",
      layout: buildLayoutBox({ frame: { x: 25, y: 40, w: 40, h: 20 } }),
      style: { ref: "surface.table" },
      content: {
        columns: [
          { id: "name", label: "Name", width: 50 },
          { id: "value", label: "Value", width: 50 },
        ],
        rows: [
          {
            id: "row-1",
            cells: [
              { text: "Revenue", runs: [{ text: "Revenue", bold: true }] },
              { text: "$1M" },
            ],
          },
        ],
        header: true,
        caption: "Metrics",
      },
    };
    const visualNode: SlideChildNode = {
      id: "visual-rich",
      type: "visual",
      role: "visual",
      layout: buildLayoutBox({ frame: { x: 66, y: 40, w: 20, h: 20 } }),
      style: { ref: "chart.primary" },
      content: {
        assetId: "visual-asset",
        visualId: "visual-1",
        transparentBackground: true,
        alt: "Chart",
      },
    };
    const groupNode: SlideChildNode = {
      id: "group-rich",
      type: "group",
      component: "cardGrid",
      layout: buildLayoutBox({ frame: { x: 3, y: 3, w: 90, h: 50 } }),
      children: [textNode, imageNode],
    };
    const slide = buildSlide(
      "content",
      [groupNode, shapeNode, connectorNode, tableNode, visualNode],
      {
        id: "slide-rich",
        controls: { tone: "technical", density: "dense", emphasis: "data" },
        props: {
          decoration: "expressive",
          chrome: "minimal",
          deckChrome: {
            footer: {
              mode: "override",
              value: { enabled: true, text: "Local" },
            },
            logo: { mode: "disabled" },
          },
        },
        notes: "Speaker notes",
      },
    );
    const deck = buildDeck([slide], {
      id: "deck-rich",
      title: "Rich deck",
      canvas: {
        format: "custom",
        width: 100,
        height: 62.5,
        unit: "percent",
        safeArea: { top: 3, right: 4, bottom: 5, left: 6 },
      },
      assets: {
        images: {
          "img-rich": buildImageAsset("img-rich", {
            src: "data:image/png;base64,abc",
            alt: "Rich image",
            widthPx: 800,
            heightPx: 600,
            mimeType: "image/png",
            contentHash: "img-hash",
            origin: {
              kind: "remote",
              sourceId: "cdn",
              importedAt: "2026-01-01T00:00:00Z",
            },
          }),
        },
        fonts: {
          "font-rich": {
            id: "font-rich",
            family: "Inter",
            src: "https://example.com/inter.woff2",
            weight: [400, 700],
            style: "normal",
            contentHash: "font-hash",
          },
        },
        visuals: {
          "visual-asset": {
            id: "visual-asset",
            visualId: "visual-1",
            documentId: "doc-1",
            title: "Chart",
            alt: "Chart",
            contentHash: "visual-hash",
          },
        },
        files: {
          "file-rich": {
            id: "file-rich",
            src: "https://example.com/file.pdf",
            filename: "file.pdf",
            mimeType: "application/pdf",
            contentHash: "file-hash",
          },
        },
      },
      chrome: {
        logo: {
          enabled: true,
          assetId: "img-rich",
          alt: "Logo",
          placement: "top-left",
          size: "medium",
          layer: "foreground",
          layout: buildLayoutBox(),
          style: { opacity: 0.9 },
        },
        footer: { enabled: true, text: "Footer", align: "right" },
        pageNumber: {
          enabled: true,
          format: "number-total",
          placement: "bottom-center",
        },
        watermark: {
          enabled: true,
          text: "Draft",
          opacity: 0.15,
          layoutMode: "diagonal",
          size: "large",
        },
        border: { enabled: true, color: "#111111", widthPt: 1 },
        safeArea: {
          enabled: true,
          insets: { top: 4, right: 4, bottom: 4, left: 4 },
          color: "#eeeeee",
          widthPt: 0.5,
        },
      },
      metadata: {
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        extra: { nested: { ok: true, values: [1, "two", null] } },
      },
    });

    const result = safeParseDeck(deck);

    assert.ok(
      result.success,
      `Expected success but got ${!result.success && result.errors.join("\n")}`,
    );
  });

  test("reports edge-case diagnostics for invalid assets, styles, nodes, sources, and metadata", () => {
    const deck = invalidDeckRecord(buildMinimalDeck());
    deck.extraTopLevel = true;
    deck.elements = [];
    deck.canvas = {
      format: "poster",
      width: -1,
      height: Number.POSITIVE_INFINITY,
      unit: "px",
      safeArea: { top: 1, right: "bad", bottom: 1, left: 1, extra: 0 },
      extra: true,
    };
    deck.assets = {
      images: {
        "img-bad": {
          id: "other-image",
          src: "javascript:alert(1)",
          alt: 42,
          widthPx: "wide",
          heightPx: Number.NaN,
          mimeType: "image/bmp",
          contentHash: false,
          origin: {
            kind: "local",
            sourceId: 3,
            importedAt: false,
            extra: true,
          },
          extra: true,
        },
      },
      fonts: {
        "font-bad": {
          id: "font-bad",
          family: "",
          src: "//cdn.example/font.woff2",
          weight: [400, "bold"],
          style: "oblique",
        },
      },
      visuals: {
        "visual-bad": { id: "different", visualId: "", documentId: 9 },
      },
      files: {
        "file-bad": {
          id: "file-bad",
          src: "https://example.com/\u0000file",
          filename: 1,
        },
      },
      unexpected: true,
    };
    deck.theme = {
      packageId: "",
      packageVersion: 7,
      brandKitId: false,
      overrides: {
        tokens: "bad",
        styles: {
          "text.body": {
            default: {
              text: {
                fontFamily: 12,
                fontSizePt: "large",
                italic: "no",
                underline: "yes",
                strikethrough: "no",
                color: 42,
                lineHeight: "tight",
                paragraphSpacingPt: "wide",
                align: "justify",
                verticalAlign: "baseline",
                letterSpacingEm: "wide",
                textTransform: "capitalize",
              },
              fill: {
                type: "gradient",
                color: 42,
                angle: "steep",
                stops: [{ color: 42, offsetPct: "half", extra: true }, "bad"],
                kind: "bricks",
                assetId: "",
              },
              stroke: { color: 7, widthPt: "wide", dash: "dashdot" },
              radius: { allPt: "round" },
              opacity: "opaque",
              shadow: { xPt: "x", color: 3 },
              effect: { kind: "sparkle", intensity: "extreme", blurPt: "soft" },
              image: { fit: "stretch", maskShape: "blob", shadow: "yes" },
              connector: {
                stroke: "bad",
                startArrow: "triangle",
                routing: "around",
              },
              table: { cellPaddingPt: { top: "bad" }, text: "bad" },
              slide: {
                background: "bad",
                accent: 7,
                paddingPct: { top: 1 },
                chrome: "full",
              },
              visual: {
                styleThemeId: 3,
                transparentBackground: "yes",
                channelColors: "bad",
              },
              clip: { enabled: "yes" },
              blendMode: "difference",
              extraStyle: true,
            },
          },
          "not.registered": { default: {} },
          "slide.cover": "bad",
        },
        disabledDecorations: ["ok", 3],
        chrome: {
          unknown: {},
          footer: { enabled: "yes", text: 12, align: "justify" },
        },
        extraOverride: true,
      },
      extraTheme: true,
    };
    deck.metadata = {
      createdAt: 123,
      extra: { badNumber: Number.POSITIVE_INFINITY, badValue: () => "nope" },
    };

    const invalidText = invalidSlideChildNode({
      id: "dup",
      type: "text",
      role: "unknown-role",
      slot: "unknown-slot",
      locked: "yes",
      hidden: "no",
      accessibility: { label: 1, decorative: "no", readingOrder: "first" },
      source: {
        documentId: 3,
        blockKind: "audio",
        display: { documentTitle: 1, extra: true },
        refresh: { state: "expired", checkedAt: 1, extra: true },
        unlinked: "false",
        extra: "bad",
        unknown: true,
      },
      layout: {
        frame: { x: "left", y: 0, w: 0, h: -1 },
        zIndex: 1.5,
        rotation: "90",
        autoHeight: "no",
        flipX: "no",
        anchor: "middle",
        constraints: { minW: "small", preserveAspectRatio: "yes", extra: true },
        extra: true,
      },
      style: { ref: "missing.ref" },
      content: {
        paragraphs: [
          {
            id: "",
            text: "Hello",
            runs: [
              {
                text: "Mismatch",
                bold: "yes",
                link: "ftp://example.com",
                localStyle: { color: 1, fontSizePt: "big", extra: true },
                extra: true,
              },
            ],
            list: { kind: "dash", indent: -1, numberStyle: "roman" },
            extra: true,
          },
        ],
        fit: "overflow",
        language: 1,
        extra: true,
      },
    });
    const invalidChildren: SlideChildNode[] = [
      invalidText,
      { ...invalidText, id: "dup" },
      invalidSlideChildNode({
        id: "image-invalid",
        type: "image",
        content: {
          assetId: "",
          crop: { top: 1, right: 1, bottom: "bad", left: 1, extra: true },
          fit: "stretch",
          focalPoint: { x: 50, y: "middle", extra: true },
          alt: 3,
          extra: true,
        },
      }),
      invalidSlideChildNode({
        id: "shape-invalid",
        type: "shape",
        content: { shape: "blob", text: "bad", extra: true },
      }),
      invalidSlideChildNode({
        id: "shape-path-invalid",
        type: "shape",
        content: { shape: "path" },
      }),
      invalidSlideChildNode({
        id: "connector-invalid",
        type: "connector",
        content: {
          from: { kind: "node", nodeId: "", anchor: "middle", extra: true },
          to: { kind: "point", point: { x: "left", y: 5 } },
          routing: "around",
          extra: true,
        },
      }),
      invalidSlideChildNode({
        id: "table-invalid",
        type: "table",
        content: {
          columns: [
            { id: "c", label: "A" },
            { id: "c", label: "B" },
          ],
          rows: [{ id: "", cells: [{ text: 1, runs: "bad" }] }],
          header: "yes",
          extra: true,
        },
      }),
      invalidSlideChildNode({
        id: "visual-invalid",
        type: "visual",
        content: { transparentBackground: true, extra: true },
      }),
      invalidSlideChildNode({
        id: "group-invalid",
        type: "group",
        component: "stack",
        children: [],
        content: {},
      }),
      invalidSlideChildNode({
        id: "unknown-invalid",
        type: "video",
        content: {},
      }),
    ];
    deck.slides = [
      {
        id: "slide-invalid",
        type: "slide",
        template: { kind: "mystery" },
        controls: { tone: "flat", density: "tiny", emphasis: "none" },
        props: {
          decoration: "loud",
          chrome: "full",
          deckChrome: {
            ghost: {},
            footer: { mode: "override", value: "bad" },
            logo: { mode: "custom" },
          },
        },
        notes: 7,
        elements: [],
        children: invalidChildren,
        extraSlide: true,
      },
    ];

    const result = safeParseDeck(deck);

    assert.equal(result.success, false);
    if (!result.success) {
      assertHasError(result.errors, /Deck\.canvas\.format/);
      assertHasError(result.errors, /Deck\.assets\.images\[entry\]\.src/);
      assertHasError(result.errors, /protocol-relative URL/);
      assertHasError(result.errors, /must not contain control characters/);
      assertHasError(result.errors, /Deck\.theme\.overrides\.styles\[style\]/);
      assertHasError(result.errors, /Deck\.metadata\.extra\[entry\]/);
      assertHasError(result.errors, /runs text must concatenate/);
      assertHasError(result.errors, /content\.shape must be one of/);
      assertHasError(result.errors, /content\.path is required/);
      assertHasError(result.errors, /content must provide assetId or visualId/);
      assertHasError(result.errors, /children must be a non-empty array/);
      assertHasError(result.errors, /type is not a known node type/);
      assertHasError(result.errors, /props\.deckChrome\.footer\.value/);
    }
  });

  test("stops after non-presentation schema versions and reports the dedicated schema message", () => {
    const result = safeParseDeck({
      ...buildMinimalDeck(),
      schemaVersion: 6,
      slides: "not inspected after fatal schema mismatch",
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(result.errors, [
        "invalid_version: Deck.schemaVersion is not presentation (expected 7)",
      ]);
    }
  });

  test("handles non-object inputs without throwing", () => {
    const result = safeParseDeck(null);

    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(result.errors, [
        "invalid_structure: Deck must be an object",
      ]);
    }
  });
});
