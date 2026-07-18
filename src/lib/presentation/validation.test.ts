/**
 * presentation deck schema parsing and validation tests.
 */

// e2e-governance-allow oversized-test: schema validation matrix stays centralized until shared invalid-deck fixtures are split.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { safeParseDeck } from "@/lib/presentation/validation";
import type { SlideChildNode, SlideNode } from "@/lib/presentation/schema";
import {
  buildDeck,
  buildMinimalDeck,
  buildCoverSlide,
  buildContentSlide,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTableSlide,
  buildTextNode,
  buildVisualNode,
  resetBuilderCounter,
} from "@/test/builders/presentation-deck";

type BuildDeckOptions = Parameters<typeof buildDeck>[1];
type TableContentFixture = {
  content: { columns: unknown[]; rows: unknown[] };
};

function invalidSlide(value: unknown): SlideNode {
  return value as unknown as SlideNode;
}

function invalidChild(value: unknown): SlideChildNode {
  return value as unknown as SlideChildNode;
}

function invalidDeckOptions(value: unknown): BuildDeckOptions {
  return value as unknown as BuildDeckOptions;
}

function mutableRecord(value: unknown): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function invalidFitMode(value: unknown): "auto-height" {
  return value as unknown as "auto-height";
}

function invalidString(value: unknown): string {
  return value as unknown as string;
}

function tableContentFixture(value: unknown): TableContentFixture {
  return value as unknown as TableContentFixture;
}

