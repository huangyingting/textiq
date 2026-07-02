import assert from "node:assert/strict";
import { test } from "node:test";

import { safeParseDeck, validateDeckChromeConfig } from "./validation";
import {
  buildDeck,
  buildLayoutBox,
  buildSlide,
} from "@/test/builders/presentation-deck";
import type { SlideChildNode } from "./schema";

test("safeParseDeck reports deeply malformed current presentation authoring contracts", () => {
  const badText: SlideChildNode = {
    id: "bad-text",
    type: "text",
    role: "bad-role" as never,
    slot: "bad-slot" as never,
    locked: "yes" as never,
    hidden: "no" as never,
    accessibility: {
      label: 1,
      alt: 2,
      decorative: "false",
      readingOrder: Number.NaN,
      extra: true,
    } as never,
    localStyle: {
      text: {
        fontFamily: 42,
        italic: "yes",
        underline: "no",
        strikethrough: 1,
        color: { token: "" },
        align: "bad",
        verticalAlign: "bad",
        textTransform: "bad",
      },
      fill: {
        type: "linearGradient",
        stops: [{ color: 7, offsetPct: Number.NaN }, "bad"],
      },
      table: {
        headerFill: "bad",
        rowFill: "bad",
        alternateRowFill: "bad",
        border: "bad",
        cellPaddingPt: { top: 1 },
        text: "bad",
        headerText: "bad",
      },
      connector: {
        stroke: "bad",
        startArrow: "bad",
        endArrow: "bad",
        routing: "bad",
      },
      effect: { kind: "bad" },
      image: "bad",
      slide: "bad",
      visual: "bad",
      clip: "bad",
      blendMode: "bad",
    } as never,
    source: {
      documentId: 1,
      blockId: 2,
      blockKind: "bad",
      contentHash: 3,
      blockRevision: 4,
      linkedAt: 5,
      unlinked: "no",
      display: {
        documentTitle: 1,
        blockLabel: 2,
        blockKindLabel: 3,
        extra: true,
      },
      refresh: {
        state: "bad",
        checkedAt: 1,
        refreshedAt: 2,
        sourceHash: 3,
        reason: 4,
        extra: true,
      },
      extra: "bad",
      unknown: true,
    } as never,
    layout: buildLayoutBox(),
    style: { ref: "text.body" },
    content: {
      paragraphs: [
        5,
        { id: "", text: 7, runs: "bad", list: "bad", extra: true },
        {
          id: "p",
          text: "Hello",
          runs: [
            {
              text: "Hi",
              bold: "yes",
              link: "javascript:alert(1)",
              localStyle: {
                color: 1,
                fontSizePt: Number.NaN,
                fontFamily: 2,
                extra: true,
              },
            },
          ],
          list: { kind: "bad", indent: -1, numberStyle: "bad", extra: true },
        },
      ],
      fit: "bad",
      language: 7,
      extra: true,
    } as never,
  };

  const nodes: SlideChildNode[] = [
    badText,
    {
      id: "bad-image",
      type: "image",
      layout: buildLayoutBox(),
      style: { ref: "media.inline" },
      content: {
        assetId: "",
        crop: { top: 1, right: 2, bottom: 3, left: "bad", extra: true },
        fit: "bad",
        focalPoint: { x: "bad", y: 5, z: 1 },
        alt: 5,
        extra: true,
      } as never,
    },
    {
      id: "bad-shape",
      type: "shape",
      layout: buildLayoutBox(),
      style: { ref: "surface.card" },
      content: { shape: "path", path: "", extra: true } as never,
    },
    {
      id: "bad-connector",
      type: "connector",
      layout: buildLayoutBox(),
      style: { ref: "connector.primary" },
      content: {
        from: { kind: "bad" },
        to: { kind: "node", nodeId: "", anchor: "bad" },
        routing: "bad",
        extra: true,
      } as never,
    },
    {
      id: "bad-table",
      type: "table",
      layout: buildLayoutBox(),
      style: { ref: "surface.table" },
      content: {
        columns: [{ id: "c" }, { id: "c", unknown: true }],
        rows: [
          { id: "r", cells: [{ text: 1, runs: {} }] },
          { id: "r", cells: [] },
        ],
        header: "yes",
        caption: 7,
        extra: true,
      } as never,
    },
    {
      id: "bad-visual",
      type: "visual",
      layout: buildLayoutBox(),
      style: { ref: "chart.primary" },
      content: { alt: 7, transparentBackground: "yes", extra: true } as never,
    },
    {
      id: "bad-group",
      type: "group",
      component: "bad" as never,
      layout: buildLayoutBox(),
      style: { ref: "surface.card" },
      children: [],
    },
    {
      id: "unknown",
      type: "unknown" as never,
      layout: buildLayoutBox(),
      style: { ref: "surface.card" },
      content: {},
      extra: true,
    } as never,
  ];
  const deck = buildDeck(
    [
      buildSlide("content", nodes, {
        props: {
          decoration: "bad",
          chrome: "bad",
          deckChrome: {
            nope: { mode: "bad" },
            footer: { mode: "override", value: "bad" },
          },
        } as never,
      }),
    ],
    {
      assets: {
        images: {
          img: {
            id: "other",
            src: "ftp://example.com/x.png",
            origin: {
              kind: "bad",
              sourceId: 1,
              importedAt: 2,
              extra: true,
            } as never,
          } as never,
        },
        fonts: {
          font: {
            id: "other",
            family: 1,
            src: "bad\u0000",
            style: "bad",
            weight: Number.NaN,
          } as never,
        },
        visuals: { visual: 7 as never },
        files: {
          file: {
            id: "other",
            src: "//evil",
            filename: 7,
            mimeType: 8,
            contentHash: 9,
          } as never,
        },
      } as never,
    },
  );

  const result = safeParseDeck(deck);
  assert.equal(result.success, false);
  if (!result.success) {
    for (const pattern of [
      /role is not a known semantic role/,
      /localStyle\.table\.headerFill/,
      /content\.paragraphs\[2\]: runs text/,
      /children\[1\].*crop\.left/,
      /children\[3\].*anchor/,
      /children\[4\].*rows\[1\]/,
      /children\[5\].*assetId or visualId/,
      /children\[6\].*children/,
      /unknown.*not a known node type/,
      /Deck\.assets\.images\.img\.id/,
    ]) {
      assert.ok(
        result.errors.some((error) => pattern.test(error)),
        `missing ${pattern}\n${result.errors.join("\n")}`,
      );
    }
  }
});

