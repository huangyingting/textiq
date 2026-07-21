import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PresentMode } from "@/components/presentation/present-mode";
import { PublicPresentViewer } from "@/components/presentation/public-present-viewer";
import {
  buildAssetRegistry,
  buildDeck,
  buildImageAsset,
  buildMinimalThemePackage,
  buildSlide,
  buildVisualNode,
} from "@/test/builders/presentation-deck";
import { DEFAULT_STYLE, VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";

const RENDERED_VISUAL_SRC = "https://example.com/rendered-visual.png";
const LIVE_VISUAL_ID = "doc-visual-live";

function buildVisualBackedDeck() {
  const slide = buildSlide("visual-focus", [
    buildVisualNode({
      content: {
        assetId: "visual-asset-1",
        visualId: "doc-visual-1",
        alt: "Revenue chart",
      },
    }),
  ]);

  return buildDeck([slide], {
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
  const slide = buildSlide("visual-focus", [
    buildVisualNode({
      content: {
        visualId: LIVE_VISUAL_ID,
        alt: "Journey map",
      },
    }),
  ]);

  return buildDeck([slide]);
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
  test("PresentMode resolves visual-backed assets", () => {
    const html = renderToStaticMarkup(
      createElement(PresentMode, {
        deck: buildVisualBackedDeck(),
        themePackage: buildMinimalThemePackage(),
        onClose: () => undefined,
      }),
    );

    assert.match(html, new RegExp(`src="${RENDERED_VISUAL_SRC}"`));
  });

  test("PublicPresentViewer resolves visual-backed assets", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck: buildVisualBackedDeck(),
        themePackage: buildMinimalThemePackage(),
        title: "Deck",
      }),
    );

    assert.match(html, new RegExp(`src="${RENDERED_VISUAL_SRC}"`));
  });

  test("PresentMode renders live document visuals", () => {
    const html = renderToStaticMarkup(
      createElement(PresentMode, {
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

  test("PublicPresentViewer renders live document visuals", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
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

  test("PublicPresentViewer emits theme-package font-face CSS", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck: buildDeck([buildSlide("content")]),
        themePackage: buildMinimalThemePackage("brand-package", {
          assets: {
            fonts: {
              "brand-font": {
                id: "brand-font",
                family: "Acme Sans",
                src: "/api/brand-assets/owner/font.woff2?shareId=share123&shareMode=present",
              },
            },
          },
        }),
        title: "Deck",
      }),
    );

    assert.match(html, /@font-face/);
    assert.match(html, /Acme Sans/);
    assert.match(html, /shareId=share123/);
  });
});