describe("safeParseDeck", () => {
  test("accepts a valid minimal presentation deck", () => {
    resetBuilderCounter();
    const deck = buildMinimalDeck();
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
    if (result.success) {
      assert.equal(result.data.schemaVersion, 7);
    }
  });

  test("accepts a multi-slide deck", () => {
    resetBuilderCounter();
    const deck = buildDeck([
      buildCoverSlide(),
      buildContentSlide(),
      buildTableSlide(),
    ]);
    const result = safeParseDeck(deck);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.slides.length, 3);
    }
  });

  test("accepts current deck chrome schema", () => {
    resetBuilderCounter();
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        chrome: {
          logo: { enabled: true, assetId: "img-001" },
          footer: { enabled: true, text: "Footer", align: "center" },
          pageNumber: { enabled: true, format: "number-total" },
          watermark: { enabled: true, text: "Draft", opacity: 0.2 },
          border: { enabled: true, color: "#111111", widthPt: 1 },
          safeArea: {
            enabled: true,
            insets: { top: 5, right: 5, bottom: 5, left: 5 },
          },
        },
      }),
    );

    const result = safeParseDeck(deck);
    assert.ok(result.success);
  });

  test("rejects invalid deck chrome contracts", () => {
    const deck = {
      ...buildMinimalDeck(),
      chrome: {
        footer: { enabled: "yes" },
        safeArea: { insets: { top: 1, right: 1, bottom: 1, left: "bad" } },
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => /Deck\.chrome/.test(error)));
    }
  });

  test("accepts valid deck metadata and theme binding fields", () => {
    resetBuilderCounter();
    const deck = buildDeck([buildCoverSlide()], {
      metadata: {
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        sourceDocumentId: "doc-123",
        contentHash: "hash-123",
        locale: "en-US",
        extra: {
          review: { by: "qa", approved: true },
          tags: ["deck", "theme"],
        },
      },
      theme: {
        packageId: "neutral",
        packageVersion: "1.2.3",
        brandKitId: "brand-123",
        overrides: {
          disabledDecorations: ["logo", "footer"],
          chrome: {
            footer: { enabled: true, text: "Footer" },
          },
          styles: {
            "text.body": {
              default: { text: { color: "#111111" } },
            },
          },
        },
      },
    });
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects malformed and unknown metadata fields", () => {
    const deck = {
      ...buildMinimalDeck(),
      metadata: {
        createdAt: 123,
        unknownField: "kept",
        extra: "not-object",
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((error) => /Deck\.metadata\.createdAt/.test(error)),
      );
      assert.ok(
        result.errors.some((error) =>
          /unsupported_property: Deck\.metadata:/.test(error),
        ),
      );
      assert.ok(
        result.errors.some((error) => /Deck\.metadata\.extra/.test(error)),
      );
    }
  });

  test("rejects unknown deck theme and override fields", () => {
    const deck = {
      ...buildMinimalDeck(),
      theme: {
        packageId: "neutral",
        unexpected: true,
        overrides: {
          extraUnknown: true,
        },
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((error) =>
          /unsupported_property: Deck\.theme:/.test(error),
        ),
      );
      assert.ok(
        result.errors.some((error) =>
          /unsupported_property: Deck\.theme\.overrides:/.test(error),
        ),
      );
    }
  });

  test("rejects malformed theme scalar fields", () => {
    const deck = {
      ...buildMinimalDeck(),
      theme: {
        packageId: "neutral",
        packageVersion: 123,
        brandKitId: false,
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((error) =>
          /Deck\.theme\.packageVersion/.test(error),
        ),
      );
      assert.ok(
        result.errors.some((error) => /Deck\.theme\.brandKitId/.test(error)),
      );
    }
  });

  test("rejects invalid disabledDecorations payloads", () => {
    const badOverrides: unknown[] = [
      { disabledDecorations: "all" },
      { disabledDecorations: ["logo", 42] },
    ];

    for (const overrides of badOverrides) {
      const deck = {
        ...buildMinimalDeck(),
        theme: {
          packageId: "neutral",
          overrides,
        },
      };
      const result = safeParseDeck(deck);
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(
          result.errors.some((error) =>
            /Deck\.theme\.overrides\.disabledDecorations/.test(error),
          ),
        );
      }
    }
  });

  test("rejects invalid localStyle and chrome style patch contracts", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badSlide = invalidSlide({
      ...slide,
      localStyle: {
        slide: { chrome: "ultra" },
      },
      children: [
        {
          ...slide.children[0],
          localStyle: {
            unknownField: true,
            text: { align: "justify" },
            fill: { type: "solid", color: { token: 42 } },
          },
        },
      ],
    });
    const deck = buildDeck(
      [badSlide],
      invalidDeckOptions({
        chrome: {
          footer: {
            enabled: true,
            text: "Footer",
            style: mutableRecord({ sparkle: true }),
          },
        },
      }),
    );

    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /slides\[0\]\.localStyle\.slide\.chrome/,
        /unsupported_property: slides\[0\]\.children\[0\]\.localStyle:/,
        /slides\[0\]\.children\[0\]\.localStyle\.text\.align/,
        /slides\[0\]\.children\[0\]\.localStyle\.fill\.color\.token/,
        /unsupported_property: Deck\.chrome\.footer\.style:/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("rejects invalid theme override style patch values", () => {
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        theme: {
          packageId: "neutral",
          overrides: {
            styles: {
              "text.body": {
                default: {
                  fill: {
                    type: "noise",
                    stops: [{ offsetPct: "zero" }],
                  },
                  table: {
                    cellPaddingPt: { top: "bad" },
                  },
                  blendMode: "xor",
                },
              },
            },
          },
        },
      }),
    );

    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /Deck\.theme\.overrides\.styles\[style\]\[variant\]\.fill\.type/,
        /Deck\.theme\.overrides\.styles\[style\]\[variant\]\.fill\.stops\[0\]\.offsetPct/,
        /Deck\.theme\.overrides\.styles\[style\]\[variant\]\.table\.cellPaddingPt\.top/,
        /Deck\.theme\.overrides\.styles\[style\]\[variant\]\.blendMode/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("accepts representative valid text/fill/stroke/image/table/slide style patches", () => {
    resetBuilderCounter();
    const slide = buildContentSlide();
    const styledChild = {
      ...slide.children[0],
      localStyle: {
        text: {
          fontFamily: { token: "fonts.body" },
          fontSizePt: 22,
          weight: 600,
          italic: false,
          underline: false,
          strikethrough: false,
          color: "#111111",
          lineHeight: 1.2,
          paragraphSpacingPt: 3,
          align: "left",
          verticalAlign: "top",
          letterSpacingEm: 0.01,
          textTransform: "none",
        },
        fill: { type: "solid", color: { token: "colors.accent.fill" } },
        stroke: { color: "#334155", widthPt: 1.5, dash: "dotted" },
        image: {
          fit: "cover",
          brightness: 1.1,
          contrast: 0.95,
          saturation: 1,
          maskShape: "rounded",
          radiusPct: 8,
          shadow: true,
        },
        table: {
          headerFill: { type: "solid", color: "#111111" },
          rowFill: { type: "solid", color: "#ffffff" },
          alternateRowFill: { type: "solid", color: "#f3f4f6" },
          border: { color: "#d1d5db", widthPt: 1, dash: "solid" },
          cellPaddingPt: { top: 1, right: 1, bottom: 1, left: 1 },
          text: { fontSizePt: 12, color: "#111111" },
          headerText: { fontSizePt: 12, weight: 700, color: "#ffffff" },
        },
        slide: {
          background: { type: "solid", color: "#ffffff" },
          accent: "#4f46e5",
          paddingPct: { top: 4, right: 4, bottom: 4, left: 4 },
          chrome: "default",
          decoration: "subtle",
        },
      },
    } as SlideChildNode;

    const deck = buildDeck(
      [
        {
          ...slide,
          localStyle: {
            slide: { chrome: "minimal", decoration: "default" },
          },
          children: [styledChild],
        },
      ],
      {
        theme: {
          packageId: "neutral",
          overrides: {
            styles: {
              "text.body": {
                default: {
                  text: { color: "#0f172a" },
                  fill: { type: "solid", color: "#ffffff" },
                  stroke: { color: "#334155", widthPt: 1 },
                  image: { fit: "contain" },
                  table: {
                    cellPaddingPt: { top: 2, right: 2, bottom: 2, left: 2 },
                  },
                  slide: {
                    chrome: "none",
                    decoration: "none",
                  },
                },
              },
            },
          },
        },
        chrome: {
          footer: {
            enabled: true,
            text: "Footer",
            style: { text: { color: "#111111" } },
          },
        },
      },
    );

    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects non-object input", () => {
    const result = safeParseDeck("not-an-object");
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /object/.test(e)));
    }
  });

  test("rejects null input", () => {
    const result = safeParseDeck(null);
    assert.ok(!result.success);
  });

  test("rejects missing schemaVersion", () => {
    const deck = buildMinimalDeck();
    const { schemaVersion: _, ...noVersion } = deck;
    const result = safeParseDeck(noVersion);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /schemaVersion/.test(e)));
    }
  });

  test("rejects schemaVersion 6 (v6 deck)", () => {
    const deck = { ...buildMinimalDeck(), schemaVersion: 6 };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) => /presentation|schemaVersion/.test(e)),
      );
    }
  });

  test("rejects v6 fields (elements, masters, design)", () => {
    const deck = { ...buildMinimalDeck(), elements: [], masters: [] };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /v6|masters|elements/.test(e)));
    }
  });

  test("rejects empty slides array", () => {
    const deck = { ...buildMinimalDeck(), slides: [] };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /slides/.test(e)));
    }
  });

  test("rejects duplicate node ids", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    // Duplicate node id within the slide
    const dupeSlide = {
      ...slide,
      children: [
        { ...slide.children[0], id: "dup-id" },
        { ...slide.children[0], id: "dup-id" }, // deliberate duplicate
      ],
    };
    const deck = buildDeck([dupeSlide]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /duplicat/.test(e)));
    }
  });

  test("rejects unknown node type", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badSlide = {
      ...slide,
      children: [
        {
          id: "bad-node",
          type: "widget",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          style: { ref: "text.body" },
          content: {},
        },
      ],
    };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
  });

  test("rejects unknown nested child-node and content keys", () => {
    resetBuilderCounter();
    const badTextNode = mutableRecord(
      buildTextNode({
        id: "text-bad-nested",
        content: {
          paragraphs: [{ id: "para-bad-nested", text: "Body" }],
        },
      }),
    );
    badTextNode.unexpectedNodeKey = true;
    badTextNode.content = {
      paragraphs: [
        {
          id: "para-bad-nested",
          text: "Body",
          unexpectedParagraphKey: true,
          runs: [
            {
              text: "Body",
              unexpectedRunKey: true,
              localStyle: {
                fontSizePt: 14,
                unknownLocalStyleKey: true,
              },
            },
          ],
          list: {
            kind: "bullet",
            unexpectedListKey: true,
          },
        },
      ],
      unexpectedTextContentKey: true,
    };

    const badImageNode = mutableRecord(
      buildImageNode("img-001", {
        id: "image-bad-nested",
      }),
    );
    badImageNode.content = {
      assetId: "img-001",
      unexpectedImageContentKey: true,
    };

    const badShapeNode = mutableRecord(
      buildShapeNode({
        id: "shape-bad-nested",
        content: { shape: "rect" },
      }),
    );
    badShapeNode.content = {
      shape: "rect",
      unexpectedShapeContentKey: true,
    };

    const badConnectorNode = {
      id: "connector-bad-nested",
      type: "connector",
      role: "connector",
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 5, y: 5 } },
        to: { kind: "point", point: { x: 35, y: 15 } },
        unexpectedConnectorContentKey: true,
      },
    };

    const badTableNode = mutableRecord(
      buildTableNode({
        id: "table-bad-nested",
        content: {
          columns: [{ id: "col-0", label: "Name" }],
          rows: [{ id: "row-0", cells: [{ text: "Value" }] }],
        },
      }),
    );
    badTableNode.content = {
      columns: [{ id: "col-0", label: "Name", unexpectedColumnKey: true }],
      rows: [
        {
          id: "row-0",
          unexpectedRowKey: true,
          cells: [{ text: "Value", unexpectedCellKey: true }],
        },
      ],
      unexpectedTableContentKey: true,
    };

    const badVisualNode = mutableRecord(
      buildVisualNode({
        id: "visual-bad-nested",
        content: { visualId: "visual-001" },
      }),
    );
    badVisualNode.content = {
      visualId: "visual-001",
      unexpectedVisualContentKey: true,
    };

    const badGroupChildNode = mutableRecord(
      buildTextNode({
        id: "group-child-bad-nested",
        content: {
          paragraphs: [{ id: "group-para-1", text: "Nested" }],
        },
      }),
    );
    badGroupChildNode.content = {
      paragraphs: [{ id: "group-para-1", text: "Nested" }],
      unexpectedNestedTextContentKey: true,
    };

    const badGroupNode = {
      id: "group-bad-nested",
      type: "group",
      component: "custom",
      unexpectedGroupKey: true,
      children: [badGroupChildNode],
    };

    const slide = buildSlide("content", [
      invalidChild(badTextNode),
      invalidChild(badImageNode),
      invalidChild(badShapeNode),
      invalidChild(badConnectorNode),
      invalidChild(badTableNode),
      invalidChild(badVisualNode),
      invalidChild(badGroupNode),
    ]);
    const result = safeParseDeck(buildDeck([slide]));
    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /unsupported_property: slides\[0\]\.children\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[0\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[0\]\.content\.paragraphs\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[0\]\.content\.paragraphs\[0\]\.runs\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[0\]\.content\.paragraphs\[0\]\.runs\[0\]\.localStyle:/,
        /unsupported_property: slides\[0\]\.children\[0\]\.content\.paragraphs\[0\]\.list:/,
        /unsupported_property: slides\[0\]\.children\[1\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[2\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[3\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[4\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[4\]\.content\.columns\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[4\]\.content\.rows\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[4\]\.content\.rows\[0\]\.cells\[0\]:/,
        /unsupported_property: slides\[0\]\.children\[5\]\.content:/,
        /unsupported_property: slides\[0\]\.children\[6\]:/,
        /unsupported_property: slides\[0\]\.children\[6\]\.children\[0\]\.content:/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("accepts nested slide child nodes that only use known keys", () => {
    resetBuilderCounter();
    const textNode = buildTextNode({
      id: "text-valid-nested",
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        blockKind: "text",
        extra: { allowed: true },
      },
      content: {
        paragraphs: [
          {
            id: "para-valid-nested",
            text: "Nested body",
            runs: [{ text: "Nested body", bold: true }],
            list: { kind: "bullet", indent: 1 },
          },
        ],
        fit: "fixed-box",
        language: "en-US",
      },
    });
    const imageNode = buildImageNode("img-001", {
      id: "image-valid-nested",
      content: {
        assetId: "img-001",
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        fit: "cover",
        focalPoint: { x: 50, y: 50 },
        alt: "image alt",
      },
    });
    const shapeNode = buildShapeNode({
      id: "shape-valid-nested",
      content: { shape: "rect" },
    });
    const connectorNode: SlideChildNode = {
      id: "connector-valid-nested",
      type: "connector",
      role: "connector",
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 5, y: 5 } },
        to: { kind: "point", point: { x: 35, y: 15 } },
        routing: "elbow",
      },
    };
    const tableNode = buildTableNode({
      id: "table-valid-nested",
      content: {
        columns: [{ id: "col-0", label: "Name", width: 20 }],
        rows: [
          {
            id: "row-0",
            cells: [{ text: "Value", runs: [{ text: "Value" }] }],
          },
        ],
        header: true,
        caption: "Summary table",
      },
    });
    const visualNode = buildVisualNode({
      id: "visual-valid-nested",
      content: {
        visualId: "visual-001",
        transparentBackground: true,
        alt: "visual alt",
      },
    });
    const groupNode: SlideChildNode = {
      id: "group-valid-nested",
      type: "group",
      component: "custom",
      children: [
        buildTextNode({
          id: "group-child-valid-nested",
          content: {
            paragraphs: [{ id: "group-para-valid", text: "Nested child" }],
          },
        }),
      ],
    };

    const slide = buildSlide("content", [
      textNode,
      imageNode,
      shapeNode,
      connectorNode,
      tableNode,
      visualNode,
      groupNode,
    ]);
    const result = safeParseDeck(buildDeck([slide]));
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects unknown template kind", () => {
    resetBuilderCounter();
    const slide = invalidSlide({
      ...buildCoverSlide(),
      template: { kind: "nonexistent-kind" },
    });
    const deck = buildDeck([slide]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /template.kind|kind/.test(e)));
    }
  });

  test("rejects non-string slide notes", () => {
    resetBuilderCounter();
    const invalidNotesValues: unknown[] = [
      { text: "note" },
      ["note"],
      123,
      true,
    ];

    for (const notes of invalidNotesValues) {
      const slide = invalidSlide({ ...buildCoverSlide(), notes });
      const deck = buildDeck([slide]);
      const result = safeParseDeck(deck);
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(result.errors.some((e) => /slides\[0\]\.notes/.test(e)));
      }
    }
  });

  test("accepts string slide notes", () => {
    resetBuilderCounter();
    const slide = { ...buildCoverSlide(), notes: "Presenter reminder" };
    const deck = buildDeck([slide]);
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects invalid canvas format", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: { format: "8:5", width: 100, height: 62.5, unit: "percent" },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /format/.test(e)));
    }
  });

  test("rejects unknown style ref in node", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badChild = {
      ...slide.children[0],
      style: { ref: "not.a.real.ref" },
    };
    const badSlide = { ...slide, children: [badChild] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /StyleRef|style/.test(e)));
    }
  });

  test("rejects invalid text runs (runs don't match paragraph text)", () => {
    resetBuilderCounter();
    const slide = buildContentSlide();
    const paragraphText = "TOP SECRET PARAGRAPH TEXT";
    const runText = "TOP SECRET RUN CONTENT";
    const badNode = invalidChild({
      ...slide.children[0],
      type: "text",
      content: {
        paragraphs: [
          {
            id: "para-001",
            text: paragraphText,
            runs: [{ text: runText }],
          },
        ],
      },
    });
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) =>
          /runs text must concatenate to paragraph text/.test(e),
        ),
      );
      const joinedErrors = result.errors.join(" ");
      assert.ok(!joinedErrors.includes(paragraphText));
      assert.ok(!joinedErrors.includes(runText));
    }
  });

  test("accepts safe text run link schemes", () => {
    resetBuilderCounter();
    const linkedNode = buildTextNode({
      content: {
        paragraphs: [
          {
            id: "para-link-https",
            text: "Website",
            runs: [{ text: "Website", link: "https://example.test" }],
          },
          {
            id: "para-link-mailto",
            text: "Email",
            runs: [{ text: "Email", link: "mailto:team@example.test" }],
          },
          {
            id: "para-link-tel",
            text: "Call",
            runs: [{ text: "Call", link: "tel:+15551234567" }],
          },
          {
            id: "para-link-relative",
            text: "Docs",
            runs: [{ text: "Docs", link: "/docs/getting-started" }],
          },
        ],
      },
    });
    const deck = buildDeck([buildSlide("content", [linkedNode])]);
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      !result.success ? result.errors.join("; ") : "expected success",
    );
  });

  test("rejects unsafe text run link schemes", () => {
    resetBuilderCounter();
    const linkedNode = buildTextNode({
      content: {
        paragraphs: [
          {
            id: "para-link-bad",
            text: "Click me",
            runs: [{ text: "Click me", link: "javascript:alert(1)" }],
          },
        ],
      },
    });
    const deck = buildDeck([buildSlide("content", [linkedNode])]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /runs\[0\]\.link/.test(e)));
    }
  });

  test("accepts text content fit and language values", () => {
    const fitModes = ["auto-height", "fixed-box", "shrink-to-fit"] as const;
    const nodes = fitModes.map((fit, index) =>
      buildTextNode({
        id: `text-fit-${index}`,
        content: {
          paragraphs: [{ id: `para-fit-${index}`, text: `Fit ${fit}` }],
          fit,
          language: "en-US",
        },
      }),
    );
    const deck = buildDeck([buildSlide("content", nodes)]);
    const result = safeParseDeck(deck);

    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
    if (result.success) {
      const parsedNodes = result.data.slides[0].children;
      assert.deepEqual(
        parsedNodes.map((node) =>
          node.type === "text" ? node.content.fit : undefined,
        ),
        fitModes,
      );
      assert.deepEqual(
        parsedNodes.map((node) =>
          node.type === "text" ? node.content.language : undefined,
        ),
        ["en-US", "en-US", "en-US"],
      );
    }
  });

  test("rejects invalid text content fit mode", () => {
    const badNode = buildTextNode({
      content: {
        paragraphs: [{ id: "para-001", text: "hello world" }],
        fit: invalidFitMode("squash"),
      },
    });
    const deck = buildDeck([buildSlide("content", [badNode])]);
    const result = safeParseDeck(deck);

    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => /content\.fit/.test(error)));
    }
  });

  test("rejects non-string text content language", () => {
    const badNode = buildTextNode({
      content: {
        paragraphs: [{ id: "para-001", text: "hello world" }],
        language: invalidString(42),
      },
    });
    const deck = buildDeck([buildSlide("content", [badNode])]);
    const result = safeParseDeck(deck);

    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => /content\.language/.test(error)));
    }
  });

  test("rejects malformed text run and list marker fields", () => {
    resetBuilderCounter();
    const slide = buildContentSlide();
    const badNode = {
      ...slide.children[0],
      type: "text",
      content: {
        paragraphs: [
          {
            id: "para-001",
            text: "hello",
            runs: [
              {
                text: "hello",
                bold: "yes",
                link: "javascript:alert(1)",
                localStyle: { fontSizePt: "huge", color: 42 },
              },
            ],
            list: { kind: "triangle", indent: "deep", numberStyle: "roman" },
          },
        ],
      },
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /runs\[0\]\.bold/,
        /runs\[0\]\.link/,
        /runs\[0\]\.localStyle\.fontSizePt/,
        /runs\[0\]\.localStyle\.color/,
        /paragraphs\[0\]\.list\.kind/,
        /paragraphs\[0\]\.list\.indent/,
        /paragraphs\[0\]\.list\.numberStyle/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("accepts rich text runs and valid list markers", () => {
    resetBuilderCounter();
    const slide = buildContentSlide();
    const validNode = {
      ...slide.children[0],
      type: "text",
      content: {
        paragraphs: [
          {
            id: "para-001",
            text: "hello world",
            runs: [
              { text: "hello", bold: true, link: "https://example.com" },
              {
                text: " world",
                italic: true,
                localStyle: {
                  color: "#111111",
                  fontSizePt: 18,
                  fontFamily: "Inter",
                },
              },
            ],
            list: { kind: "number", indent: 1, numberStyle: "decimal" },
          },
          {
            id: "para-002",
            text: "email",
            runs: [{ text: "email", link: "mailto:hello@example.com" }],
            list: { kind: "bullet", indent: 2 },
          },
        ],
      },
    };
    const validSlide = { ...slide, children: [validNode] };
    const deck = buildDeck([invalidSlide(validSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });
  test("rejects table with too many columns (>8)", () => {
    resetBuilderCounter();
    const tableSlide = buildTableSlide();
    const badTable = {
      ...tableSlide.children[1],
      content: {
        columns: Array.from({ length: 9 }, (_, i) => ({
          id: `col-${i}`,
          label: `C${i}`,
        })),
        rows: [
          {
            id: "row-0",
            cells: Array.from({ length: 9 }, (_, i) => ({ text: `v${i}` })),
          },
        ],
      },
    };
    const badSlide = { ...tableSlide, children: [badTable] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /column/.test(e)));
    }
  });

  test("rejects w=0 in frame", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badChild = {
      ...slide.children[0],
      layout: { frame: { x: 0, y: 0, w: 0, h: 10 }, zIndex: 1 },
    };
    const badSlide = { ...slide, children: [badChild] };
    const deck = buildDeck([badSlide]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /w.*h|0/.test(e)));
    }
  });

  test("accepts auto-height layout metadata", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const sourceChild = slide.children[0];
    assert.ok(sourceChild.layout);
    const child = invalidChild({
      ...sourceChild,
      layout: {
        ...sourceChild.layout,
        autoHeight: true,
        flipX: true,
        flipY: false,
        constraints: { minH: 6, preserveAspectRatio: false },
      },
    });
    const deck = buildDeck([{ ...slide, children: [child] }]);
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects invalid auto-height layout metadata", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const sourceChild = slide.children[0];
    assert.ok(sourceChild.layout);
    const child = invalidChild({
      ...sourceChild,
      layout: {
        ...sourceChild.layout,
        autoHeight: "yes",
      },
    });
    const deck = buildDeck([{ ...slide, children: [child] }]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => /autoHeight/.test(error)));
    }
  });

  test("rejects invalid layout flip metadata", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const sourceChild = slide.children[0];
    assert.ok(sourceChild.layout);
    const child = invalidChild({
      ...sourceChild,
      layout: {
        ...sourceChild.layout,
        flipX: "yes",
        flipY: "no",
      },
    });
    const deck = buildDeck([{ ...slide, children: [child] }]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => /flipX/.test(error)));
      assert.ok(result.errors.some((error) => /flipY/.test(error)));
    }
  });

  test("rejects deck with unknown top-level field", () => {
    const deck = { ...buildMinimalDeck(), unknownField: "oops" };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) =>
          /unsupported_property: Deck: unsupported property count=1/.test(e),
        ),
      );
    }
  });

  test("rejects connector node missing content", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "conn-1",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 5 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: null,
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /content/.test(e)));
    }
  });

  test("rejects connector endpoint with invalid kind", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "conn-2",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 5 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "anchor" }, // invalid: must be "point" or "node"
        to: { kind: "point", point: { x: 40, y: 2.5 } },
      },
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /kind.*point.*node|anchor/i.test(e)));
    }
  });

  test("accepts connector node endpoints with valid anchors and routing", () => {
    resetBuilderCounter();
    const startNode = buildTextNode({ id: "connector-start-node" });
    const endNode = buildTextNode({ id: "connector-end-node" });
    const connectorNode = {
      id: "connector-node-valid",
      type: "connector",
      role: "connector",
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", nodeId: startNode.id, anchor: "right" },
        to: { kind: "node", nodeId: endNode.id, anchor: "left" },
        routing: "curved",
      },
    };
    const slide = buildSlide("content", [
      startNode,
      endNode,
      invalidChild(connectorNode),
    ]);
    const result = safeParseDeck(buildDeck([slide]));
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects connector point endpoints with non-finite coordinates", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "conn-point-bad",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 5 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: Number.NaN, y: 2.5 } },
        to: { kind: "point", point: { x: 40, y: Number.POSITIVE_INFINITY } },
      },
    };
    const badSlide = { ...slide, children: [badNode] };
    const result = safeParseDeck(buildDeck([invalidSlide(badSlide)]));
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /content\.from\.point\.x/.test(e)));
      assert.ok(result.errors.some((e) => /content\.to\.point\.y/.test(e)));
    }
  });

  test("rejects connector node endpoints with invalid nodeId or anchor", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "conn-node-bad",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 5 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "node", anchor: "top" },
        to: { kind: "node", nodeId: "", anchor: "middle" },
      },
    };
    const badSlide = { ...slide, children: [badNode] };
    const result = safeParseDeck(buildDeck([invalidSlide(badSlide)]));
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /content\.from\.nodeId/.test(e)));
      assert.ok(result.errors.some((e) => /content\.to\.nodeId/.test(e)));
      assert.ok(result.errors.some((e) => /content\.to\.anchor/.test(e)));
    }
  });

  test("rejects connector content with invalid routing", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "conn-routing-bad",
      type: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 5 }, zIndex: 1 },
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "point", point: { x: 0, y: 2.5 } },
        to: { kind: "point", point: { x: 40, y: 2.5 } },
        routing: "zigzag",
      },
    };
    const badSlide = { ...slide, children: [badNode] };
    const result = safeParseDeck(buildDeck([invalidSlide(badSlide)]));
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /content\.routing/.test(e)));
    }
  });

  test("rejects shape with invalid shape kind", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "shape-bad",
      type: "shape",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      style: { ref: "surface.card" },
      content: { shape: "hexagon" }, // not in SHAPE_KINDS
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /shape/.test(e)));
    }
  });

  test("rejects shape with kind=path but missing path string", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "path-shape",
      type: "shape",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      style: { ref: "surface.card" },
      content: { shape: "path" }, // path required when shape is "path"
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /path/.test(e)));
    }
  });

  test("rejects image node with missing assetId", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "img-bad",
      type: "image",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "media.hero" },
      content: {}, // missing assetId
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /assetId/.test(e)));
    }
  });

  test("accepts image node with valid crop, fit, focalPoint, and alt", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const imageNode = {
      id: "img-rich",
      type: "image",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "media.hero" },
      content: {
        assetId: "img-001",
        crop: { top: 5, right: 10, bottom: 5, left: 10 },
        fit: "cover",
        focalPoint: { x: 45, y: 55 },
        alt: "Descriptive alt text",
      },
    };
    const deck = buildDeck([{ ...slide, children: [imageNode] } as SlideNode]);
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects image node with malformed crop, fit, focalPoint, and alt", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const baseNode = {
      id: "img-base",
      type: "image",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "media.hero" },
      content: { assetId: "img-001" },
    };
    const cases: Array<{
      name: string;
      node: Record<string, unknown>;
      errorPattern: RegExp;
    }> = [
      {
        name: "invalid-fit",
        node: {
          ...baseNode,
          content: { ...baseNode.content, fit: "stretchy" },
        },
        errorPattern: /content\.fit|contain|cover|fill|none/i,
      },
      {
        name: "invalid-crop",
        node: {
          ...baseNode,
          content: {
            ...baseNode.content,
            crop: { top: "5", right: 2, bottom: 3, left: 4 },
          },
        },
        errorPattern: /content\.crop\.top|finite number/i,
      },
      {
        name: "invalid-focal-point",
        node: {
          ...baseNode,
          content: {
            ...baseNode.content,
            focalPoint: { x: "50", y: 50 },
          },
        },
        errorPattern: /content\.focalPoint\.x|finite number/i,
      },
      {
        name: "invalid-alt",
        node: {
          ...baseNode,
          content: { ...baseNode.content, alt: 7 },
        },
        errorPattern: /content\.alt|string/i,
      },
    ];

    for (const testCase of cases) {
      const badNode = { ...testCase.node, id: `img-${testCase.name}` };
      const badSlide = {
        ...slide,
        children: [invalidChild(badNode)],
      };
      const deck = buildDeck([invalidSlide(badSlide)]);
      const result = safeParseDeck(deck);
      assert.ok(!result.success, `Expected parse failure for ${testCase.name}`);
      if (!result.success) {
        assert.ok(
          result.errors.some((error) => testCase.errorPattern.test(error)),
          `Expected ${testCase.name} to fail with pattern ${testCase.errorPattern}, got: ${result.errors.join(" | ")}`,
        );
      }
    }
  });

  test("rejects visual node with neither assetId nor visualId", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badNode = {
      id: "vis-bad",
      type: "visual",
      layout: { frame: { x: 0, y: 0, w: 20, h: 20 }, zIndex: 1 },
      style: { ref: "media.hero" },
      content: {}, // neither assetId nor visualId
    };
    const badSlide = { ...slide, children: [badNode] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /assetId|visualId/.test(e)));
    }
  });

  test("rejects group node with invalid component kind", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const innerNode = { ...slide.children[0], id: "inner-node" };
    const badGroup = {
      id: "group-bad",
      type: "group",
      component: "unknownWidget", // invalid component
      layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
      children: [innerNode],
    };
    const badSlide = { ...slide, children: [badGroup] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /component/.test(e)));
    }
  });

  test("rejects style bindings and local style patches on logical groups", () => {
    const slide = buildCoverSlide();
    const child = { ...slide.children[0], id: "group-style-child" };
    for (const unsupported of [
      { style: { ref: "surface.card" } },
      {
        localStyle: {
          fill: { type: "solid", color: "#22c55e" },
          opacity: 0.4,
        },
      },
    ]) {
      const group = {
        id: "group-style-invalid",
        type: "group",
        component: "custom",
        layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
        children: [child],
        ...unsupported,
      };
      const result = safeParseDeck(
        buildDeck([
          invalidSlide({
            ...slide,
            children: [group],
          }),
        ]),
      );

      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(
          result.errors.some((error) =>
            /unsupported_property: slides\[0\]\.children\[0\]:/.test(error),
          ),
        );
      }
    }
  });

  test("rejects group node with empty children array", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badGroup = {
      id: "group-empty",
      type: "group",
      component: "custom",
      layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
      children: [], // empty is invalid
    };
    const badSlide = { ...slide, children: [badGroup] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /children/.test(e)));
    }
  });

  test("rejects invalid canvas unit", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: { format: "16:9", width: 100, height: 56.25, unit: "pixel" },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /unit.*percent/i.test(e)));
    }
  });

  test("accepts valid canvas safeArea insets", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
        safeArea: { top: 6, right: 6, bottom: 6, left: 6 },
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(result.success);
  });

  test("rejects non-object canvas safeArea", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
        safeArea: "bad",
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) =>
          /Deck\.canvas\.safeArea must be an object/.test(e),
        ),
      );
    }
  });

  test("rejects canvas safeArea with missing or non-finite inset fields", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
        safeArea: { top: 6, right: 6, bottom: 6 },
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) =>
          /Deck\.canvas\.safeArea\.left must be a finite number/.test(e),
        ),
      );
    }
  });

  test("rejects canvas safeArea with unknown inset keys", () => {
    const deck = {
      ...buildMinimalDeck(),
      canvas: {
        format: "16:9",
        width: 100,
        height: 56.25,
        unit: "percent",
        safeArea: { top: 6, right: 6, bottom: 6, left: 6, horizontal: 12 },
      },
    };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) =>
          /unsupported_property: Deck\.canvas\.safeArea:/.test(e),
        ),
      );
    }
  });

  test("rejects non-object asset registry", () => {
    const deck = { ...buildMinimalDeck(), assets: "not-an-object" };
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /assets/.test(e)));
    }
  });

  test("accepts safe Deck asset source schemes", () => {
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        assets: {
          images: {
            "img-001": {
              id: "img-001",
              src: "https://example.test/image.png",
              alt: "Hero image",
              widthPx: 1920,
              heightPx: 1080,
              mimeType: "image/png",
              contentHash: "hash-image",
              origin: {
                kind: "upload",
                sourceId: "doc-1",
                importedAt: "2026-02-01T00:00:00Z",
              },
            },
            "img-local": {
              id: "img-local",
              src: "/api/slide-assets/doc-1/key-1",
            },
            "img-data": { id: "img-data", src: "data:image/png;base64,abc123" },
          },
          fonts: {
            "font-001": {
              id: "font-001",
              family: "Inter",
              src: "/api/slide-assets/doc-1/font-1.woff2",
              weight: [400, 700],
              style: "normal",
              contentHash: "hash-font",
            },
          },
          visuals: {
            "visual-001": {
              id: "visual-001",
              visualId: "visual-001",
              documentId: "doc-1",
              title: "Q2 KPI visual",
              alt: "KPI chart",
              contentHash: "hash-visual",
            },
          },
          files: {
            "file-001": {
              id: "file-001",
              src: "data:application/pdf;base64,abc123",
              filename: "report.pdf",
              mimeType: "application/pdf",
              contentHash: "hash-file",
            },
          },
        },
      }),
    );
    const result = safeParseDeck(deck);
    assert.ok(
      result.success,
      !result.success ? result.errors.join("; ") : "expected success",
    );
  });

  test("rejects unsafe Deck asset source schemes", () => {
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        assets: {
          images: {
            "img-001": { id: "img-001", src: "javascript:alert(1)" },
          },
          files: {
            "file-001": { id: "file-001", src: "ftp://example.test/file.bin" },
          },
        },
      }),
    );
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        result.errors.some((e) => /Deck\.assets\.images\[entry\]\.src/.test(e)),
      );
      assert.ok(
        result.errors.some((e) => /Deck\.assets\.files\[entry\]\.src/.test(e)),
      );
    }
  });

  test("rejects malformed nested Deck asset entries", () => {
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        assets: {
          images: {
            "img-001": {
              id: "img-002",
              src: "https://example.test/image.png",
              widthPx: "wide",
              origin: { kind: "legacy" },
            },
          },
          fonts: {
            "font-001": {
              id: "font-001",
              family: 42,
              src: "https://example.test/font.woff2",
              weight: ["heavy"],
              style: "oblique",
            },
          },
          visuals: {
            "visual-001": {
              id: "visual-001",
              visualId: 123,
              documentId: false,
              alt: 999,
            },
          },
          files: {
            "file-001": {
              id: "file-001",
              src: "https://example.test/file.pdf",
              filename: 42,
              mimeType: {},
            },
          },
        },
      }),
    );
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /Deck\.assets\.images\[entry\]\.id must match its registry key/,
        /Deck\.assets\.images\[entry\]\.widthPx/,
        /Deck\.assets\.images\[entry\]\.origin\.kind/,
        /Deck\.assets\.fonts\[entry\]\.family/,
        /Deck\.assets\.fonts\[entry\]\.weight\[0\]/,
        /Deck\.assets\.fonts\[entry\]\.style/,
        /Deck\.assets\.visuals\[entry\]\.visualId/,
        /Deck\.assets\.visuals\[entry\]\.documentId/,
        /Deck\.assets\.visuals\[entry\]\.alt/,
        /Deck\.assets\.files\[entry\]\.filename/,
        /Deck\.assets\.files\[entry\]\.mimeType/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("rejects layout box with non-integer zIndex", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badChild = {
      ...slide.children[0],
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1.5 },
    };
    const badSlide = { ...slide, children: [badChild] };
    const deck = buildDeck([badSlide]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /zIndex/.test(e)));
    }
  });

  test("rejects slide with unknown controls.tone", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const badSlide = {
      ...slide,
      controls: { tone: "furious" }, // invalid tone
    };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /tone/.test(e)));
    }
  });

  test("rejects invalid deck chrome enum and scalar values", () => {
    resetBuilderCounter();
    const deck = buildDeck(
      [buildCoverSlide()],
      invalidDeckOptions({
        chrome: {
          logo: { enabled: true, assetId: "img-001", size: "huge" },
          footer: { enabled: true, text: 42, align: "wide" },
          pageNumber: { enabled: true, format: "roman", placement: "top-left" },
          watermark: {
            enabled: true,
            text: "Draft",
            layoutMode: "tilted",
            size: "giant",
            opacity: "faint",
          },
          border: { enabled: true, color: 123, widthPt: "thick" },
          safeArea: { enabled: true, color: false, widthPt: "thin" },
        },
      }),
    );
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /logo\.size/.test(e)));
      assert.ok(result.errors.some((e) => /footer\.align/.test(e)));
      assert.ok(result.errors.some((e) => /pageNumber\.format/.test(e)));
      assert.ok(result.errors.some((e) => /watermark\.opacity/.test(e)));
      assert.ok(result.errors.some((e) => /border\.widthPt/.test(e)));
      assert.ok(result.errors.some((e) => /safeArea\.color/.test(e)));
    }
  });

  test("validates slide deck chrome override mode matrix", () => {
    const cases: Array<{
      name: string;
      override: Record<string, unknown>;
      success: boolean;
      errorPattern?: RegExp;
    }> = [
      {
        name: "accepts inherit mode without value",
        override: { mode: "inherit" },
        success: true,
      },
      {
        name: "accepts disabled mode without value",
        override: { mode: "disabled" },
        success: true,
      },
      {
        name: "accepts detached mode without value",
        override: { mode: "detached" },
        success: true,
      },
      {
        name: "rejects override mode without object value",
        override: { mode: "override" },
        success: false,
        errorPattern: /footer\.value/,
      },
      {
        name: "accepts override mode with valid footer value",
        override: {
          mode: "override",
          value: { enabled: true, text: "Confidential", align: "right" },
        },
        success: true,
      },
    ];

    for (const matrixCase of cases) {
      resetBuilderCounter();
      const slide = invalidSlide({
        ...buildCoverSlide(),
        props: {
          deckChrome: {
            footer: matrixCase.override,
          },
        },
      });
      const result = safeParseDeck(buildDeck([slide]));
      assert.equal(
        result.success,
        matrixCase.success,
        `${matrixCase.name}\n${!result.success ? result.errors.join("\n") : ""}`,
      );
      if (!result.success && matrixCase.errorPattern) {
        assert.ok(result.errors.some((e) => matrixCase.errorPattern?.test(e)));
      }
    }
  });

  test("rejects table content with too few rows", () => {
    resetBuilderCounter();
    const tableSlide = buildTableSlide();
    const tableNode = tableContentFixture(
      tableSlide.children.find((n) => n.type === "table"),
    );
    if (!tableNode) return;
    const badTable = {
      ...tableSlide.children[1],
      content: {
        columns: [{ id: "c1", label: "A" }],
        rows: [], // must have at least 1 row
      },
    };
    const badSlide = { ...tableSlide, children: [badTable] };
    const deck = buildDeck([invalidSlide(badSlide)]);
    const result = safeParseDeck(deck);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((e) => /rows/.test(e)));
    }
  });

  test("accepts current source metadata contract", () => {
    const node = buildTextNode({
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        blockKind: "text",
        contentHash: "hash-1",
        blockRevision: "rev-1",
        linkedAt: "2026-06-30T10:00:00.000Z",
        display: {
          documentTitle: "Source document",
          blockLabel: "Executive summary",
          blockKindLabel: "Text",
        },
        refresh: {
          state: "fresh",
          checkedAt: "2026-06-30T10:00:00.000Z",
          refreshedAt: "2026-06-30T10:00:00.000Z",
          sourceHash: "hash-1",
          reason: "current",
        },
      },
    });
    const deck = buildDeck([buildSlide("content", [node])]);
    const result = safeParseDeck(deck);

    assert.ok(result.success, !result.success ? result.errors.join("; ") : "");
    if (result.success) {
      assert.equal(
        result.data.slides[0].children[0].source?.refresh?.state,
        "fresh",
      );
    }
  });

  test("rejects invalid source metadata fields", () => {
    const badNode = invalidChild({
      ...buildTextNode(),
      source: {
        documentId: "doc-1",
        blockId: "block-1",
        contentHash: "hash-1",
        refresh: { state: "invalid" },
        mystery: true,
      },
    });
    const deck = buildDeck([buildSlide("content", [badNode])]);
    const result = safeParseDeck(deck);

    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(result.errors.some((error) => error.includes("refresh.state")));
      assert.ok(
        result.errors.some((error) =>
          /unsupported_property: slides\[0\]\.children\[0\]\.source:/.test(
            error,
          ),
        ),
      );
    }
  });

  test("accepts valid slide and child base-node metadata", () => {
    resetBuilderCounter();
    const node = buildTextNode({
      name: "Body content",
      role: "body",
      slot: "body",
      locked: false,
      hidden: false,
      accessibility: {
        label: "Body content",
        alt: "Body content",
        decorative: false,
        readingOrder: 2,
      },
    });
    const slide = buildSlide("content", [node], {
      name: "Slide name",
      role: "slide",
      slot: "title",
      locked: false,
      hidden: false,
      accessibility: {
        label: "Slide label",
        decorative: false,
        readingOrder: 1,
      },
    });
    const result = safeParseDeck(buildDeck([slide]));
    assert.ok(
      result.success,
      `Expected success but got errors: ${!result.success && result.errors.join(", ")}`,
    );
  });

  test("rejects malformed child base-node metadata with precise paths", () => {
    resetBuilderCounter();
    const badNode = invalidChild({
      ...buildTextNode(),
      name: 42,
      role: "unknown-role",
      slot: "not-a-slot",
      locked: "yes",
      hidden: "no",
      accessibility: {
        label: 123,
        alt: false,
        decorative: "yes",
        readingOrder: "first",
        mystery: true,
      },
    });
    const result = safeParseDeck(buildDeck([buildSlide("content", [badNode])]));

    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /slides\[0\]\.children\[0\]\.name must be a string/,
        /slides\[0\]\.children\[0\]\.role is not a known semantic role/,
        /slides\[0\]\.children\[0\]\.slot is not a known slot key/,
        /slides\[0\]\.children\[0\]\.locked must be a boolean/,
        /slides\[0\]\.children\[0\]\.hidden must be a boolean/,
        /slides\[0\]\.children\[0\]\.accessibility\.label must be a string/,
        /slides\[0\]\.children\[0\]\.accessibility\.alt must be a string/,
        /slides\[0\]\.children\[0\]\.accessibility\.decorative must be a boolean/,
        /slides\[0\]\.children\[0\]\.accessibility\.readingOrder must be a finite number/,
        /unsupported_property: slides\[0\]\.children\[0\]\.accessibility:/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("rejects malformed slide base-node metadata with precise paths", () => {
    resetBuilderCounter();
    const badSlide = invalidSlide({
      ...buildCoverSlide(),
      name: 42,
      role: "unknown-role",
      slot: "not-a-slot",
      locked: "yes",
      hidden: "no",
      accessibility: {
        label: 123,
        alt: false,
        decorative: "yes",
        readingOrder: "first",
        mystery: true,
      },
    });
    const result = safeParseDeck(buildDeck([badSlide]));

    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /slides\[0\]\.name must be a string/,
        /slides\[0\]\.role is not a known semantic role/,
        /slides\[0\]\.slot is not a known slot key/,
        /slides\[0\]\.locked must be a boolean/,
        /slides\[0\]\.hidden must be a boolean/,
        /slides\[0\]\.accessibility\.label must be a string/,
        /slides\[0\]\.accessibility\.alt must be a string/,
        /slides\[0\]\.accessibility\.decorative must be a boolean/,
        /slides\[0\]\.accessibility\.readingOrder must be a finite number/,
        /unsupported_property: slides\[0\]\.accessibility:/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });

  test("reports malformed nested optional contracts with specific paths", () => {
    resetBuilderCounter();
    const slide = buildCoverSlide();
    const malformedText = {
      ...slide.children[0],
      id: "malformed-text",
      role: "unknown-role",
      layout: {
        frame: null,
        zIndex: "front",
        rotation: "quarter-turn",
        anchor: "middle",
        constraints: {
          minW: "wide",
          preserveAspectRatio: "yes",
          extra: true,
        },
      },
      source: {
        documentId: 123,
        blockKind: "audio",
        unlinked: "yes",
        display: {
          documentTitle: 42,
          unknown: true,
        },
        refresh: {
          state: "later",
          checkedAt: 42,
          mystery: true,
        },
        extra: "bad",
      },
      content: {
        paragraphs: [
          null,
          { id: "", text: 42, runs: [{ text: "does-not-match" }] },
        ],
      },
    };
    const malformedTable = {
      ...buildTextNode(),
      id: "malformed-table",
      type: "table",
      role: "table",
      content: {
        columns: [
          { id: "dup", label: "A" },
          { id: "dup", label: "B" },
        ],
        rows: [{ id: "row-1", cells: [{ text: "only one cell" }] }],
      },
    };
    const malformedConnector = {
      ...buildTextNode(),
      id: "malformed-connector",
      type: "connector",
      role: "connector",
      style: { ref: "connector.primary" },
      content: { from: null, to: "bad" },
    };
    const malformedShape = {
      ...buildTextNode(),
      id: "malformed-shape",
      type: "shape",
      role: "callout",
      style: { ref: "surface.card" },
      content: { shape: "rect", text: { paragraphs: "not-array" } },
    };
    const badSlide = {
      ...slide,
      props: {
        decoration: "maximal",
        chrome: "full",
        deckChrome: {
          sidebar: { mode: "override", value: {} },
          footer: { mode: "override", value: { enabled: true, text: 123 } },
        },
      },
      children: [
        malformedText,
        malformedTable,
        malformedConnector,
        malformedShape,
      ],
    };
    const result = safeParseDeck(
      buildDeck(
        [invalidSlide(badSlide)],
        invalidDeckOptions({
          canvas: null,
          assets: { images: null },
          chrome: {
            unexpected: {},
            logo: "bad",
            safeArea: { enabled: true, insets: "bad" },
          },
        }),
      ),
    );

    assert.ok(!result.success);
    if (!result.success) {
      for (const pattern of [
        /Deck\.canvas must be an object/,
        /Deck\.assets\.images/,
        /unsupported_property: Deck\.chrome:/,
        /Deck\.chrome\.logo must be an object/,
        /Deck\.chrome\.safeArea\.insets must be an object/,
        /props\.decoration/,
        /props\.chrome/,
        /unsupported_property: slides\[0\]\.props\.deckChrome:/,
        /deckChrome\.footer\.value\.footer\.text/,
        /role is not a known semantic role/,
        /layout\.frame must be an object/,
        /layout\.zIndex/,
        /layout\.rotation/,
        /layout\.anchor/,
        /unsupported_property: slides\[0\]\.children\[0\]\.layout\.constraints:/,
        /constraints\.minW/,
        /constraints\.preserveAspectRatio/,
        /source\.documentId/,
        /source\.blockKind/,
        /source\.unlinked/,
        /unsupported_property: slides\[0\]\.children\[0\]\.source\.display:/,
        /source\.display\.documentTitle/,
        /unsupported_property: slides\[0\]\.children\[0\]\.source\.refresh:/,
        /source\.refresh\.state/,
        /source\.refresh\.checkedAt/,
        /source\.extra/,
        /content\.paragraphs\[0\]/,
        /content\.paragraphs\[1\]\.id/,
        /content\.paragraphs\[1\]\.text/,
        /columns\[1\]\.id/,
        /must have exactly 2 cells/,
        /content\.from must be an object/,
        /content\.to must be an object/,
        /unsupported_property: slides\[0\]\.children\[3\]\.content:/,
      ]) {
        assert.ok(
          result.errors.some((error) => pattern.test(error)),
          `missing error matching ${pattern}\n${result.errors.join("\n")}`,
        );
      }
    }
  });
});
