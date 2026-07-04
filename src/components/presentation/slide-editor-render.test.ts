import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SlideEditor } from "./slide-editor";
import {
  buildDeck,
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
  buildVisualNode,
} from "@/test/builders/presentation-deck";

function mixedDeck() {
  return buildDeck([
    buildSlide(
      "content",
      [
        buildTextNode({ id: "text-1", role: "title" }),
        buildShapeNode({ id: "shape-1" }),
        buildImageNode("img-001", { id: "image-1" }),
        buildVisualNode({ id: "visual-1" }),
        buildTableNode({ id: "table-1" }),
      ],
      { id: "slide-1", name: "Mixed slide" },
    ),
    buildSlide("content", [buildTextNode({ id: "text-2" })], {
      id: "slide-2",
      name: "Summary slide",
    }),
  ]);
}

test("SlideEditor renders the full editor shell for mixed slide content", () => {
  const deck = mixedDeck();
  const actionOk = async () => ({ ok: true as const, data: undefined });

  const html = renderToStaticMarkup(
    createElement(SlideEditor, {
      documentId: "doc-render",
      deck,
      onDeckChange: () => undefined,
      onSave: actionOk,
      onClose: () => undefined,
      onPresent: actionOk,
      onShare: actionOk,
      onExportPptx: async () => undefined,
      onUploadImage: async () => ({
        src: "https://example.com/replacement.png",
        assetId: "replacement",
      }),
    }),
  );

  assert.match(html, /Deck tools/);
  assert.match(html, /data-slide-bottom-dock="true"/);
});
