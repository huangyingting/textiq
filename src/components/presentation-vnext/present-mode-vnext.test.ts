import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PresentModeVNext } from "@/components/presentation-vnext/present-mode-vnext";
import { PublicPresentViewerVNext } from "@/components/presentation-vnext/public-present-viewer-vnext";
import {
  buildAssetRegistry,
  buildDeckV7,
  buildImageAsset,
  buildMinimalThemePackage,
  buildSlideV7,
  buildVisualNode,
} from "@/test/builders/deck-v7";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";

const RENDERED_VISUAL_SRC = "https://example.com/rendered-visual.png";
const LIVE_VISUAL_ID = "doc-visual-live";

function buildVisualBackedDeck() {
  const slide = buildSlideV7("visual-focus", [
    buildVisualNode({
      content: {
        assetId: "visual-asset-1",
        visualId: "doc-visual-1",
        alt: "Revenue chart",
      },
    }),
  ]);

  return buildDeckV7([slide], {
    assets: buildAssetRegistry({
      images: {
        "backing-image": buildImageAsset("backing-image", {
          src: RENDERED_VISUAL_SRC,
        }),
      },
      visuals: {
        "visual-asset-1": {
          id: "backing-image",
          visualId: "doc-visual-1",
          alt: "Revenue chart",
        },
      },
    }),
  });
}

function buildLiveVisualDeck() {
  const slide = buildSlideV7("visual-focus", [
    buildVisualNode({
      content: {
        visualId: LIVE_VISUAL_ID,
        alt: "Journey map",
      },
    }),
  ]);

  return buildDeckV7([slide]);
}

const LIVE_VISUALS = {
  [LIVE_VISUAL_ID]: {
    version: VISUAL_SCHEMA_VERSION,
    type: "flowchart" as const,
    title: "Journey map",
    width: 960,
    height: 540,
    nodes: [{ id: "n1", label: "Start" }],
    edges: [],
    style: { ...DEFAULT_STYLE },
  },
};

describe("visual-backed asset rendering parity", () => {
  test("PresentModeVNext resolves visual-backed assets", () => {
    const html = renderToStaticMarkup(
      createElement(PresentModeVNext, {
        deck: buildVisualBackedDeck(),
        themePackage: buildMinimalThemePackage(),
        onClose: () => undefined,
      }),
    );

    assert.match(html, new RegExp(`src="${RENDERED_VISUAL_SRC}"`));
  });

  test("PublicPresentViewerVNext resolves visual-backed assets", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewerVNext, {
        deck: buildVisualBackedDeck(),
        themePackage: buildMinimalThemePackage(),
        title: "Deck",
      }),
    );

    assert.match(html, new RegExp(`src="${RENDERED_VISUAL_SRC}"`));
  });

  test("PresentModeVNext renders live document visuals", () => {
    const html = renderToStaticMarkup(
      createElement(PresentModeVNext, {
        deck: buildLiveVisualDeck(),
        themePackage: buildMinimalThemePackage(),
        visuals: LIVE_VISUALS,
        onClose: () => undefined,
      }),
    );

    assert.match(html, /<svg/);
    assert.match(html, /Start/);
    assert.doesNotMatch(html, /Visual placeholder/);
  });

  test("PublicPresentViewerVNext renders live document visuals", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewerVNext, {
        deck: buildLiveVisualDeck(),
        themePackage: buildMinimalThemePackage(),
        title: "Deck",
        visuals: LIVE_VISUALS,
      }),
    );

    assert.match(html, /<svg/);
    assert.match(html, /Start/);
    assert.doesNotMatch(html, /Visual placeholder/);
  });
});
