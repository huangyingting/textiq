import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveDeckAssetSource } from "@/lib/presentation/deck-asset-source";
import {
  buildDeck,
  buildImageAsset,
  buildMinimalThemePackage,
  buildVisualNode,
  buildSlide,
} from "@/test/builders/presentation-deck";

describe("resolveDeckAssetSource", () => {
  test("resolves direct image and file asset ids", () => {
    const deck = buildDeck([buildSlide("content", [buildVisualNode()])], {
      assets: {
        images: {
          "image-asset": buildImageAsset("image-asset", {
            src: "https://example.com/direct-image.png",
          }),
        },
        files: {
          "file-asset": {
            id: "file-asset",
            src: "data:image/svg+xml;base64,PHN2Zy8+",
          },
        },
      },
    });

    assert.equal(
      resolveDeckAssetSource(deck, "image-asset"),
      "https://example.com/direct-image.png",
    );
    assert.equal(
      resolveDeckAssetSource(deck, "file-asset"),
      "data:image/svg+xml;base64,PHN2Zy8+",
    );
  });

  test("resolves package image asset ids when deck assets do not contain them", () => {
    const deck = buildDeck([buildSlide("content", [buildVisualNode()])], {
      assets: { images: {} },
    });

    assert.equal(
      resolveDeckAssetSource(deck, "package-logo", {
        ...buildMinimalThemePackage("pkg"),
        assets: {
          images: {
            "package-logo": buildImageAsset("package-logo", {
              src: "/api/brand-assets/owner/package-logo.png",
            }),
          },
        },
      }),
      "/api/brand-assets/owner/package-logo.png",
    );
  });

  test("resolves visual-backed asset ids through their backing image or file assets", () => {
    const deck = buildDeck([buildSlide("content", [buildVisualNode()])], {
      assets: {
        images: {
          "visual-image-backing": buildImageAsset("visual-image-backing", {
            src: "https://example.com/visual.png",
          }),
        },
        files: {
          "visual-file-backing": {
            id: "visual-file-backing",
            src: "data:image/png;base64,AAAA",
          },
        },
        visuals: {
          "visual-image": { id: "visual-image-backing", visualId: "chart-1" },
          "visual-file": { id: "visual-file-backing", visualId: "chart-2" },
        },
      },
    });

    assert.equal(
      resolveDeckAssetSource(deck, "visual-image"),
      "https://example.com/visual.png",
    );
    assert.equal(
      resolveDeckAssetSource(deck, "visual-file"),
      "data:image/png;base64,AAAA",
    );
  });
});