test("validateDeckChromeConfig reports malformed chrome slot options", () => {
  const errors: string[] = [];
  validateDeckChromeConfig(
    {
      unknown: {},
      logo: {
        enabled: "yes",
        layer: "middle",
        assetId: 5,
        alt: 6,
        placement: "middle",
        size: "huge",
        layout: "bad",
        style: "bad",
        extra: true,
      },
      footer: { text: 5, align: "justify" },
      pageNumber: { format: "roman", placement: "top" },
      watermark: {
        text: 5,
        opacity: Number.NaN,
        layoutMode: "spiral",
        size: "huge",
      },
      border: { color: 5, widthPt: Number.NaN },
      safeArea: {
        color: 5,
        widthPt: Number.NaN,
        insets: { top: 1, right: 2, bottom: 3, left: "bad", extra: true },
      },
    },
    "Deck.chrome",
    errors,
  );

  assert.ok(errors.length > 20);
  assert.ok(errors.some((error) => /Deck\.chrome\.unknown/.test(error)));
  assert.ok(
    errors.some((error) => /Deck\.chrome\.logo\.placement/.test(error)),
  );
  assert.ok(
    errors.some((error) => /Deck\.chrome\.safeArea\.insets\.left/.test(error)),
  );
});

test("safeParseDeck catches unexpected validator exceptions", () => {
  const throwing = new Proxy(
    {},
    {
      get() {
        throw new Error("boom");
      },
    },
  );
  const result = safeParseDeck(throwing);
  assert.equal(result.success, false);
  assert.ok(!result.success && result.errors.includes("boom"));
});
