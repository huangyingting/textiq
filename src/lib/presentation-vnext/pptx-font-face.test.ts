import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExportDeckSpec } from "./export-spec";
import { buildVnextPptxSpec } from "./pptx-export-adapter";

test("buildVnextPptxSpec maps registry CSS stacks and custom families to PPTX font faces", () => {
  const exportSpec: ExportDeckSpec = {
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    diagnostics: [],
    slides: [
      {
        id: "font-slide",
        background: {
          type: "background",
          fill: { type: "solid", color: "#ffffff" },
        },
        operations: [
          {
            type: "text",
            id: "registry-font",
            frame: { x: 0, y: 0, w: 100, h: 40 },
            content: { paragraphs: [{ id: "p1", text: "Registry" }] },
            style: {
              text: {
                fontFamily: "'Source Serif 4', 'Noto Sans SC', serif",
                fontSizePt: 24,
              },
            },
            zIndex: 1,
          },
          {
            type: "text",
            id: "custom-font",
            frame: { x: 0, y: 44, w: 100, h: 40 },
            content: { paragraphs: [{ id: "p2", text: "Custom" }] },
            style: { text: { fontFamily: "Acme Sans", fontSizePt: 18 } },
            zIndex: 2,
          },
        ],
      },
    ],
  };

  const pptx = buildVnextPptxSpec(exportSpec);
  const registry = pptx.slides[0].ops.find((op) => op.id === "registry-font");
  const custom = pptx.slides[0].ops.find((op) => op.id === "custom-font");
  assert.equal(registry?.type, "text");
  assert.equal(custom?.type, "text");
  if (registry?.type === "text")
    assert.equal(registry.textStyle.fontFace, "Georgia");
  if (custom?.type === "text")
    assert.equal(custom.textStyle.fontFace, "Acme Sans");
});
